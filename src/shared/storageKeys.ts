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

const DOWNLOAD_STATE_PREFIX = 'dl:';

/**
 * 탭별 스트림 다운로드 진행 상태(Record<videoId, StreamDownloadState>)의 storage.session 키.
 * badge.ts의 tabIdFromStorageKey는 'videos:' 접두사만 인식하므로 배지에는 영향이 없다.
 */
export function downloadStateKeyForTab(tabId: number): string {
  return `${DOWNLOAD_STATE_PREFIX}${tabId}`;
}

/**
 * downloadId → blob URL 매핑(Record<string, { blobUrl, tabId, videoId }>)의 storage.session 키.
 * downloads.onChanged 시점에 SW가 재기동됐어도 revoke할 blob을 찾을 수 있게 영속화한다.
 */
export const DOWNLOAD_BLOBS_KEY = 'dl-blobs';
