import type { DashTrack } from '@shared/streaming/dashMpd';
import { parseMpd, selectRepresentations } from '@shared/streaming/dashMpd';
import { StreamError } from '@shared/streaming/streamErrors';

import type { ByteBudget, FetchTask } from '../segmentFetcher';
import { concatBytes, fetchAllSegments, fetchText } from '../segmentFetcher';

export interface DashDownloadResult {
  /** init+세그먼트를 이어붙인 fMP4 트랙 */
  video?: Uint8Array;
  audio?: Uint8Array;
}

async function downloadTrack(
  track: DashTrack,
  signal: AbortSignal,
  budget: ByteBudget,
  onProgress: (done: number, total: number) => void,
): Promise<Uint8Array> {
  const tasks: FetchTask[] = [];
  if (track.init) tasks.push({ url: track.init.url, range: track.init.range });
  for (const segment of track.segments) {
    tasks.push({ url: segment.url, range: segment.range });
  }
  const chunks = await fetchAllSegments(tasks, { signal, budget, onProgress });
  return concatBytes(chunks);
}

/**
 * DASH 스트림을 내려받는다. 최고 대역폭의 비디오/오디오 representation을 골라
 * 각 트랙을 fMP4 연결본으로 만든다 (mux는 jobRunner에서 ffmpeg으로).
 */
export async function downloadDash(
  url: string,
  signal: AbortSignal,
  budget: ByteBudget,
  onProgress: (fraction: number) => void,
): Promise<DashDownloadResult> {
  const manifest = parseMpd(await fetchText(url, signal), url);
  const { video, audio } = selectRepresentations(manifest);
  if (!video && !audio) throw new StreamError('unsupported', 'no tracks');

  // 트랙별 진행률을 세그먼트 수로 가중 합산한다
  const totals = { video: video ? video.segments.length + 1 : 0, audio: audio ? audio.segments.length + 1 : 0 };
  const done = { video: 0, audio: 0 };
  const report = () => {
    const total = totals.video + totals.audio;
    if (total > 0) onProgress((done.video + done.audio) / total);
  };

  const [videoData, audioData] = await Promise.all([
    video
      ? downloadTrack(video, signal, budget, (completed) => {
          done.video = completed;
          report();
        })
      : Promise.resolve(undefined),
    audio
      ? downloadTrack(audio, signal, budget, (completed) => {
          done.audio = completed;
          report();
        })
      : Promise.resolve(undefined),
  ]);

  return { video: videoData, audio: audioData };
}
