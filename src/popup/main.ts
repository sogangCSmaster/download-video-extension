import type { MessageKey } from '@shared/i18n';
import { t } from '@shared/i18n';
import { sendMessage } from '@shared/messages';
import { downloadStateKeyForTab, storageKeyForTab } from '@shared/storageKeys';
import type { DetectedVideo, StreamDownloadState } from '@shared/types';
import { isDownloadableKind } from '@shared/urlUtils';

import { renderVideoList } from './videoList';

function requireElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`popup: missing #${id} element`);
  return el as T;
}

/** index.html의 data-i18n/data-i18n-title 요소를 UI 언어 문구로 채운다. */
function localizeStaticText(): void {
  document.documentElement.lang = chrome.i18n.getUILanguage();
  document.title = t('extName');
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n as MessageKey);
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
    el.title = t(el.dataset.i18nTitle as MessageKey);
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function main(): Promise<void> {
  localizeStaticText();

  const listContainer = requireElement<HTMLDivElement>('list-container');
  const rescanButton = requireElement<HTMLButtonElement>('rescan-button');
  const statusEl = requireElement<HTMLParagraphElement>('status');
  const countEl = requireElement<HTMLSpanElement>('video-count');

  const foundTabId = await activeTabId();
  if (foundTabId === undefined) {
    statusEl.textContent = t('statusNoActiveTab');
    return;
  }
  const tabId = foundTabId;
  const downloadStateKey = downloadStateKeyForTab(tabId);

  let currentVideos: DetectedVideo[] = [];
  // 스트림 다운로드 진행 상태 — SW가 storage.session에 기록하므로
  // 팝업을 닫았다 열어도 진행률이 복원된다
  let streamStates: Record<string, StreamDownloadState> = {};
  // 진행 중인 다운로드 id. 재렌더가 일어나도 이 집합 기준으로 버튼을 비활성화해
  // 목록 갱신이 중복 다운로드를 허용하는 일이 없게 한다.
  const inFlightDownloads = new Set<string>();

  function showStatus(text: string, isError = false): void {
    statusEl.textContent = text;
    statusEl.classList.toggle('error', isError);
  }

  function render(): void {
    // blob 안내 항목은 실제 받을 수 있는 게 아니므로 개수에 세지 않는다
    const downloadableCount = currentVideos.filter((v) => isDownloadableKind(v.kind)).length;
    countEl.hidden = downloadableCount === 0;
    countEl.textContent = String(downloadableCount);
    renderVideoList(
      listContainer,
      currentVideos,
      { onDownload, onCancel },
      inFlightDownloads,
      streamStates,
    );
  }

  async function refresh(): Promise<void> {
    const [videos, stored] = await Promise.all([
      sendMessage({ type: 'GET_VIDEOS', tabId }),
      chrome.storage.session.get(downloadStateKey),
    ]);
    currentVideos = videos;
    streamStates =
      (stored[downloadStateKey] as Record<string, StreamDownloadState> | undefined) ?? {};
    render();
  }

  async function safeRefresh(): Promise<void> {
    try {
      await refresh();
    } catch (error) {
      showStatus(t('statusListLoadFailed', describeError(error)), true);
    }
  }

  function onDownload(videoId: string): void {
    if (inFlightDownloads.has(videoId)) return;
    void (async () => {
      inFlightDownloads.add(videoId);
      render();
      showStatus(t('statusStartingDownload'));
      try {
        const result = await sendMessage({
          type: 'DOWNLOAD_VIDEO',
          tabId,
          videoId,
        });
        if (result.ok) {
          showStatus(t('statusDownloadStarted'));
        } else {
          showStatus(t('statusDownloadFailed', result.error), true);
        }
      } catch (error) {
        showStatus(t('statusDownloadFailed', describeError(error)), true);
      } finally {
        inFlightDownloads.delete(videoId);
        render();
      }
    })();
  }

  function onCancel(videoId: string): void {
    void (async () => {
      try {
        await sendMessage({ type: 'CANCEL_DOWNLOAD', tabId, videoId });
        showStatus(t('statusDownloadCancelled'));
      } catch (error) {
        showStatus(t('statusCancelFailed', describeError(error)), true);
      }
    })();
  }

  rescanButton.addEventListener('click', () => {
    void (async () => {
      showStatus(t('statusRescanning'));
      try {
        await sendMessage({ type: 'RESCAN_TAB', tabId });
        await refresh();
        showStatus('');
      } catch (error) {
        showStatus(t('statusRescanFailed', describeError(error)), true);
      }
    })();
  });

  // 팝업이 열려 있는 동안 새 동영상 탐지·다운로드 진행률 변화를 실시간 반영
  chrome.storage.session.onChanged.addListener((changes) => {
    let needsRender = false;
    if (storageKeyForTab(tabId) in changes) {
      void safeRefresh();
      return;
    }
    const stateChange = changes[downloadStateKey];
    if (stateChange) {
      streamStates =
        (stateChange.newValue as Record<string, StreamDownloadState> | undefined) ?? {};
      needsRender = true;
    }
    if (needsRender) render();
  });

  await safeRefresh();
}

void main();
