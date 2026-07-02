import type { DownloadResult } from '@shared/messages';
import type { DetectedVideo } from '@shared/types';

import { directDownloader } from './directDownloader';
import { streamDownloader } from './streamDownloader';

/**
 * 동영상 종류별 다운로드 전략 인터페이스.
 * direct는 URL을 그대로, hls/dash는 offscreen 문서에서 조립·변환해 내려받는다.
 */
export interface Downloader {
  canHandle(video: DetectedVideo): boolean;
  download(video: DetectedVideo, tabId: number): Promise<DownloadResult>;
}

const downloaders: Downloader[] = [directDownloader, streamDownloader];

export async function downloadVideo(video: DetectedVideo, tabId: number): Promise<DownloadResult> {
  const downloader = downloaders.find((d) => d.canHandle(video));
  if (!downloader) {
    return { ok: false, error: '이 형식의 동영상은 아직 다운로드를 지원하지 않습니다.' };
  }
  return downloader.download(video, tabId);
}
