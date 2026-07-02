import type { MessageKey } from '../i18n';
import { t } from '../i18n';

/**
 * 스트림 다운로드에서 발생하는 예상 가능한 실패의 타입드 오류.
 * Error.message는 디버깅용 기술 문자열이고, 사용자에게 보여줄 지역화 메시지는
 * streamErrorMessage()가 chrome.i18n으로 만든다 (순수 파서 테스트가 chrome에
 * 의존하지 않도록 생성 시점에는 지역화하지 않는다).
 */

export type StreamErrorCode = 'live' | 'drm' | 'too-large' | 'fetch' | 'unsupported' | 'cancelled';

const MESSAGE_KEYS: Record<StreamErrorCode, MessageKey> = {
  live: 'streamErrorLive',
  drm: 'streamErrorDrm',
  'too-large': 'streamErrorTooLarge',
  fetch: 'streamErrorFetch',
  unsupported: 'streamErrorUnsupported',
  cancelled: 'streamErrorCancelled',
};

export class StreamError extends Error {
  readonly code: StreamErrorCode;
  readonly detail?: string;

  constructor(code: StreamErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'StreamError';
    this.code = code;
    this.detail = detail;
  }
}

/** 임의의 throw 값을 사용자에게 보여줄 지역화 메시지로 바꾼다 (확장 컨텍스트 전용). */
export function streamErrorMessage(error: unknown): string {
  if (error instanceof StreamError) {
    const base = t(MESSAGE_KEYS[error.code]);
    return error.detail ? `${base} (${error.detail})` : base;
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return t('streamErrorCancelled');
  }
  const detail = error instanceof Error ? error.message : String(error);
  return t('streamErrorGeneric', detail);
}
