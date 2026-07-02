const DEBOUNCE_MS = 500;

function nodeTouchesVideo(node: Node): boolean {
  const name = node.nodeName;
  if (name === 'VIDEO' || name === 'SOURCE') return true;
  return node instanceof Element && node.querySelector('video, source') !== null;
}

/** video/source 요소와 무관한 변경(광고 회전, 이미지 lazy-load 등)은 스캔을 유발하지 않게 거른다. */
function recordsTouchVideo(records: MutationRecord[]): boolean {
  for (const record of records) {
    if (record.type === 'attributes') {
      if (nodeTouchesVideo(record.target)) return true;
      continue;
    }
    for (const nodes of [record.addedNodes, record.removedNodes]) {
      for (const node of nodes) {
        if (nodeTouchesVideo(node)) return true;
      }
    }
  }
  return false;
}

/**
 * DOM 변경을 관찰하다가 <video>/<source>에 영향을 줄 만한 변경이 있으면
 * 디바운스 후 onChange를 호출한다. SPA·lazy-load 페이지 대응.
 * 관찰은 페이지 수명 동안 유지된다 (content script와 함께 소멸).
 */
export function observeVideoChanges(onChange: () => void): void {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const observer = new MutationObserver((records) => {
    if (!recordsTouchVideo(records)) return;
    clearTimeout(timer);
    timer = setTimeout(onChange, DEBOUNCE_MS);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributeFilter: ['src'],
  });
}
