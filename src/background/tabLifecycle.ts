import { forgetTab } from './networkDetector';
import { cancelTabStreamDownloads } from './streamJobs';
import { clearTab } from './videoStore';

function resetTab(tabId: number): void {
  forgetTab(tabId);
  void clearTab(tabId);
  // 진행 중인 스트림 다운로드 잡도 취소해 offscreen 메모리를 잡아두지 않게 한다
  void cancelTabStreamDownloads(tabId);
}

/** 탭 닫힘/페이지 로드 시작 시 해당 탭의 목록을 초기화한다. 반드시 top-level에서 호출할 것. */
export function registerTabLifecycle(): void {
  chrome.tabs.onRemoved.addListener((tabId) => {
    resetTab(tabId);
  });

  // status 'loading'은 실제 페이지 로드(새 URL 이동·같은 URL 새로고침 모두)에서만 온다.
  // changeInfo.url은 같은 URL 새로고침(F5)에는 포함되지 않으므로 조건에 쓰지 않는다.
  // SPA 라우팅은 status 변화 없이 url만 갱신되므로 여기 잡히지 않으며 의도된 동작
  // (같은 앱 안에서는 이전에 탐지한 동영상이 여전히 유효할 수 있음).
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') {
      resetTab(tabId);
    }
  });
}
