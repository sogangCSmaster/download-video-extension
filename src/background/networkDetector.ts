import { parsePlaylist } from '@shared/streaming/hlsPlaylist';
import { classifyVideoUrl, normalizeUrl, parseMimeType, videoIdFromUrl } from '@shared/urlUtils';
import type { DetectedVideo } from '@shared/types';

import { removeVideos, upsertVideos } from './videoStore';

/**
 * 이미 저장한 (tabId, videoId) 조합.
 * 재생 중에는 같은 URL로 range 요청이 수십 건씩 발생하므로,
 * 매 응답마다 storage get→set 왕복과 onChanged 연쇄가 생기지 않게 조기 차단한다.
 * SW 재기동 시 비워지지만 그 경우 upsert가 병합으로 흡수하므로 무해하다.
 */
const seenByTab = new Map<number, Set<string>>();

/**
 * master 플레이리스트가 참조하는 variant/오디오 렌디션 URL(정규화) 집합 (탭별).
 * 재생이 시작되면 이 URL들도 네트워크에 잡히는데, master 항목 하나로 다운로드가
 * 가능하므로 별도 항목으로 만들면 같은 영상이 2~3개로 보인다 — 목록에서 제외한다.
 */
const coveredByMasterByTab = new Map<number, Set<string>>();

/** 탭 초기화 시 중복 차단 기록도 함께 비운다 (tabLifecycle에서 호출). */
export function forgetTab(tabId: number): void {
  seenByTab.delete(tabId);
  coveredByMasterByTab.delete(tabId);
}

/**
 * m3u8이 master인지 확인하고, master면 참조 URL들을 커버 목록에 기록한 뒤
 * 이미 목록에 들어간 variant 항목을 제거한다. 매니페스트는 작아서(수 KB)
 * 한 번 더 읽는 비용이 작고, seenByTab 덕에 URL당 1회만 수행된다.
 * 읽기 실패(Referer 검사 CDN의 403 등) 시에는 그대로 둔다 — 목록이 조금
 * 중복될 뿐 잘못 사라지는 것보다는 낫다.
 */
async function recordMasterCoverage(tabId: number, manifestUrl: string): Promise<void> {
  try {
    const response = await fetch(manifestUrl, {
      credentials: 'omit',
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return;
    const parsed = parsePlaylist(await response.text(), manifestUrl);
    if (parsed.kind !== 'master') return;

    const covered = coveredByMasterByTab.get(tabId) ?? new Set<string>();
    coveredByMasterByTab.set(tabId, covered);
    for (const variant of parsed.variants) covered.add(normalizeUrl(variant.url));
    for (const rendition of parsed.audioRenditions) {
      if (rendition.url) covered.add(normalizeUrl(rendition.url));
    }
    // variant가 master 파싱보다 먼저 목록에 들어간 경우를 정리한다
    await removeVideos(tabId, [...covered].map(videoIdFromUrl));
  } catch {
    // 판별 실패 — variant가 별도 항목으로 남는 것 외에 부작용 없음
  }
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
  if (kind === null || kind === 'blob') return;

  // 매니페스트(.m3u8/.mpd)는 xhr/other로 오므로 그 타입에서는 hls/dash만 수용한다.
  // direct를 media 타입으로 한정하지 않으면 fMP4/DASH의 세그먼트(.mp4/.m4s) xhr이
  // 전부 direct 항목으로 목록을 오염시킨다.
  if (details.type !== 'media' && kind === 'direct') return;

  if (seen) {
    seen.add(id);
  } else {
    seenByTab.set(details.tabId, new Set([id]));
  }

  if (kind === 'hls') {
    // 이미 목록에 있는 master가 커버하는 variant면 중복이므로 넣지 않는다
    if (coveredByMasterByTab.get(details.tabId)?.has(normalizeUrl(details.url))) return;
    // master 여부 판별은 병렬로 진행한다 — 목록 등록을 네트워크 왕복만큼 늦추지 않기 위함.
    // 그 사이에 등록된 variant는 recordMasterCoverage가 소급 제거한다.
    void recordMasterCoverage(details.tabId, details.url);
  }

  const contentLength = headerValue(details.responseHeaders, 'content-length');
  const sizeBytes = contentLength ? Number(contentLength) : undefined;

  const video: DetectedVideo = {
    id,
    url: details.url,
    kind,
    sources: ['network'],
    // 같은 프레임의 blob <video>와 짝짓기 위해 기록한다 (detectionView.collapseFrameDuplicates)
    frameId: details.frameId,
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
    // HLS/DASH 매니페스트는 대개 xmlhttprequest/other 타입으로 요청된다
    { urls: ['<all_urls>'], types: ['media', 'xmlhttprequest', 'other'] },
    ['responseHeaders'],
  );
}
