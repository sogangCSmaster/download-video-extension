import { StreamError } from '@shared/streaming/streamErrors';

/** 다운로드할 세그먼트 하나. range는 HTTP Range 헤더 값("123-456"). */
export interface FetchTask {
  url: string;
  range?: string;
  /** 받은 데이터에 적용할 후처리 (예: AES-128 복호화) */
  transform?: (data: Uint8Array) => Promise<Uint8Array>;
}

/** 여러 트랙이 하나의 총량 한도를 공유하기 위한 카운터. */
export interface ByteBudget {
  usedBytes: number;
  maxBytes: number;
}

export interface FetchAllOptions {
  signal: AbortSignal;
  budget: ByteBudget;
  onProgress?: (completed: number, total: number) => void;
  concurrency?: number;
}

const RETRY_DELAYS_MS = [1000, 3000];

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason instanceof Error ? signal.reason : new StreamError('cancelled'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function fetchOnce(task: FetchTask, signal: AbortSignal): Promise<Uint8Array> {
  const headers: Record<string, string> = {};
  if (task.range) headers['Range'] = `bytes=${task.range}`;
  const response = await fetch(task.url, { headers, signal, credentials: 'omit' });
  if (!response.ok) {
    throw new StreamError('fetch', `HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function fetchWithRetry(task: FetchTask, signal: AbortSignal): Promise<Uint8Array> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetchOnce(task, signal);
    } catch (error) {
      if (signal.aborted) throw error;
      const retryDelay = RETRY_DELAYS_MS[attempt];
      if (retryDelay === undefined) throw error;
      await delay(retryDelay, signal);
    }
  }
}

/**
 * 세그먼트들을 제한된 동시성(기본 4)으로 받되 결과는 원래 순서를 유지한다.
 * 총 바이트가 budget.maxBytes를 넘으면 StreamError('too-large')를 던진다.
 */
export async function fetchAllSegments(
  tasks: FetchTask[],
  options: FetchAllOptions,
): Promise<Uint8Array[]> {
  const { signal, budget, onProgress, concurrency = 4 } = options;
  const results = new Array<Uint8Array>(tasks.length);
  let nextIndex = 0;
  let completed = 0;
  // 한 워커가 실패하면 나머지 워커도 다음 세그먼트를 받지 않게 한다
  let failed = false;

  async function worker(): Promise<void> {
    while (true) {
      if (failed) return;
      if (signal.aborted) throw new StreamError('cancelled');
      const index = nextIndex++;
      const task = tasks[index];
      if (task === undefined) return;

      try {
        const raw = await fetchWithRetry(task, signal);
        const data = task.transform ? await task.transform(raw) : raw;

        budget.usedBytes += data.byteLength;
        if (budget.usedBytes > budget.maxBytes) {
          throw new StreamError('too-large');
        }
        results[index] = data;
      } catch (error) {
        failed = true;
        throw error;
      }
      completed += 1;
      onProgress?.(completed, tasks.length);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/** Uint8Array 목록을 하나로 이어붙인다. */
export function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/** 텍스트 자원(매니페스트)을 받아온다. */
export async function fetchText(url: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(url, { signal, credentials: 'omit' });
  if (!response.ok) {
    throw new StreamError('fetch', `HTTP ${response.status}`);
  }
  return response.text();
}
