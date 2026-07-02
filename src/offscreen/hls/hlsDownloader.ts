import type { HlsKey, HlsMediaPlaylist, HlsSegment } from '@shared/streaming/hlsPlaylist';
import { parsePlaylist, selectAudioRendition, selectVariant } from '@shared/streaming/hlsPlaylist';
import { StreamError } from '@shared/streaming/streamErrors';

import type { ByteBudget, FetchTask } from '../segmentFetcher';
import { concatBytes, fetchAllSegments, fetchText } from '../segmentFetcher';

export interface HlsTrackData {
  data: Uint8Array;
  /** ffmpeg 입력 포맷 힌트: EXT-X-MAP이 있으면 fMP4 */
  container: 'ts' | 'mp4';
}

export interface HlsDownloadResult {
  video: HlsTrackData;
  /** 분리 오디오 렌디션이 있을 때만 존재 */
  audio?: HlsTrackData;
}

/** AES-128 키 fetch 결과를 URI별로 캐시한다 (잡 하나 안에서만). */
type KeyCache = Map<string, Promise<CryptoKey>>;

function importAesKey(keyUrl: string, signal: AbortSignal, cache: KeyCache): Promise<CryptoKey> {
  const cached = cache.get(keyUrl);
  if (cached) return cached;
  const imported = (async () => {
    const response = await fetch(keyUrl, { signal, credentials: 'omit' });
    if (!response.ok) throw new StreamError('fetch', `key HTTP ${response.status}`);
    const raw = await response.arrayBuffer();
    if (raw.byteLength !== 16) throw new StreamError('drm', 'invalid AES-128 key length');
    return crypto.subtle.importKey('raw', raw, { name: 'AES-CBC' }, false, ['decrypt']);
  })();
  cache.set(keyUrl, imported);
  return imported;
}

/** IV 속성(0x hex) 또는 media sequence(16바이트 big-endian)로 IV를 만든다. */
export function deriveIv(iv: string | undefined, mediaSequence: number): Uint8Array {
  const bytes = new Uint8Array(16);
  if (iv) {
    const hex = iv.replace(/^0x/i, '').padStart(32, '0');
    for (let i = 0; i < 16; i++) {
      bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16) || 0;
    }
    return bytes;
  }
  new DataView(bytes.buffer).setBigUint64(8, BigInt(mediaSequence));
  return bytes;
}

async function decryptAes128(
  data: Uint8Array,
  key: HlsKey,
  mediaSequence: number,
  signal: AbortSignal,
  cache: KeyCache,
): Promise<Uint8Array> {
  if (!key.url) throw new StreamError('drm', 'missing AES-128 key URI');
  const cryptoKey = await importAesKey(key.url, signal, cache);
  const iv = deriveIv(key.iv, mediaSequence);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv: iv as BufferSource },
    cryptoKey,
    data as BufferSource,
  );
  return new Uint8Array(plain);
}

/** DRM/미지원 암호화를 조기에 거부한다. AES-128(identity 키)만 통과. */
function assertDecryptable(playlist: HlsMediaPlaylist): void {
  for (const segment of playlist.segments) {
    const key = segment.key;
    if (!key) continue;
    const isSampleAes = key.method.startsWith('SAMPLE-AES');
    const isCustomKeyFormat = key.keyFormat !== undefined && key.keyFormat !== 'identity';
    if (isSampleAes || isCustomKeyFormat) throw new StreamError('drm');
    if (key.method !== 'AES-128') throw new StreamError('unsupported', `METHOD=${key.method}`);
  }
}

function byteRangeHeader(segment: HlsSegment): string | undefined {
  if (!segment.byteRange) return undefined;
  const { offset, length } = segment.byteRange;
  return `${offset}-${offset + length - 1}`;
}

/** 미디어 플레이리스트 하나를 받아 세그먼트(필요시 EXT-X-MAP init 포함)를 이어붙인다. */
async function downloadMediaPlaylist(
  playlistUrl: string,
  signal: AbortSignal,
  budget: ByteBudget,
  onProgress: (completed: number, total: number) => void,
): Promise<HlsTrackData> {
  const parsed = parsePlaylist(await fetchText(playlistUrl, signal), playlistUrl);
  if (parsed.kind !== 'media') {
    throw new StreamError('unsupported', 'nested master playlist');
  }
  if (!parsed.endlist) throw new StreamError('live');
  if (parsed.segments.length === 0) throw new StreamError('unsupported', 'no segments');
  assertDecryptable(parsed);

  const keyCache: KeyCache = new Map();
  const tasks: FetchTask[] = [];
  let lastMapUrl: string | undefined;

  for (const segment of parsed.segments) {
    // EXT-X-MAP(fMP4 init)은 바뀔 때마다 한 번씩만 앞에 끼워 넣는다
    if (segment.map && segment.map.url !== lastMapUrl) {
      const { url, byteRange } = segment.map;
      tasks.push({
        url,
        range: byteRange ? `${byteRange.offset}-${byteRange.offset + byteRange.length - 1}` : undefined,
      });
      lastMapUrl = segment.map.url;
    }
    const key = segment.key;
    tasks.push({
      url: segment.url,
      range: byteRangeHeader(segment),
      transform: key
        ? (data) => decryptAes128(data, key, segment.mediaSequence, signal, keyCache)
        : undefined,
    });
  }

  const chunks = await fetchAllSegments(tasks, { signal, budget, onProgress });
  return {
    data: concatBytes(chunks),
    container: parsed.segments.some((s) => s.map) ? 'mp4' : 'ts',
  };
}

/**
 * HLS 스트림 전체를 내려받는다.
 * master면 최고 화질 variant(+ 분리 오디오 렌디션)를 고르고, media면 그대로 받는다.
 */
export async function downloadHls(
  url: string,
  signal: AbortSignal,
  budget: ByteBudget,
  onProgress: (fraction: number) => void,
): Promise<HlsDownloadResult> {
  const parsed = parsePlaylist(await fetchText(url, signal), url);

  if (parsed.kind === 'media') {
    // 이미 미디어 플레이리스트 URL을 탐지한 경우
    if (!parsed.endlist) throw new StreamError('live');
    const video = await downloadMediaPlaylist(url, signal, budget, (done, total) =>
      onProgress(done / total),
    );
    return { video };
  }

  const variant = selectVariant(parsed);
  if (!variant) throw new StreamError('unsupported', 'no variants');
  const audioRendition = selectAudioRendition(parsed, variant);

  if (!audioRendition?.url) {
    const video = await downloadMediaPlaylist(variant.url, signal, budget, (done, total) =>
      onProgress(done / total),
    );
    return { video };
  }

  // 비디오/오디오 진행률을 합산해 보고한다 (세그먼트 수 기준 절반씩 가중)
  const progress = { video: 0, audio: 0 };
  const report = () => onProgress((progress.video + progress.audio) / 2);

  const [video, audio] = await Promise.all([
    downloadMediaPlaylist(variant.url, signal, budget, (done, total) => {
      progress.video = done / total;
      report();
    }),
    downloadMediaPlaylist(audioRendition.url, signal, budget, (done, total) => {
      progress.audio = done / total;
      report();
    }),
  ]);
  return { video, audio };
}
