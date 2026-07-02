/**
 * 스트림 다운로드에서 발생하는 예상 가능한 실패의 타입드 오류.
 * 사용자에게 보여줄 한국어 메시지를 한곳에서 관리한다.
 */

export type StreamErrorCode = 'live' | 'drm' | 'too-large' | 'fetch' | 'unsupported' | 'cancelled';

const MESSAGES: Record<StreamErrorCode, string> = {
  live: '실시간 스트림은 다운로드할 수 없습니다.',
  drm: 'DRM으로 보호된 스트림은 다운로드할 수 없습니다.',
  'too-large': '동영상이 너무 커서 다운로드할 수 없습니다 (최대 약 1GB).',
  fetch: '스트림 다운로드 중 네트워크 오류가 발생했습니다.',
  unsupported: '지원하지 않는 스트림 형식입니다.',
  cancelled: '다운로드가 취소되었습니다.',
};

export class StreamError extends Error {
  readonly code: StreamErrorCode;

  constructor(code: StreamErrorCode, detail?: string) {
    super(detail ? `${MESSAGES[code]} (${detail})` : MESSAGES[code]);
    this.name = 'StreamError';
    this.code = code;
  }
}

/** 임의의 throw 값을 사용자에게 보여줄 한국어 메시지로 바꾼다. */
export function streamErrorMessage(error: unknown): string {
  if (error instanceof StreamError) return error.message;
  if (error instanceof DOMException && error.name === 'AbortError') {
    return MESSAGES.cancelled;
  }
  const detail = error instanceof Error ? error.message : String(error);
  return `스트림 다운로드 중 오류가 발생했습니다: ${detail}`;
}
