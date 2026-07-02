import { buildDownloadFilename } from '@shared/filename';
import type { DownloadResult } from '@shared/messages';
import type { DetectedVideo } from '@shared/types';

import type { Downloader } from './downloader';

/** 직접 URL(mp4/webm 등)을 chrome.downloads로 내려받는다. */
export const directDownloader: Downloader = {
  canHandle(video: DetectedVideo): boolean {
    return video.kind === 'direct';
  },

  async download(video: DetectedVideo): Promise<DownloadResult> {
    const filename = buildDownloadFilename({
      url: video.url,
      mimeType: video.mimeType,
      pageTitle: video.pageTitle,
    });

    try {
      const downloadId = await chrome.downloads.download({
        url: video.url,
        filename,
        saveAs: false,
      });
      return { ok: true, downloadId };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};
