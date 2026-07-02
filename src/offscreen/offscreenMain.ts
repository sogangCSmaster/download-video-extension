// offscreen 문서 진입점.
// SW가 chrome.offscreen.createDocument로 열며, 스트림 다운로드 잡을 수행하고
// 결과 blob URL을 SW에 넘긴다 (SW가 chrome.downloads로 저장).
import type { OffscreenMessage } from '@shared/messages';
import { sendMessage } from '@shared/messages';
import { streamErrorMessage } from '@shared/streaming/streamErrors';
import type { DetectedVideo, StreamJobRef, StreamPhase } from '@shared/types';

import { runJob } from './jobRunner';

const jobs = new Map<string, AbortController>();
/** 아직 다운로드가 끝나지 않아 revoke하면 안 되는 blob URL들 */
const liveBlobUrls = new Set<string>();

function isOffscreenMessage(message: unknown): message is OffscreenMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    typeof (message as { type?: unknown }).type === 'string' &&
    ((message as { type: string }).type.startsWith('OFFSCREEN_'))
  );
}

const PROGRESS_INTERVAL_MS = 500;

async function startJob(job: StreamJobRef, video: DetectedVideo): Promise<void> {
  const controller = new AbortController();
  jobs.set(job.jobId, controller);

  // storage.session 쓰기 폭주를 막기 위해 같은 단계의 보고는 스로틀한다
  let lastPhase: StreamPhase | null = null;
  let lastReportAt = 0;
  const report = (phase: StreamPhase, progress: number) => {
    const now = Date.now();
    if (phase === lastPhase && now - lastReportAt < PROGRESS_INTERVAL_MS) return;
    lastPhase = phase;
    lastReportAt = now;
    void sendMessage({ type: 'STREAM_JOB_PROGRESS', job, phase, progress }).catch(() => undefined);
  };

  try {
    const { blobUrl, filename } = await runJob(video, controller.signal, report);
    liveBlobUrls.add(blobUrl);
    await sendMessage({ type: 'STREAM_JOB_COMPLETE', job, blobUrl, filename });
  } catch (error) {
    await sendMessage({
      type: 'STREAM_JOB_FAILED',
      job,
      error: streamErrorMessage(error),
    }).catch(() => undefined);
  } finally {
    jobs.delete(job.jobId);
  }
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  // SW 라우터가 처리하는 타입에는 절대 응답하지 않는다 (sendResponse 경쟁 방지)
  if (!isOffscreenMessage(message)) return false;

  switch (message.type) {
    case 'OFFSCREEN_START_JOB':
      void startJob(message.job, message.video);
      sendResponse({ ok: true });
      return false;

    case 'OFFSCREEN_CANCEL_JOB':
      jobs.get(message.jobId)?.abort();
      sendResponse(undefined);
      return false;

    case 'OFFSCREEN_RELEASE_BLOB':
      URL.revokeObjectURL(message.blobUrl);
      liveBlobUrls.delete(message.blobUrl);
      // 남은 작업이 없으면 SW가 이 문서를 닫는다
      sendResponse({ active: jobs.size + liveBlobUrls.size });
      return false;
  }
});
