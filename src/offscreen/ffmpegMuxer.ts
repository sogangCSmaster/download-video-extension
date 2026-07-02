import { FFmpeg } from '@ffmpeg/ffmpeg';

import { StreamError } from '@shared/streaming/streamErrors';

/**
 * MV3 CSP-safe ffmpeg.wasm 로딩.
 * blob: worker가 확장 CSP에서 금지이므로 worker/core/wasm 모두
 * vite-plugin-static-copy로 dist/vendor에 복사된 chrome-extension:// URL('self')에서 로드한다.
 * (vite.config.ts, manifest.config.ts의 CSP 주석 참고)
 */
let ffmpegPromise: Promise<FFmpeg> | null = null;

function loadFFmpeg(): Promise<FFmpeg> {
  ffmpegPromise ??= (async () => {
    const ffmpeg = new FFmpeg();
    const loaded = await ffmpeg.load({
      coreURL: chrome.runtime.getURL('vendor/ffmpeg-core/ffmpeg-core.js'),
      wasmURL: chrome.runtime.getURL('vendor/ffmpeg-core/ffmpeg-core.wasm'),
      classWorkerURL: chrome.runtime.getURL('vendor/ffmpeg/worker.js'),
    });
    if (!loaded) throw new StreamError('unsupported', 'ffmpeg 로드 실패');
    return ffmpeg;
  })();
  ffmpegPromise.catch(() => {
    // 로드 실패 시 다음 시도에서 다시 로드할 수 있게 초기화
    ffmpegPromise = null;
  });
  return ffmpegPromise;
}

/**
 * ffmpeg 인스턴스는 하나뿐이고 exec은 동시에 하나만 돌 수 있으므로
 * 여러 다운로드 잡의 mux 작업을 직렬화한다.
 */
let opQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(op: (ffmpeg: FFmpeg) => Promise<T>): Promise<T> {
  const run = async () => op(await loadFFmpeg());
  const next = opQueue.then(run, run);
  opQueue = next.catch(() => undefined);
  return next;
}

export type MuxProgress = (progress: number) => void;

interface ExecOptions {
  inputs: Record<string, Uint8Array>;
  args: string[];
  output: string;
  onProgress?: MuxProgress;
}

async function execWithFiles(ffmpeg: FFmpeg, options: ExecOptions): Promise<Uint8Array> {
  const { inputs, args, output, onProgress } = options;
  const progressListener = ({ progress }: { progress: number }) => {
    // -c copy에서는 진행률이 튈 수 있으므로 0..1로 클램프
    onProgress?.(Math.min(1, Math.max(0, progress)));
  };

  const fileNames = Object.keys(inputs);
  try {
    for (const [name, data] of Object.entries(inputs)) {
      await ffmpeg.writeFile(name, data);
    }
    if (onProgress) ffmpeg.on('progress', progressListener);

    const code = await ffmpeg.exec(args);
    if (code !== 0) {
      throw new StreamError('unsupported', `ffmpeg 종료 코드 ${code}`);
    }
    const result = await ffmpeg.readFile(output);
    if (typeof result === 'string') {
      throw new StreamError('unsupported', 'ffmpeg 출력이 바이너리가 아님');
    }
    return result;
  } finally {
    if (onProgress) ffmpeg.off('progress', progressListener);
    // MEMFS는 호출 간에 유지되므로 메모리 해제를 위해 반드시 지운다
    for (const name of [...fileNames, output]) {
      await ffmpeg.deleteFile(name).catch(() => undefined);
    }
  }
}

/** MPEG-TS 연결본을 컨테이너만 바꿔 MP4로 remux한다 (재인코딩 없음). */
export function remuxTsToMp4(ts: Uint8Array, onProgress?: MuxProgress): Promise<Uint8Array> {
  return enqueue(async (ffmpeg) => {
    const base = ['-i', 'in.ts', '-c', 'copy', '-y', 'out.mp4'];
    try {
      return await execWithFiles(ffmpeg, { inputs: { 'in.ts': ts }, args: base, output: 'out.mp4', onProgress });
    } catch {
      // 일부 코어 버전은 ADTS AAC→MP4 복사에 비트스트림 필터를 자동 적용하지 않는다
      return await execWithFiles(ffmpeg, {
        inputs: { 'in.ts': ts },
        args: ['-i', 'in.ts', '-c', 'copy', '-bsf:a', 'aac_adtstoasc', '-y', 'out.mp4'],
        output: 'out.mp4',
        onProgress,
      });
    }
  });
}

/** fMP4(init+세그먼트 연결본)를 일반 MP4 컨테이너로 정리한다. */
export function remuxFmp4ToMp4(data: Uint8Array, onProgress?: MuxProgress): Promise<Uint8Array> {
  return enqueue((ffmpeg) =>
    execWithFiles(ffmpeg, {
      inputs: { 'in.mp4': data },
      args: ['-i', 'in.mp4', '-c', 'copy', '-y', 'out.mp4'],
      output: 'out.mp4',
      onProgress,
    }),
  );
}

/**
 * 분리된 비디오/오디오 트랙을 하나의 MP4로 mux한다 (재인코딩 없음).
 * 입력 파일명 확장자는 ffmpeg의 포맷 추정을 돕는 힌트다.
 */
export function muxAv(
  video: { data: Uint8Array; container: 'ts' | 'mp4' },
  audio: { data: Uint8Array; container: 'ts' | 'mp4' },
  onProgress?: MuxProgress,
): Promise<Uint8Array> {
  return enqueue((ffmpeg) => {
    const videoName = `in-v.${video.container}`;
    const audioName = `in-a.${audio.container}`;
    return execWithFiles(ffmpeg, {
      inputs: { [videoName]: video.data, [audioName]: audio.data },
      args: [
        '-i', videoName,
        '-i', audioName,
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-c', 'copy',
        '-y', 'out.mp4',
      ],
      output: 'out.mp4',
      onProgress,
    });
  });
}
