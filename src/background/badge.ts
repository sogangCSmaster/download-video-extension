import { tabIdFromStorageKey } from '@shared/storageKeys';
import type { DetectedVideo } from '@shared/types';

/**
 * storage.session 변경을 구독해 탭별 탐지 개수를 액션 배지에 표시한다.
 * 반드시 top-level에서 호출할 것.
 */
export function registerBadge(): void {
  chrome.storage.session.onChanged.addListener((changes) => {
    for (const [key, change] of Object.entries(changes)) {
      const tabId = tabIdFromStorageKey(key);
      if (tabId === null) continue;

      const videos = (change.newValue as DetectedVideo[] | undefined) ?? [];
      void chrome.action
        .setBadgeText({ tabId, text: videos.length > 0 ? String(videos.length) : '' })
        .catch(() => {
          // 탭이 이미 닫힌 경우 등 — 무시
        });
    }
  });
}
