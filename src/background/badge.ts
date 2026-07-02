import { tabIdFromStorageKey } from '@shared/storageKeys';
import type { DetectedVideo } from '@shared/types';
import { isDownloadableKind } from '@shared/urlUtils';

/**
 * storage.session 변경을 구독해 탭별 탐지 개수를 액션 배지에 표시한다.
 * blob 안내 항목은 받을 수 있는 게 아니므로 개수에서 제외한다 (팝업 카운트와 동일 기준).
 * 반드시 top-level에서 호출할 것.
 */
export function registerBadge(): void {
  chrome.storage.session.onChanged.addListener((changes) => {
    for (const [key, change] of Object.entries(changes)) {
      const tabId = tabIdFromStorageKey(key);
      if (tabId === null) continue;

      const videos = (change.newValue as DetectedVideo[] | undefined) ?? [];
      const count = videos.filter((v) => isDownloadableKind(v.kind)).length;
      void chrome.action
        .setBadgeText({ tabId, text: count > 0 ? String(count) : '' })
        .catch(() => {
          // 탭이 이미 닫힌 경우 등 — 무시
        });
    }
  });
}
