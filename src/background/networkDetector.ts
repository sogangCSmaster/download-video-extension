import { classifyVideoUrl, parseMimeType, videoIdFromUrl } from '@shared/urlUtils';
import type { DetectedVideo } from '@shared/types';

import { upsertVideos } from './videoStore';

/**
 * 이미 저장한 (tabId, videoId) 조합.
 * 재생 중에는 같은 URL로 range 요청이 수십 건씩 발생하므로,
 * 매 응답마다 storage get→set 왕복과 onChanged 연쇄가 생기지 않게 조기 차단한다.
 * SW 재기동 시 비워지지만 그 경우 upsert가 병합으로 흡수하므로 무해하다.
 */
const seenByTab = new Map<number, Set<string>>();

/** 탭 초기화 시 중복 차단 기록도 함께 비운다 (tabLifecycle에서 호출). */
export function forgetTab(tabId: number): void {
  seenByTab.delete(tabId);
}

function headerValue(
  headers: chrome.webRequest.HttpHeader[] | undefined,
  name: string,
): string | undefined {
  return headers?.find((h) => h.name.toLowerCase() === name)?.value;
}

async function handleMediaResponse(
  details: chrome.webRequest.OnResponseStartedDetails,
): Promise<void> {
  // 어떤 탭에서 발생했는지 모르는 요청(탭 없음: -1)은 목록에 연결할 수 없다
  if (details.tabId < 0) return;

  const id = videoIdFromUrl(details.url);
  const seen = seenByTab.get(details.tabId);
  if (seen?.has(id)) return;

  const mimeType = parseMimeType(headerValue(details.responseHeaders, 'content-type'));
  const kind = classifyVideoUrl(details.url, mimeType);

  // hls/dash는 1단계에서 다운로드 미지원 — 저장하지 않는다 (2단계에서 이 분기를 확장)
  if (kind !== 'direct') return;

  if (seen) {
    seen.add(id);
  } else {
    seenByTab.set(details.tabId, new Set([id]));
  }

  const contentLength = headerValue(details.responseHeaders, 'content-length');
  const sizeBytes = contentLength ? Number(contentLength) : undefined;

  const video: DetectedVideo = {
    id,
    url: details.url,
    kind,
    sources: ['network'],
    mimeType,
    sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : undefined,
  };

  await upsertVideos(details.tabId, [video]);
}

/** webRequest 관찰 리스너를 등록한다. 반드시 service worker top-level에서 호출할 것. */
export function registerNetworkDetector(): void {
  chrome.webRequest.onResponseStarted.addListener(
    (details) => {
      void handleMediaResponse(details);
    },
    { urls: ['<all_urls>'], types: ['media'] },
    ['responseHeaders'],
  );
}
