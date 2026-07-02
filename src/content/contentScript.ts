import type { Message } from '@shared/messages';
import { sendMessage } from '@shared/messages';
import type { DomVideoCandidate } from '@shared/types';

import { scanForVideos } from './domScanner';
import { observeVideoChanges } from './videoObserver';

let lastReportedKey = '';

function candidatesKey(candidates: DomVideoCandidate[]): string {
  return candidates
    .map((c) => c.url)
    .sort()
    .join('\n');
}

async function scanAndReport(force = false): Promise<void> {
  const candidates = scanForVideos(document);

  // 빈 목록도 보고해야 background가 사라진 동영상을 제거할 수 있다.
  // 단 최초 로드의 빈 결과는 lastReportedKey('')와 같아 아래 diff에서 걸러진다.
  const key = candidatesKey(candidates);
  if (!force && key === lastReportedKey) return;
  lastReportedKey = key;

  try {
    await sendMessage({ type: 'VIDEOS_DETECTED', candidates });
  } catch {
    // 확장 리로드 직후 등 background가 잠시 없을 수 있음 — 다음 변경 때 재시도된다
    lastReportedKey = '';
  }
}

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  if (message.type === 'RESCAN_TAB') {
    // 스캔·보고가 끝난 뒤 응답해야 팝업의 rescan→refresh가 최신 데이터를 읽는다
    scanAndReport(true).then(
      () => sendResponse(undefined),
      () => sendResponse(undefined),
    );
    return true;
  }
  return false;
});

// bfcache 복원 시 스크립트는 재실행되지 않지만 background는 이동 시점에 목록을
// 지웠으므로, 저장된 키를 버리고 강제 재보고해 상태를 다시 맞춘다.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    lastReportedKey = '';
    void scanAndReport(true);
  }
});

void scanAndReport();
observeVideoChanges(() => void scanAndReport());
