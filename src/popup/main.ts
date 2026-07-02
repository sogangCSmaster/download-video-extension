import { sendMessage } from '@shared/messages';
import { storageKeyForTab } from '@shared/storageKeys';
import type { DetectedVideo } from '@shared/types';

import { renderVideoList } from './videoList';

function requireElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`popup: #${id} 요소가 없습니다`);
  return el as T;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function main(): Promise<void> {
  const listContainer = requireElement<HTMLDivElement>('list-container');
  const rescanButton = requireElement<HTMLButtonElement>('rescan-button');
  const statusEl = requireElement<HTMLParagraphElement>('status');
  const countEl = requireElement<HTMLSpanElement>('video-count');

  const foundTabId = await activeTabId();
  if (foundTabId === undefined) {
    statusEl.textContent = '활성 탭을 찾을 수 없습니다.';
    return;
  }
  const tabId = foundTabId;

  let currentVideos: DetectedVideo[] = [];
  // 진행 중인 다운로드 id. 재렌더가 일어나도 이 집합 기준으로 버튼을 비활성화해
  // 목록 갱신이 중복 다운로드를 허용하는 일이 없게 한다.
  const inFlightDownloads = new Set<string>();

  function showStatus(text: string, isError = false): void {
    statusEl.textContent = text;
    statusEl.classList.toggle('error', isError);
  }

  function render(): void {
    countEl.hidden = currentVideos.length === 0;
    countEl.textContent = String(currentVideos.length);
    renderVideoList(listContainer, currentVideos, { onDownload }, inFlightDownloads);
  }

  async function refresh(): Promise<void> {
    currentVideos = await sendMessage({ type: 'GET_VIDEOS', tabId });
    render();
  }

  async function safeRefresh(): Promise<void> {
    try {
      await refresh();
    } catch (error) {
      showStatus(`목록을 불러오지 못했습니다: ${describeError(error)}`, true);
    }
  }

  function onDownload(videoId: string): void {
    if (inFlightDownloads.has(videoId)) return;
    void (async () => {
      inFlightDownloads.add(videoId);
      render();
      showStatus('다운로드 시작 중…');
      try {
        const result = await sendMessage({
          type: 'DOWNLOAD_VIDEO',
          tabId,
          videoId,
        });
        if (result.ok) {
          showStatus('다운로드를 시작했습니다.');
        } else {
          showStatus(`다운로드 실패: ${result.error}`, true);
        }
      } catch (error) {
        showStatus(`다운로드 실패: ${describeError(error)}`, true);
      } finally {
        inFlightDownloads.delete(videoId);
        render();
      }
    })();
  }

  rescanButton.addEventListener('click', () => {
    void (async () => {
      showStatus('다시 스캔 중…');
      try {
        await sendMessage({ type: 'RESCAN_TAB', tabId });
        await refresh();
        showStatus('');
      } catch (error) {
        showStatus(`스캔 실패: ${describeError(error)}`, true);
      }
    })();
  });

  // 팝업이 열려 있는 동안 새 동영상이 탐지되면 실시간 갱신
  chrome.storage.session.onChanged.addListener((changes) => {
    if (storageKeyForTab(tabId) in changes) {
      void safeRefresh();
    }
  });

  await safeRefresh();
}

void main();
