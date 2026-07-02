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

/**
 * 한도는 offscreen 문서 전체(동시 잡 합산) 기준이다 — 잡마다 별도 한도면
 * 동시 다운로드 시 문서가 OOM으로 죽을 수 있다. 각 잡은 자기가 더한 몫을
 * 기억했다가 종료 시 반환한다.
 */
let totalUsedBytes = 0;

interface JobBudget extends ByteBudget {
  release(): void;
}

function createJobBudget(): JobBudget {
  let ownBytes = 0;
  return {
    maxBytes: MAX_STREAM_BYTES,
    get usedBytes() {
      return totalUsedBytes;
    },
    set usedBytes(value: number) {
      ownBytes += value - totalUsedBytes;
      totalUsedBytes = value;
    },
    release() {
      totalUsedBytes -= ownBytes;
      ownBytes = 0;
    },
  };
}

export type ProgressReporter = (phase: StreamPhase, progress: number) => void;

export interface JobOutput {
  blobUrl: string;
  filename: string;
}

async function assembleMp4(
  video: DetectedVideo,
  signal: AbortSignal,
  report: ProgressReporter,
  budget: ByteBudget,
): Promise<Uint8Array> {
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
    if (!only) throw new StreamError('unsupported', 'no tracks');
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
  const budget = createJobBudget();
  let mp4: Uint8Array;
  try {
    mp4 = await assembleMp4(video, signal, report, budget);
  } finally {
    // 잡이 끝나면(성공·실패 무관) 이 잡이 점유한 총량을 반환한다
    budget.release();
  }
  if (signal.aborted) throw new StreamError('cancelled');

  const blobUrl = URL.createObjectURL(new Blob([mp4 as BlobPart], { type: 'video/mp4' }));
  return {
    blobUrl,
    filename: buildStreamDownloadFilename({ url: video.url, pageTitle: video.pageTitle }),
  };
}
