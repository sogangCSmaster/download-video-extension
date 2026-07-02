/**
 * offscreen 문서 수명 관리.
 * MV3 service worker에는 DOMParser·URL.createObjectURL·Worker가 없어
 * 스트림 조립과 ffmpeg.wasm 실행을 offscreen 문서에서 수행한다.
 */

const OFFSCREEN_URL = 'src/offscreen/index.html';

/** 확인+생성 전체를 직렬화해 createDocument 중복 호출 경쟁을 막는다. */
let ensurePromise: Promise<void> | null = null;

export function ensureOffscreenDocument(): Promise<void> {
  ensurePromise ??= (async () => {
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
      justification: 'HLS/DASH 스트림 세그먼트를 조립하고 ffmpeg.wasm으로 MP4로 변환합니다.',
    });
  })().finally(() => {
    ensurePromise = null;
  });
  return ensurePromise;
}

/** 남은 잡/blob이 없을 때 호출한다 (OFFSCREEN_RELEASE_BLOB 응답의 active === 0). */
export async function closeOffscreenDocument(): Promise<void> {
  try {
    await chrome.offscreen.closeDocument();
  } catch {
    // 이미 닫혀 있으면 무시
  }
}
