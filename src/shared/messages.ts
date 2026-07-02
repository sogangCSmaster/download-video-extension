import type { DetectedVideo, DomVideoCandidate } from './types';

/** 확장 내부에서 오가는 모든 메시지의 discriminated union. */
export type Message =
  | { type: 'VIDEOS_DETECTED'; candidates: DomVideoCandidate[] } // content → bg (탭은 sender.tab.id로 식별)
  | { type: 'GET_VIDEOS'; tabId: number } // popup → bg
  | { type: 'DOWNLOAD_VIDEO'; tabId: number; videoId: string } // popup → bg
  | { type: 'RESCAN_TAB'; tabId: number }; // popup → bg → content

export type MessageType = Message['type'];

export type DownloadResult = { ok: true; downloadId: number } | { ok: false; error: string };

/** 메시지 타입별 응답 타입 매핑. */
export interface ResponseMap {
  VIDEOS_DETECTED: undefined;
  GET_VIDEOS: DetectedVideo[];
  DOWNLOAD_VIDEO: DownloadResult;
  RESCAN_TAB: undefined;
}

export type MessageOf<T extends MessageType> = Extract<Message, { type: T }>;

/** background로 타입 안전하게 메시지를 보낸다 (content/popup에서 사용). */
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
