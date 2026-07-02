import { sendToOffscreen } from '@shared/messages';
import { DOWNLOAD_BLOBS_KEY } from '@shared/storageKeys';
import type { StreamJobRef, StreamPhase } from '@shared/types';

import { clearDownloadState, getDownloadStates, setDownloadState } from './downloadStateStore';
import { closeOffscreenDocument } from './offscreenManager';

/**
 * offscreen에서 온 STREAM_JOB_* 메시지와 chrome.downloads 완료를 잇는 접착 계층.
 * SW는 언제든 죽을 수 있으므로 downloadId→blob 매핑은 storage.session에 영속한다.
 */

interface BlobEntry {
  blobUrl: string;
  tabId: number;
  videoId: string;
}

async function getBlobMap(): Promise<Record<string, BlobEntry>> {
  const result = await chrome.storage.session.get(DOWNLOAD_BLOBS_KEY);
  return (result[DOWNLOAD_BLOBS_KEY] as Record<string, BlobEntry> | undefined) ?? {};
}

function setBlobMap(map: Record<string, BlobEntry>): Promise<void> {
  return chrome.storage.session.set({ [DOWNLOAD_BLOBS_KEY]: map });
}

/** blob URL을 offscreen에서 revoke시키고, 남은 작업이 없으면 offscreen 문서를 닫는다. */
async function releaseBlob(blobUrl: string): Promise<void> {
  try {
    const { active } = await sendToOffscreen({ type: 'OFFSCREEN_RELEASE_BLOB', blobUrl });
    if (active === 0) await closeOffscreenDocument();
  } catch {
    // offscreen 문서가 이미 닫혔으면 blob도 함께 사라졌으므로 무시
  }
}

/** 현재 상태 항목이 이 잡의 것일 때만 true (취소·재시작 후 도착한 늦은 메시지 차단). */
async function isCurrentJob(job: StreamJobRef): Promise<boolean> {
  const states = await getDownloadStates(job.tabId);
  return states[job.videoId]?.jobId === job.jobId;
}

export async function handleStreamProgress(
  job: StreamJobRef,
  phase: StreamPhase,
  progress: number,
): Promise<void> {
  if (!(await isCurrentJob(job))) return;
  await setDownloadState(job.tabId, {
    videoId: job.videoId,
    jobId: job.jobId,
    phase,
    progress,
    updatedAt: Date.now(),
  });
}

export async function handleStreamFailed(job: StreamJobRef, error: string): Promise<void> {
  if (!(await isCurrentJob(job))) return;
  const states = await getDownloadStates(job.tabId);
  const existing = states[job.videoId];
  await setDownloadState(job.tabId, {
    videoId: job.videoId,
    jobId: job.jobId,
    phase: existing?.phase ?? 'preparing',
    progress: existing?.progress ?? 0,
    error,
    updatedAt: Date.now(),
  });
}

export async function handleStreamComplete(
  job: StreamJobRef,
  blobUrl: string,
  filename: string,
): Promise<void> {
  if (!(await isCurrentJob(job))) {
    // 취소됐거나 탭이 사라진 잡 — 파일을 만들지 않고 blob만 정리
    await releaseBlob(blobUrl);
    return;
  }

  await setDownloadState(job.tabId, {
    videoId: job.videoId,
    jobId: job.jobId,
    phase: 'saving',
    progress: 1,
    updatedAt: Date.now(),
  });

  try {
    // offscreen이 만든 blob:chrome-extension:// URL은 확장과 same-origin이라 다운로드 가능
    const downloadId = await chrome.downloads.download({ url: blobUrl, filename, saveAs: false });
    const map = await getBlobMap();
    map[String(downloadId)] = { blobUrl, tabId: job.tabId, videoId: job.videoId };
    await setBlobMap(map);
  } catch (error) {
    await releaseBlob(blobUrl);
    await handleStreamFailed(
      job,
      `저장 실패: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** popup의 CANCEL_DOWNLOAD: offscreen 잡을 중단시키고 상태를 지운다. */
export async function cancelStreamDownload(tabId: number, videoId: string): Promise<void> {
  const states = await getDownloadStates(tabId);
  const state = states[videoId];
  if (!state) return;
  try {
    await sendToOffscreen({ type: 'OFFSCREEN_CANCEL_JOB', jobId: state.jobId });
  } catch {
    // offscreen이 없으면 잡도 없는 것
  }
  await clearDownloadState(tabId, videoId);
}

/** 탭 정리 시: 진행 중인 잡을 모두 취소하고 상태를 지운다 (tabLifecycle에서 호출). */
export async function cancelTabStreamDownloads(tabId: number): Promise<void> {
  const states = await getDownloadStates(tabId);
  for (const videoId of Object.keys(states)) {
    await cancelStreamDownload(tabId, videoId);
  }
}

async function onDownloadChanged(delta: chrome.downloads.DownloadDelta): Promise<void> {
  const state = delta.state?.current;
  if (state !== 'complete' && state !== 'interrupted') return;

  const map = await getBlobMap();
  const entry = map[String(delta.id)];
  if (!entry) return; // 이 확장의 스트림 다운로드가 아님

  delete map[String(delta.id)];
  await setBlobMap(map);

  if (state === 'complete') {
    await clearDownloadState(entry.tabId, entry.videoId);
  } else {
    const states = await getDownloadStates(entry.tabId);
    const existing = states[entry.videoId];
    if (existing) {
      await setDownloadState(entry.tabId, {
        ...existing,
        error: '파일 저장이 중단되었습니다.',
        updatedAt: Date.now(),
      });
    }
  }
  await releaseBlob(entry.blobUrl);
}

/** downloads.onChanged 구독을 등록한다. 반드시 service worker top-level에서 호출할 것. */
export function registerStreamJobs(): void {
  chrome.downloads.onChanged.addListener((delta) => {
    void onDownloadChanged(delta);
  });
}
