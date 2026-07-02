import { t } from '@shared/i18n';
import type { DownloadResult } from '@shared/messages';
import { sendToOffscreen } from '@shared/messages';
import type { DetectedVideo, StreamJobRef } from '@shared/types';

import { clearDownloadState, getDownloadStates, setDownloadState } from '../downloadStateStore';
import { runWithOffscreen } from '../offscreenManager';
import type { Downloader } from './downloader';

/**
 * HLS/DASH 스트림 다운로더.
 * 실제 작업(세그먼트 수집 + ffmpeg 변환)은 offscreen 문서가 수행하고,
 * 여기서는 잡을 디스패치한 뒤 즉시 응답한다. 진행률은 storage.session의
 * dl:<tabId> 상태로 팝업에 전달된다 (streamJobs.ts 참고).
 */
export const streamDownloader: Downloader = {
  canHandle(video: DetectedVideo): boolean {
    return video.kind === 'hls' || video.kind === 'dash';
  },

  async download(video: DetectedVideo, tabId: number): Promise<DownloadResult> {
    const states = await getDownloadStates(tabId);
    const existing = states[video.id];
    if (existing && !existing.error) {
      return { ok: false, error: t('errorDownloadInProgress') };
    }

    const job: StreamJobRef = { jobId: crypto.randomUUID(), tabId, videoId: video.id };
    await setDownloadState(tabId, {
      videoId: video.id,
      jobId: job.jobId,
      phase: 'preparing',
      progress: 0,
      updatedAt: Date.now(),
    });

    try {
      // 문서 보장과 잡 전송을 한 임계구역에서 수행해, 직전 잡 정리(close)와의 경쟁을 막는다
      const ack = await runWithOffscreen(() =>
        sendToOffscreen({ type: 'OFFSCREEN_START_JOB', job, video }),
      );
      if (!ack?.ok) {
        throw new Error(t('errorOffscreenStartFailed'));
      }
    } catch (error) {
      await clearDownloadState(tabId, video.id, job.jobId);
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }

    // downloadId는 변환이 끝난 뒤 chrome.downloads가 시작될 때 생긴다
    return { ok: true };
  },
};
