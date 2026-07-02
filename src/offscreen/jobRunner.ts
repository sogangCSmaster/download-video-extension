import { buildStreamDownloadFilename } from '@shared/filename';
import { StreamError } from '@shared/streaming/streamErrors';
import type { DetectedVideo, StreamPhase } from '@shared/types';

import { downloadDash } from './dash/dashDownloader';
import { muxAv, remuxFmp4ToMp4, remuxTsToMp4 } from './ffmpegMuxer';
import { downloadHls } from './hls/hlsDownloader';
import type { ByteBudget } from './segmentFetcher';

/**
 * 전 과정이 메모리에서 이뤄지므로(세그먼트 배열 + ffmpeg MEMFS 사본 + 출력 mp4,
 * 피크 사용량 ≈ 스트림 크기의 2.5~3배) 원본 스트림 총량을 1GiB로 제한한다.
 * 디스크 스트리밍(OPFS)은 향후 개선 과제.
 */
const MAX_STREAM_BYTES = 1024 * 1024 * 1024;

export type ProgressReporter = (phase: StreamPhase, progress: number) => void;

export interface JobOutput {
  blobUrl: string;
  filename: string;
}

async function assembleMp4(
  video: DetectedVideo,
  signal: AbortSignal,
  report: ProgressReporter,
): Promise<Uint8Array> {
  const budget: ByteBudget = { usedBytes: 0, maxBytes: MAX_STREAM_BYTES };
  const onDownload = (fraction: number) => report('downloading', fraction);
  const onMux = (fraction: number) => report('muxing', fraction);

  if (video.kind === 'hls') {
    const { video: videoTrack, audio: audioTrack } = await downloadHls(
      video.url,
      signal,
      budget,
      onDownload,
    );
    report('muxing', 0);
    if (audioTrack) return muxAv(videoTrack, audioTrack, onMux);
    if (videoTrack.container === 'mp4') return remuxFmp4ToMp4(videoTrack.data, onMux);
    return remuxTsToMp4(videoTrack.data, onMux);
  }

  if (video.kind === 'dash') {
    const { video: videoData, audio: audioData } = await downloadDash(
      video.url,
      signal,
      budget,
      onDownload,
    );
    report('muxing', 0);
    if (videoData && audioData) {
      return muxAv({ data: videoData, container: 'mp4' }, { data: audioData, container: 'mp4' }, onMux);
    }
    const only = videoData ?? audioData;
    if (!only) throw new StreamError('unsupported', '트랙 없음');
    return remuxFmp4ToMp4(only, onMux);
  }

  throw new StreamError('unsupported', `kind=${video.kind}`);
}

/**
 * 스트림 다운로드 잡 하나를 끝까지 수행해 blob URL과 파일명을 만든다.
 * blob URL의 해제는 호출측(offscreenMain)이 SW의 OFFSCREEN_RELEASE_BLOB으로 처리한다.
 */
export async function runJob(
  video: DetectedVideo,
  signal: AbortSignal,
  report: ProgressReporter,
): Promise<JobOutput> {
  report('preparing', 0);
  const mp4 = await assembleMp4(video, signal, report);
  if (signal.aborted) throw new StreamError('cancelled');

  const blobUrl = URL.createObjectURL(new Blob([mp4 as BlobPart], { type: 'video/mp4' }));
  return {
    blobUrl,
    filename: buildStreamDownloadFilename({ url: video.url, pageTitle: video.pageTitle }),
  };
}
