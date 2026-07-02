import { downloadStateKeyForTab } from '@shared/storageKeys';
import type { StreamDownloadState } from '@shared/types';

/**
 * 탭별 스트림 다운로드 상태(Record<videoId, StreamDownloadState>)의 직렬화 저장소.
 * videoStore와 같은 이유로 get→merge→set 사이의 끼어들기를 큐로 막는다.
 */
const tabWriteQueues = new Map<number, Promise<void>>();

function enqueueTabWrite(tabId: number, op: () => Promise<void>): Promise<void> {
  const prev = tabWriteQueues.get(tabId) ?? Promise.resolve();
  const next = prev.then(op, op);
  tabWriteQueues.set(tabId, next);
  void next.finally(() => {
    if (tabWriteQueues.get(tabId) === next) tabWriteQueues.delete(tabId);
  });
  return next;
}

/** 탭의 진행 중 다운로드 상태 전체를 조회한다. */
export async function getDownloadStates(
  tabId: number,
): Promise<Record<string, StreamDownloadState>> {
  const key = downloadStateKeyForTab(tabId);
  const result = await chrome.storage.session.get(key);
  return (result[key] as Record<string, StreamDownloadState> | undefined) ?? {};
}

/** 하나의 다운로드 상태를 기록/갱신한다. */
export function setDownloadState(tabId: number, state: StreamDownloadState): Promise<void> {
  return enqueueTabWrite(tabId, async () => {
    const states = await getDownloadStates(tabId);
    states[state.videoId] = state;
    await chrome.storage.session.set({ [downloadStateKeyForTab(tabId)]: states });
  });
}

/**
 * 하나의 다운로드 상태를 제거한다.
 * @param expectedJobId 지정 시 해당 잡의 상태일 때만 제거한다 (뒤늦게 도착한 이전 잡 메시지 무시)
 */
export function clearDownloadState(
  tabId: number,
  videoId: string,
  expectedJobId?: string,
): Promise<void> {
  return enqueueTabWrite(tabId, async () => {
    const states = await getDownloadStates(tabId);
    const existing = states[videoId];
    if (!existing) return;
    if (expectedJobId !== undefined && existing.jobId !== expectedJobId) return;
    delete states[videoId];
    const key = downloadStateKeyForTab(tabId);
    if (Object.keys(states).length === 0) {
      await chrome.storage.session.remove(key);
    } else {
      await chrome.storage.session.set({ [key]: states });
    }
  });
}

/** 탭의 다운로드 상태 전체를 제거한다 (탭 닫힘/네비게이션 시). */
export function clearTabDownloads(tabId: number): Promise<void> {
  return enqueueTabWrite(tabId, async () => {
    await chrome.storage.session.remove(downloadStateKeyForTab(tabId));
  });
}
