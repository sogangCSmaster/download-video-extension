/** 동영상 URL의 종류. direct/hls/dash는 다운로드 가능, blob(MSE)은 페이지 밖에서 접근 불가라 미지원. */
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

/** 스트림 다운로드 작업의 진행 단계. */
export type StreamPhase = 'preparing' | 'downloading' | 'muxing' | 'saving';

/**
 * 진행 중인 스트림 다운로드의 상태. storage.session `dl:<tabId>` 키에
 * Record<videoId, StreamDownloadState>로 저장되어 팝업이 닫혔다 열려도 복원된다.
 */
export interface StreamDownloadState {
  videoId: string;
  jobId: string;
  phase: StreamPhase;
  /** 0..1 — downloading/muxing 단계에서만 의미 있음 */
  progress: number;
  /** 설정되면 작업 실패 상태 (버튼 재활성화 + 메시지 표시) */
  error?: string;
  updatedAt: number;
}

/** offscreen→SW 메시지가 자체적으로 갖고 다니는 작업 식별 정보 (SW는 메모리 상태를 두지 않는다). */
export interface StreamJobRef {
  jobId: string;
  tabId: number;
  videoId: string;
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
