/** 동영상 URL의 종류. hls/dash는 1단계에서 다운로드 미지원이지만 분류는 해둔다 (2단계 확장 대비). */
export type VideoKind = 'direct' | 'blob' | 'hls' | 'dash';

/** 이 동영상을 어떤 경로로 탐지했는지. */
export type DetectionSource = 'dom' | 'network';

/** background가 관리하는 탐지된 동영상의 최종 형태. */
export interface DetectedVideo {
  /** 정규화된 URL 기반 dedupe 키 */
  id: string;
  url: string;
  kind: VideoKind;
  sources: DetectionSource[];
  /** DOM 탐지 시 보고한 프레임 (프레임별 제거 정합에 사용) */
  frameId?: number;
  mimeType?: string;
  /** 네트워크 탐지 시 Content-Length */
  sizeBytes?: number;
  width?: number;
  height?: number;
  durationSec?: number;
  /** <video poster>가 있으면 팝업 썸네일로 사용 */
  posterUrl?: string;
  pageTitle?: string;
}

/** content script가 DOM에서 수집해 background로 보내는 원시 후보. */
export interface DomVideoCandidate {
  url: string;
  width?: number;
  height?: number;
  durationSec?: number;
  posterUrl?: string;
  pageTitle: string;
}
