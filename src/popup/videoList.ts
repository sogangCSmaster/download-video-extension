import type { MessageKey } from '@shared/i18n';
import { t } from '@shared/i18n';
import type { DetectedVideo, StreamDownloadState, VideoKind } from '@shared/types';
import { isDownloadableKind, urlBasename } from '@shared/urlUtils';

import { formatBytes, formatDuration } from './format';

export interface VideoListCallbacks {
  onDownload(videoId: string): void;
  onCancel(videoId: string): void;
}

const KIND_LABEL_KEYS: Record<Exclude<VideoKind, 'direct'>, MessageKey> = {
  blob: 'kindBlobHint',
  hls: 'kindHls',
  dash: 'kindDash',
};

const FILM_ICON =
  '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9.5 8.5v7l6-3.5-6-3.5z" fill="currentColor"/><rect x="3" y="5" width="18" height="14" rx="3" stroke="currentColor" stroke-width="1.6"/></svg>';

const SEARCH_ICON =
  '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" stroke="currentColor" stroke-width="1.8"/><path d="M15 15l5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

function videoDisplayName(video: DetectedVideo): string {
  if (video.kind === 'blob') {
    return video.pageTitle || t('streamingVideoName');
  }
  return urlBasename(video.url) ?? video.url;
}

function metaChips(video: DetectedVideo): string[] {
  const chips: string[] = [];
  if (video.width && video.height) chips.push(`${video.width}×${video.height}`);
  if (video.durationSec) chips.push(formatDuration(video.durationSec));
  // hls/dash의 sizeBytes·mimeType은 매니페스트 파일(m3u8/mpd 텍스트)의 것이라
  // 실제 영상 크기·형식과 무관하다 — 오해를 부르므로 표시하지 않는다
  const isManifest = video.kind === 'hls' || video.kind === 'dash';
  if (video.sizeBytes && !isManifest) chips.push(formatBytes(video.sizeBytes));
  if (video.mimeType && !isManifest) chips.push(video.mimeType);
  return chips;
}

function renderThumbnail(video: DetectedVideo): HTMLElement {
  const thumb = document.createElement('div');
  thumb.className = 'video-thumb';
  thumb.innerHTML = FILM_ICON;

  if (video.posterUrl) {
    const img = document.createElement('img');
    img.alt = '';
    img.addEventListener('load', () => thumb.replaceChildren(img));
    // 로드 실패 시 아이콘 플레이스홀더 유지
    img.src = video.posterUrl;
  }
  return thumb;
}

/** 진행 중인 스트림 다운로드의 버튼 문구. */
function streamButtonLabel(state: StreamDownloadState): string {
  const percent = Math.round(state.progress * 100);
  switch (state.phase) {
    case 'preparing':
      return t('phasePreparing');
    case 'downloading':
      return t('phaseDownloading', String(percent));
    case 'muxing':
      return percent > 0 ? t('phaseMuxingPercent', String(percent)) : t('phaseMuxing');
    case 'saving':
      return t('phaseSaving');
  }
}

function renderItem(
  video: DetectedVideo,
  callbacks: VideoListCallbacks,
  isDownloading: boolean,
  streamState: StreamDownloadState | undefined,
): HTMLElement {
  const item = document.createElement('li');
  item.className = 'video-item';

  const info = document.createElement('div');
  info.className = 'video-info';

  const name = document.createElement('div');
  name.className = 'video-name';
  name.textContent = videoDisplayName(video);
  name.title = video.url;
  info.appendChild(name);

  const chips = metaChips(video);
  if (chips.length > 0) {
    const meta = document.createElement('div');
    meta.className = 'video-meta';
    for (const text of chips) {
      const chip = document.createElement('span');
      chip.className = 'meta-chip';
      chip.textContent = text;
      meta.appendChild(chip);
    }
    info.appendChild(meta);
  }

  if (video.kind !== 'direct') {
    const badge = document.createElement('div');
    badge.className = 'video-badge';
    badge.textContent = t(KIND_LABEL_KEYS[video.kind]);
    info.appendChild(badge);
  }

  if (streamState?.error) {
    const errorLine = document.createElement('div');
    errorLine.className = 'video-error';
    errorLine.textContent = streamState.error;
    info.appendChild(errorLine);
  }

  const streamActive = streamState !== undefined && streamState.error === undefined;

  const actions = document.createElement('div');
  actions.className = 'video-actions';

  // blob(MSE)은 원리상 URL 다운로드가 불가 — 비활성 버튼 대신 안내 배지만 보여준다
  if (isDownloadableKind(video.kind)) {
    const button = document.createElement('button');
    button.className = 'download-button';
    if (streamActive) {
      button.textContent = streamButtonLabel(streamState);
    } else {
      button.textContent = isDownloading ? t('buttonDownloading') : t('buttonDownload');
    }
    button.disabled = isDownloading || streamActive;
    button.addEventListener('click', () => callbacks.onDownload(video.id));
    actions.appendChild(button);

    if (streamActive) {
      const cancel = document.createElement('button');
      cancel.className = 'cancel-button';
      cancel.textContent = t('buttonCancel');
      cancel.addEventListener('click', () => callbacks.onCancel(video.id));
      actions.appendChild(cancel);
    }
  }

  item.append(renderThumbnail(video), info, actions);
  return item;
}

function renderEmptyState(container: HTMLElement): void {
  const empty = document.createElement('div');
  empty.className = 'empty-state';
  empty.innerHTML = SEARCH_ICON;

  const title = document.createElement('p');
  title.className = 'empty-title';
  title.textContent = t('emptyTitle');

  const hint = document.createElement('p');
  hint.className = 'empty-hint';
  hint.textContent = t('emptyHint');

  empty.append(title, hint);
  container.appendChild(empty);
}

/** 탐지된 동영상 목록을 컨테이너에 렌더링한다. */
export function renderVideoList(
  container: HTMLElement,
  videos: DetectedVideo[],
  callbacks: VideoListCallbacks,
  inFlightIds: ReadonlySet<string>,
  streamStates: Record<string, StreamDownloadState>,
): void {
  // 진행률 갱신마다 목록을 새로 만들므로, 스크롤 위치를 보존했다가 복원한다
  const prevScrollTop = container.querySelector('.video-list')?.scrollTop ?? 0;
  container.replaceChildren();

  if (videos.length === 0) {
    renderEmptyState(container);
    return;
  }

  // 다운로드 가능한 항목을 위로, blob 안내 항목은 아래로 (그 외 순서는 탐지 순 유지)
  const ordered = [...videos].sort(
    (a, b) => Number(isDownloadableKind(b.kind)) - Number(isDownloadableKind(a.kind)),
  );

  const list = document.createElement('ul');
  list.className = 'video-list';
  for (const video of ordered) {
    list.appendChild(
      renderItem(video, callbacks, inFlightIds.has(video.id), streamStates[video.id]),
    );
  }
  container.appendChild(list);
  list.scrollTop = prevScrollTop;
}
