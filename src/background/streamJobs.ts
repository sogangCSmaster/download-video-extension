import { t } from '@shared/i18n';
import { sendToOffscreen } from '@shared/messages';
import { DOWNLOAD_BLOBS_KEY } from '@shared/storageKeys';
import type { StreamJobRef, StreamPhase } from '@shared/types';

import {
  clearDownloadState,
  getDownloadStates,
  updateDownloadStateIfCurrent,
} from './downloadStateStore';
import { closeOffscreenIfIdle, withOffscreenLock } from './offscreenManager';

/**
 * offscreen에서 온 STREAM_JOB_* 메시지와 chrome.downloads 완료를 잇는 접착 계층.
 * SW는 언제든 죽을 수 있으므로 downloadId→blob 매핑은 storage.session에 영속한다.
 */

interface BlobEntry {
  blobUrl: string;
  tabId: number;
  videoId: string;
  /** 완료/중단 이벤트가 다른(재시작된) 잡의 상태를 건드리지 않도록 대조한다 */
  jobId: string;
}

/**
 * blob 맵의 read-modify-write를 직렬화한다.
 * downloads.download() 직후 이 큐에 동기적으로 기록을 넣으므로, 그 뒤에 도착하는
 * onChanged(complete) 처리가 항상 기록 이후에 실행된다 (기록 전 이벤트 조회 경쟁 방지).
 */
let blobMapQueue: Promise<unknown> = Promise.resolve();

function enqueueBlobMapOp<T>(op: () => Promise<T>): Promise<T> {
  const next = blobMapQueue.then(op, op);
  blobMapQueue = next.catch(() => undefined);
  return next;
}

async function getBlobMap(): Promise<Record<string, BlobEntry>> {
  const result = await chrome.storage.session.get(DOWNLOAD_BLOBS_KEY);
  return (result[DOWNLOAD_BLOBS_KEY] as Record<string, BlobEntry> | undefined) ?? {};
}

function setBlobMap(map: Record<string, BlobEntry>): Promise<void> {
  return chrome.storage.session.set({ [DOWNLOAD_BLOBS_KEY]: map });
}

function registerBlobEntry(downloadId: number, entry: BlobEntry): Promise<void> {
  return enqueueBlobMapOp(async () => {
    const map = await getBlobMap();
    map[String(downloadId)] = entry;
    await setBlobMap(map);
  });
}

/** 맵에서 entry를 꺼내며 제거한다. 이 확장의 다운로드가 아니면 undefined. */
function takeBlobEntry(downloadId: number): Promise<BlobEntry | undefined> {
  return enqueueBlobMapOp(async () => {
    const map = await getBlobMap();
    const key = String(downloadId);
    const entry = map[key];
    if (!entry) return undefined;
    delete map[key];
    await setBlobMap(map);
    return entry;
  });
}

/** blob URL을 offscreen에서 revoke시키고, 남은 작업이 없으면 offscreen 문서를 닫는다. */
async function releaseBlob(blobUrl: string): Promise<void> {
  // 조회(active)와 close 사이에 새 잡이 시작되지 않도록 lock 안에서 수행한다
  await withOffscreenLock(async () => {
    try {
      const { active } = await sendToOffscreen({ type: 'OFFSCREEN_RELEASE_BLOB', blobUrl });
      if (active === 0) await chrome.offscreen.closeDocument().catch(() => undefined);
    } catch {
      // offscreen 문서가 이미 닫혔으면 blob도 함께 사라졌으므로 무시
    }
  });
}

export async function handleStreamProgress(
  job: StreamJobRef,
  phase: StreamPhase,
  progress: number,
): Promise<void> {
  await updateDownloadStateIfCurrent(job.tabId, job.videoId, job.jobId, (existing) => ({
    ...existing,
    phase,
    progress,
    updatedAt: Date.now(),
  }));
}

export async function handleStreamFailed(job: StreamJobRef, error: string): Promise<void> {
  await updateDownloadStateIfCurrent(job.tabId, job.videoId, job.jobId, (existing) => ({
    ...existing,
    error,
    updatedAt: Date.now(),
  }));
  // 실패한 잡이 마지막이었으면 ffmpeg.wasm이 로드된 offscreen 문서를 정리한다
  await closeOffscreenIfIdle();
}

export async function handleStreamComplete(
  job: StreamJobRef,
  blobUrl: string,
  filename: string,
): Promise<void> {
  const isCurrent = await updateDownloadStateIfCurrent(
    job.tabId,
    job.videoId,
    job.jobId,
    (existing) => ({ ...existing, phase: 'saving', progress: 1, updatedAt: Date.now() }),
  );
  if (!isCurrent) {
    // 취소됐거나 탭이 사라진 잡 — 파일을 만들지 않고 blob만 정리
    await releaseBlob(blobUrl);
    return;
  }

  try {
    // offscreen이 만든 blob:chrome-extension:// URL은 확장과 same-origin이라 다운로드 가능
    const downloadId = await chrome.downloads.download({ url: blobUrl, filename, saveAs: false });
    // download() resolve와 같은 동기 구간에서 큐에 넣어야 onChanged(complete)보다 먼저 기록된다
    await registerBlobEntry(downloadId, {
      blobUrl,
      tabId: job.tabId,
      videoId: job.videoId,
      jobId: job.jobId,
    });
  } catch (error) {
    await releaseBlob(blobUrl);
    await handleStreamFailed(
      job,
      t('errorSaveFailed', error instanceof Error ? error.message : String(error)),
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
  await clearDownloadState(tabId, videoId, state.jobId);
  // 취소된 잡이 마지막이었으면 문서를 닫는다 (아직 abort 처리 중이면 active>0이라 건너뛴다)
  await closeOffscreenIfIdle();
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

  const entry = await takeBlobEntry(delta.id);
  if (!entry) return; // 이 확장의 스트림 다운로드가 아님

  if (state === 'complete') {
    await clearDownloadState(entry.tabId, entry.videoId, entry.jobId);
  } else {
    // 같은 잡의 상태일 때만 오류를 남긴다 (재시작된 잡의 상태 오염 방지)
    await updateDownloadStateIfCurrent(entry.tabId, entry.videoId, entry.jobId, (existing) => ({
      ...existing,
      error: t('errorSaveInterrupted'),
      updatedAt: Date.now(),
    }));
  }
  await releaseBlob(entry.blobUrl);
}

/** downloads.onChanged 구독을 등록한다. 반드시 service worker top-level에서 호출할 것. */
export function registerStreamJobs(): void {
  chrome.downloads.onChanged.addListener((delta) => {
    void onDownloadChanged(delta);
  });
}
