import type { DetectedVideo, StreamDownloadState, VideoKind } from '@shared/types';
import { isDownloadableKind, urlBasename } from '@shared/urlUtils';

import { formatBytes, formatDuration } from './format';

export interface VideoListCallbacks {
  onDownload(videoId: string): void;
  onCancel(videoId: string): void;
}

const KIND_LABELS: Record<Exclude<VideoKind, 'direct'>, string> = {
  blob: '스트리밍 동영상 — 재생하면 아래에 다운로드 가능한 스트림 항목이 나타납니다',
  hls: 'HLS 스트림',
  dash: 'DASH 스트림',
};

const FILM_ICON =
  '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9.5 8.5v7l6-3.5-6-3.5z" fill="currentColor"/><rect x="3" y="5" width="18" height="14" rx="3" stroke="currentColor" stroke-width="1.6"/></svg>';

const SEARCH_ICON =
  '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" stroke="currentColor" stroke-width="1.8"/><path d="M15 15l5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

function videoDisplayName(video: DetectedVideo): string {
  if (video.kind === 'blob') {
    return video.pageTitle || '스트리밍 동영상';
  }
  return urlBasename(video.url) ?? video.url;
}

function metaChips(video: DetectedVideo): string[] {
  const chips: string[] = [];
  if (video.width && video.height) chips.push(`${video.width}×${video.height}`);
  if (video.durationSec) chips.push(formatDuration(video.durationSec));
  if (video.sizeBytes) chips.push(formatBytes(video.sizeBytes));
  if (video.mimeType) chips.push(video.mimeType);
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
      return '준비 중…';
    case 'downloading':
      return `다운로드 중 ${percent}%`;
    case 'muxing':
      return percent > 0 ? `변환 중 ${percent}%` : '변환 중…';
    case 'saving':
      return '저장 중…';
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
    badge.textContent = KIND_LABELS[video.kind];
    info.appendChild(badge);
  }

  if (streamState?.error) {
    const errorLine = document.createElement('div');
    errorLine.className = 'video-error';
    errorLine.textContent = streamState.error;
    info.appendChild(errorLine);
  }

  const streamActive = streamState !== undefined && streamState.error === undefined;

  const button = document.createElement('button');
  button.className = 'download-button';
  if (streamActive) {
    button.textContent = streamButtonLabel(streamState);
  } else {
    button.textContent = isDownloading ? '다운로드 중…' : '다운로드';
  }
  button.disabled = !isDownloadableKind(video.kind) || isDownloading || streamActive;
  button.addEventListener('click', () => callbacks.onDownload(video.id));

  const actions = document.createElement('div');
  actions.className = 'video-actions';
  actions.appendChild(button);

  if (streamActive) {
    const cancel = document.createElement('button');
    cancel.className = 'cancel-button';
    cancel.textContent = '취소';
    cancel.addEventListener('click', () => callbacks.onCancel(video.id));
    actions.appendChild(cancel);
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
  title.textContent = '탐지된 동영상이 없습니다';

  const hint = document.createElement('p');
  hint.className = 'empty-hint';
  hint.textContent = '페이지에서 동영상을 재생하면 탐지될 수 있어요. 위의 "다시 스캔"도 시도해 보세요.';

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
  container.replaceChildren();

  if (videos.length === 0) {
    renderEmptyState(container);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'video-list';
  for (const video of videos) {
    list.appendChild(
      renderItem(video, callbacks, inFlightIds.has(video.id), streamStates[video.id]),
    );
  }
  container.appendChild(list);
}
