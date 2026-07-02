import type { DownloadResult } from '@shared/messages';
import type { DetectedVideo } from '@shared/types';

import { directDownloader } from './directDownloader';

/**
 * 동영상 종류별 다운로드 전략 인터페이스.
 * 1단계는 direct만 지원하며, 2단계에서 HLS 다운로더를 이 배열에 추가한다.
 */
export interface Downloader {
  canHandle(video: DetectedVideo): boolean;
  download(video: DetectedVideo): Promise<DownloadResult>;
}

const downloaders: Downloader[] = [directDownloader];

export async function downloadVideo(video: DetectedVideo): Promise<DownloadResult> {
  const downloader = downloaders.find((d) => d.canHandle(video));
  if (!downloader) {
    return { ok: false, error: '이 형식의 동영상은 아직 다운로드를 지원하지 않습니다.' };
  }
  return downloader.download(video);
}
