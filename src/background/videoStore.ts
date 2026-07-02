import { storageKeyForTab } from '@shared/storageKeys';
import type { DetectedVideo } from '@shared/types';

/**
 * 탭별 쓰기 직렬화 큐.
 * get→merge→set 사이에 다른 쓰기가 끼어들면 마지막 set이 앞선 병합을 덮어써
 * 탐지 결과가 유실되므로, 같은 탭에 대한 변경은 순서대로 실행한다.
 */
const tabWriteQueues = new Map<number, Promise<void>>();

function enqueueTabWrite(tabId: number, op: () => Promise<void>): Promise<void> {
  const prev = tabWriteQueues.get(tabId) ?? Promise.resolve();
  // 앞선 작업이 실패해도 다음 작업은 실행한다
  const next = prev.then(op, op);
  tabWriteQueues.set(tabId, next);
  void next.finally(() => {
    if (tabWriteQueues.get(tabId) === next) tabWriteQueues.delete(tabId);
  });
  return next;
}

/** 탭의 탐지된 동영상 목록을 조회한다. */
export async function getVideos(tabId: number): Promise<DetectedVideo[]> {
  const key = storageKeyForTab(tabId);
  const result = await chrome.storage.session.get(key);
  return (result[key] as DetectedVideo[] | undefined) ?? [];
}

/** 같은 id의 기존 항목과 병합한다. 새 정보가 있는 필드만 덮어쓴다. */
function mergeVideo(existing: DetectedVideo, incoming: DetectedVideo): DetectedVideo {
  // 한쪽이라도 direct로 판별했다면(예: 네트워크가 mime으로 확인) direct를 신뢰한다
  const kind = existing.kind === 'direct' || incoming.kind === 'direct' ? 'direct' : incoming.kind;
  return {
    ...existing,
    frameId: incoming.frameId ?? existing.frameId,
    mimeType: incoming.mimeType ?? existing.mimeType,
    sizeBytes: incoming.sizeBytes ?? existing.sizeBytes,
    width: incoming.width ?? existing.width,
    height: incoming.height ?? existing.height,
    durationSec: incoming.durationSec ?? existing.durationSec,
    posterUrl: incoming.posterUrl ?? existing.posterUrl,
    pageTitle: incoming.pageTitle ?? existing.pageTitle,
    sources: [...new Set([...existing.sources, ...incoming.sources])],
    kind,
  };
}

async function writeIfChanged(tabId: number, before: DetectedVideo[], after: DetectedVideo[]): Promise<void> {
  // 내용이 같으면 set을 생략해 onChanged 연쇄(배지 갱신·팝업 리렌더)를 막는다
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  await chrome.storage.session.set({ [storageKeyForTab(tabId)]: after });
}

/** 동영상들을 탭 목록에 추가하거나 기존 항목과 병합한다 (네트워크 탐지 경로). */
export function upsertVideos(tabId: number, videos: DetectedVideo[]): Promise<void> {
  if (videos.length === 0) return Promise.resolve();

  return enqueueTabWrite(tabId, async () => {
    const existing = await getVideos(tabId);
    const byId = new Map(existing.map((v) => [v.id, v]));
    for (const video of videos) {
      const prev = byId.get(video.id);
      byId.set(video.id, prev ? mergeVideo(prev, video) : video);
    }
    await writeIfChanged(tabId, existing, [...byId.values()]);
  });
}

/**
 * DOM 스캔 결과를 프레임 단위로 정합시킨다 (content script 보고 경로).
 * 새 항목은 추가·병합하고, 같은 프레임에서 이전에 DOM으로만 탐지됐던 항목이
 * 이번 보고에 없으면 제거한다 (SPA에서 플레이어가 사라진 경우).
 */
export function syncDomVideos(tabId: number, frameId: number, videos: DetectedVideo[]): Promise<void> {
  return enqueueTabWrite(tabId, async () => {
    const existing = await getVideos(tabId);
    const reportedIds = new Set(videos.map((v) => v.id));

    const kept = existing.filter((v) => {
      const domOnlyInFrame =
        v.sources.length === 1 && v.sources[0] === 'dom' && v.frameId === frameId;
      return !domOnlyInFrame || reportedIds.has(v.id);
    });

    const byId = new Map(kept.map((v) => [v.id, v]));
    for (const video of videos) {
      const prev = byId.get(video.id);
      byId.set(video.id, prev ? mergeVideo(prev, video) : video);
    }
    await writeIfChanged(tabId, existing, [...byId.values()]);
  });
}

/** 지정한 id들을 탭 목록에서 제거한다 (master 플레이리스트가 커버하는 variant 정리용). */
export function removeVideos(tabId: number, ids: Iterable<string>): Promise<void> {
  const drop = new Set(ids);
  if (drop.size === 0) return Promise.resolve();
  return enqueueTabWrite(tabId, async () => {
    const existing = await getVideos(tabId);
    const after = existing.filter((v) => !drop.has(v.id));
    await writeIfChanged(tabId, existing, after);
  });
}

/** 탭의 목록을 초기화한다 (탭 닫힘/네비게이션 시). */
export function clearTab(tabId: number): Promise<void> {
  return enqueueTabWrite(tabId, async () => {
    await chrome.storage.session.remove(storageKeyForTab(tabId));
  });
}
