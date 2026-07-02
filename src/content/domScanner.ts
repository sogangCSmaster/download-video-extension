import type { DomVideoCandidate } from '@shared/types';

function candidateUrls(video: HTMLVideoElement): string[] {
  const urls = new Set<string>();
  // currentSrc가 실제 재생 중인 소스 (source 태그 선택 결과 반영)
  if (video.currentSrc) urls.add(video.currentSrc);
  if (video.src) urls.add(video.src);
  for (const source of video.querySelectorAll('source')) {
    if (source.src) urls.add(source.src);
  }
  return [...urls].filter((url) => /^(https?|blob):/.test(url));
}

/** 문서의 <video> 요소들에서 다운로드 후보를 수집한다. */
export function scanForVideos(doc: Document): DomVideoCandidate[] {
  const pageTitle = doc.title;
  const candidates: DomVideoCandidate[] = [];

  for (const video of doc.querySelectorAll('video')) {
    for (const url of candidateUrls(video)) {
      candidates.push({
        url,
        width: video.videoWidth || undefined,
        height: video.videoHeight || undefined,
        durationSec: Number.isFinite(video.duration) ? video.duration : undefined,
        posterUrl: video.poster || undefined,
        pageTitle,
      });
    }
  }
  return candidates;
}
