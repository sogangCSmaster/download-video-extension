const KEY_PREFIX = 'videos:';

/** 탭별 동영상 목록의 storage.session 키. background(쓰기)와 popup(변경 감지)이 공유한다. */
export function storageKeyForTab(tabId: number): string {
  return `${KEY_PREFIX}${tabId}`;
}

/** storage 키에서 탭 id를 복원한다. 이 스킴의 키가 아니면 null. */
export function tabIdFromStorageKey(key: string): number | null {
  if (!key.startsWith(KEY_PREFIX)) return null;
  const tabId = Number(key.slice(KEY_PREFIX.length));
  return Number.isInteger(tabId) ? tabId : null;
}
