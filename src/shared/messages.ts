import type {
  DetectedVideo,
  DomVideoCandidate,
  StreamJobRef,
  StreamPhase,
} from './types';

/** background(service worker)가 처리하는 모든 메시지의 discriminated union. */
export type Message =
  | { type: 'VIDEOS_DETECTED'; candidates: DomVideoCandidate[] } // content → bg (탭은 sender.tab.id로 식별)
  | { type: 'GET_VIDEOS'; tabId: number } // popup → bg
  | { type: 'DOWNLOAD_VIDEO'; tabId: number; videoId: string } // popup → bg
  | { type: 'RESCAN_TAB'; tabId: number } // popup → bg → content
  | { type: 'CANCEL_DOWNLOAD'; tabId: number; videoId: string } // popup → bg
  | { type: 'STREAM_JOB_PROGRESS'; job: StreamJobRef; phase: StreamPhase; progress: number } // offscreen → bg
  | { type: 'STREAM_JOB_COMPLETE'; job: StreamJobRef; blobUrl: string; filename: string } // offscreen → bg
  | { type: 'STREAM_JOB_FAILED'; job: StreamJobRef; error: string }; // offscreen → bg

export type MessageType = Message['type'];

/** 스트림 다운로드는 chrome.downloads가 나중에 시작되므로 downloadId가 없을 수 있다. */
export type DownloadResult = { ok: true; downloadId?: number } | { ok: false; error: string };

/** 메시지 타입별 응답 타입 매핑. */
export interface ResponseMap {
  VIDEOS_DETECTED: undefined;
  GET_VIDEOS: DetectedVideo[];
  DOWNLOAD_VIDEO: DownloadResult;
  RESCAN_TAB: undefined;
  CANCEL_DOWNLOAD: undefined;
  STREAM_JOB_PROGRESS: undefined;
  STREAM_JOB_COMPLETE: undefined;
  STREAM_JOB_FAILED: undefined;
}

export type MessageOf<T extends MessageType> = Extract<Message, { type: T }>;

/** background로 타입 안전하게 메시지를 보낸다 (content/popup/offscreen에서 사용). */
export function sendMessage<T extends MessageType>(msg: MessageOf<T>): Promise<ResponseMap[T]> {
  return chrome.runtime.sendMessage(msg);
}

/** 특정 탭의 content script로 메시지를 보낸다 (background에서 사용). */
export function sendMessageToTab<T extends MessageType>(
  tabId: number,
  msg: MessageOf<T>,
): Promise<ResponseMap[T]> {
  return chrome.tabs.sendMessage(tabId, msg);
}

/**
 * offscreen 문서가 처리하는 메시지의 별도 union.
 * SW의 라우터와 offscreen 리스너가 서로의 타입에 응답하지 않도록 분리한다
 * (runtime.onMessage는 확장 내 모든 컨텍스트에 브로드캐스트되므로, 각 리스너는
 * 자신의 union에 없는 타입에 대해 false를 반환해 sendResponse 경쟁을 피한다).
 */
export type OffscreenMessage =
  | { type: 'OFFSCREEN_START_JOB'; job: StreamJobRef; video: DetectedVideo } // bg → offscreen
  | { type: 'OFFSCREEN_CANCEL_JOB'; jobId: string } // bg → offscreen
  | { type: 'OFFSCREEN_RELEASE_BLOB'; blobUrl: string } // bg → offscreen
  | { type: 'OFFSCREEN_STATUS' }; // bg → offscreen (잡/blob 잔여 수 조회)

export type OffscreenMessageType = OffscreenMessage['type'];

export interface OffscreenResponseMap {
  OFFSCREEN_START_JOB: { ok: boolean };
  OFFSCREEN_CANCEL_JOB: undefined;
  /** active: 아직 진행 중인 잡 + 미해제 blob 수. 0이면 SW가 offscreen 문서를 닫아도 된다. */
  OFFSCREEN_RELEASE_BLOB: { active: number };
  OFFSCREEN_STATUS: { active: number };
}

export type OffscreenMessageOf<T extends OffscreenMessageType> = Extract<
  OffscreenMessage,
  { type: T }
>;

/** offscreen 문서로 타입 안전하게 메시지를 보낸다 (background에서 사용). */
export function sendToOffscreen<T extends OffscreenMessageType>(
  msg: OffscreenMessageOf<T>,
): Promise<OffscreenResponseMap[T]> {
  return chrome.runtime.sendMessage(msg);
}
