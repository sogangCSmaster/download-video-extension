import type { Message, MessageOf, MessageType, ResponseMap } from '@shared/messages';
import { sendMessageToTab } from '@shared/messages';
import { classifyVideoUrl, videoIdFromUrl } from '@shared/urlUtils';
import type { DetectedVideo, DomVideoCandidate } from '@shared/types';

import { downloadVideo } from './download/downloader';
import {
  cancelStreamDownload,
  handleStreamComplete,
  handleStreamFailed,
  handleStreamProgress,
} from './streamJobs';
import { getVideos, syncDomVideos } from './videoStore';

type Handler<T extends MessageType> = (
  msg: MessageOf<T>,
  sender: chrome.runtime.MessageSender,
) => Promise<ResponseMap[T]>;

type HandlerTable = { [T in MessageType]: Handler<T> };

function domCandidateToVideo(candidate: DomVideoCandidate, frameId: number): DetectedVideo {
  // 확장자·mime으로 판별 불가한 http(s) src는 direct로 간주한다.
  // (MSE 기반 스트리밍이면 src가 blob:이므로, 일반 URL이 video.src에 있다면 대개 직접 파일이다)
  const kind = classifyVideoUrl(candidate.url) ?? 'direct';
  return {
    id: videoIdFromUrl(candidate.url),
    url: candidate.url,
    kind,
    sources: ['dom'],
    frameId,
    width: candidate.width,
    height: candidate.height,
    durationSec: candidate.durationSec,
    posterUrl: candidate.posterUrl,
    pageTitle: candidate.pageTitle,
  };
}

const handlers: HandlerTable = {
  async VIDEOS_DETECTED(msg, sender) {
    const tabId = sender.tab?.id;
    if (tabId === undefined || tabId < 0) return undefined;
    const frameId = sender.frameId ?? 0;
    await syncDomVideos(
      tabId,
      frameId,
      msg.candidates.map((candidate) => domCandidateToVideo(candidate, frameId)),
    );
    return undefined;
  },

  async GET_VIDEOS(msg) {
    return getVideos(msg.tabId);
  },

  async DOWNLOAD_VIDEO(msg) {
    const videos = await getVideos(msg.tabId);
    const video = videos.find((v) => v.id === msg.videoId);
    if (!video) {
      return { ok: false, error: '동영상을 찾을 수 없습니다. 페이지를 다시 스캔해 주세요.' };
    }
    return downloadVideo(video, msg.tabId);
  },

  async RESCAN_TAB(msg) {
    try {
      await sendMessageToTab(msg.tabId, { type: 'RESCAN_TAB', tabId: msg.tabId });
    } catch {
      // content script가 없는 페이지(chrome:// 등) — 무시
    }
    return undefined;
  },

  async CANCEL_DOWNLOAD(msg) {
    await cancelStreamDownload(msg.tabId, msg.videoId);
    return undefined;
  },

  // 아래 셋은 offscreen 문서가 보낸다 (streamJobs.ts에 로직)
  async STREAM_JOB_PROGRESS(msg) {
    await handleStreamProgress(msg.job, msg.phase, msg.progress);
    return undefined;
  },

  async STREAM_JOB_COMPLETE(msg) {
    await handleStreamComplete(msg.job, msg.blobUrl, msg.filename);
    return undefined;
  },

  async STREAM_JOB_FAILED(msg) {
    await handleStreamFailed(msg.job, msg.error);
    return undefined;
  },
};

/**
 * 핸들러가 실패했을 때도 ResponseMap 계약에 맞는 값을 응답한다.
 * undefined를 보내면 팝업이 result.ok / videos.length 접근에서 죽는다.
 */
const errorFallbacks: { [T in MessageType]: (error: string) => ResponseMap[T] } = {
  VIDEOS_DETECTED: () => undefined,
  GET_VIDEOS: () => [],
  DOWNLOAD_VIDEO: (error) => ({ ok: false, error }),
  RESCAN_TAB: () => undefined,
  CANCEL_DOWNLOAD: () => undefined,
  STREAM_JOB_PROGRESS: () => undefined,
  STREAM_JOB_COMPLETE: () => undefined,
  STREAM_JOB_FAILED: () => undefined,
};

/** onMessage 리스너를 등록한다. 반드시 service worker top-level에서 호출할 것. */
export function registerMessageRouter(): void {
  chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
    const handler = handlers[message.type] as Handler<typeof message.type> | undefined;
    if (!handler) return false;

    handler(message, sender).then(sendResponse, (error: unknown) => {
      console.error(`[messageRouter] ${message.type} 처리 실패:`, error);
      const describe = error instanceof Error ? error.message : String(error);
      sendResponse(errorFallbacks[message.type](describe));
    });
    // 비동기 응답을 위해 채널을 열어둔다
    return true;
  });
}
