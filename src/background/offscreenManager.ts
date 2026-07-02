import { sendToOffscreen } from '@shared/messages';

/**
 * offscreen 문서 수명 관리.
 * MV3 service worker에는 DOMParser·URL.createObjectURL·Worker가 없어
 * 스트림 조립과 ffmpeg.wasm 실행을 offscreen 문서에서 수행한다.
 *
 * 생성(ensure)과 종료(close)가 서로 다른 비동기 체인에서 경쟁하면
 * "방금 시작한 잡이 닫히는 문서와 함께 죽는" TOCTOU가 생기므로,
 * 문서를 만지는 모든 작업을 하나의 lock으로 직렬화한다.
 */

const OFFSCREEN_URL = 'src/offscreen/index.html';

let lifecycleQueue: Promise<unknown> = Promise.resolve();

/** offscreen 생성/종료와 경쟁하면 안 되는 작업을 직렬화한다. */
export function withOffscreenLock<T>(op: () => Promise<T>): Promise<T> {
  const next = lifecycleQueue.then(op, op);
  lifecycleQueue = next.catch(() => undefined);
  return next;
}

async function ensureCreated(): Promise<void> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
  });
  if (contexts.length > 0) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: [
      'WORKERS' as chrome.offscreen.Reason, // ffmpeg.wasm 클래스 워커
      'BLOBS' as chrome.offscreen.Reason, // 결과 mp4의 URL.createObjectURL
    ],
    // Chrome 웹스토어 심사용 설명 — 지역화 대상 아님
    justification: 'Assembles HLS/DASH stream segments and converts them to MP4 with ffmpeg.wasm.',
  });
}

/**
 * 문서 보장 + op 실행을 한 임계구역에서 수행한다.
 * ensure와 메시지 전송 사이에 close가 끼어들 수 없다.
 */
export function runWithOffscreen<T>(op: () => Promise<T>): Promise<T> {
  return withOffscreenLock(async () => {
    await ensureCreated();
    return op();
  });
}

/** 남은 잡/blob이 없으면 offscreen 문서를 닫는다. 실패·취소 경로에서도 호출할 것. */
export function closeOffscreenIfIdle(): Promise<void> {
  return withOffscreenLock(async () => {
    let active: number;
    try {
      ({ active } = await sendToOffscreen({ type: 'OFFSCREEN_STATUS' }));
    } catch {
      return; // 문서가 없으면 닫을 것도 없다
    }
    if (active > 0) return;
    await chrome.offscreen.closeDocument().catch(() => undefined);
  });
}
