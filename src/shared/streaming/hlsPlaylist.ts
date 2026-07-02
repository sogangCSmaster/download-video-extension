/**
 * 최소 M3U8(HLS) 파서. 다운로드에 필요한 태그만 다룬다:
 * EXT-X-STREAM-INF / EXT-X-MEDIA / EXTINF / EXT-X-KEY / EXT-X-MAP /
 * EXT-X-BYTERANGE / EXT-X-MEDIA-SEQUENCE / EXT-X-ENDLIST.
 * 모든 URI는 baseUrl 기준으로 절대 URL로 해석해 반환한다.
 */

export interface HlsByteRange {
  /** 바이트 길이 */
  length: number;
  /** 시작 오프셋 (스펙상 생략 시 직전 범위의 끝) */
  offset: number;
}

export interface HlsKey {
  method: string; // NONE | AES-128 | SAMPLE-AES | SAMPLE-AES-CTR ...
  url?: string;
  /** 0x로 시작하는 hex IV. 없으면 media sequence로 유도 */
  iv?: string;
  keyFormat?: string; // 생략 시 "identity"
}

export interface HlsMap {
  url: string;
  byteRange?: HlsByteRange;
}

export interface HlsSegment {
  url: string;
  durationSec: number;
  /** 이 세그먼트에 적용되는 유효 키 (METHOD=NONE이면 undefined) */
  key?: HlsKey;
  /** IV 유도용 media sequence 번호 */
  mediaSequence: number;
  byteRange?: HlsByteRange;
  /** 이 세그먼트 시점의 유효 EXT-X-MAP (fMP4 init 세그먼트) */
  map?: HlsMap;
}

export interface HlsVariant {
  url: string;
  bandwidth: number;
  width?: number;
  height?: number;
  codecs?: string;
  /** AUDIO 속성 — 분리 오디오 렌디션 그룹 id */
  audioGroupId?: string;
}

export interface HlsAudioRendition {
  groupId: string;
  name: string;
  /** URI가 없으면 오디오가 variant에 muxed되어 있다는 뜻 */
  url?: string;
  isDefault: boolean;
  language?: string;
}

export interface HlsMasterPlaylist {
  kind: 'master';
  variants: HlsVariant[];
  audioRenditions: HlsAudioRendition[];
}

export interface HlsMediaPlaylist {
  kind: 'media';
  segments: HlsSegment[];
  /** EXT-X-ENDLIST 존재 여부. false면 라이브/이벤트 스트림 */
  endlist: boolean;
  mediaSequence: number;
}

export type HlsPlaylist = HlsMasterPlaylist | HlsMediaPlaylist;

/** `KEY=VALUE,KEY="quoted, value"` 형태의 HLS 속성 목록을 파싱한다. */
export function parseAttributeList(input: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([A-Za-z0-9-]+)=("[^"]*"|[^,]*)/g;
  for (const match of input.matchAll(pattern)) {
    const name = match[1];
    let value = match[2];
    if (name === undefined || value === undefined) continue;
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    attrs[name.toUpperCase()] = value;
  }
  return attrs;
}

function resolveUrl(uri: string, baseUrl: string): string {
  try {
    return new URL(uri, baseUrl).toString();
  } catch {
    return uri;
  }
}

/** `<length>[@<offset>]` — offset 생략 시 previousEnd 사용. */
function parseByteRange(value: string, previousEnd: number): HlsByteRange | null {
  const [lengthPart, offsetPart] = value.split('@');
  const length = Number(lengthPart);
  if (!Number.isFinite(length)) return null;
  const offset = offsetPart !== undefined ? Number(offsetPart) : previousEnd;
  if (!Number.isFinite(offset)) return null;
  return { length, offset };
}

function parseKey(attrs: Record<string, string>, baseUrl: string): HlsKey {
  return {
    method: attrs['METHOD'] ?? 'NONE',
    url: attrs['URI'] ? resolveUrl(attrs['URI'], baseUrl) : undefined,
    iv: attrs['IV'],
    keyFormat: attrs['KEYFORMAT'],
  };
}

/** RESOLUTION="1280x720" → {width, height} */
function parseResolution(value: string | undefined): { width?: number; height?: number } {
  const match = value?.match(/^(\d+)x(\d+)$/i);
  if (!match) return {};
  return { width: Number(match[1]), height: Number(match[2]) };
}

/** M3U8 텍스트를 파싱한다. EXT-X-STREAM-INF가 하나라도 있으면 master로 취급. */
export function parsePlaylist(text: string, baseUrl: string): HlsPlaylist {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.some((line) => line.startsWith('#EXT-X-STREAM-INF'))) {
    return parseMasterPlaylist(lines, baseUrl);
  }
  return parseMediaPlaylist(lines, baseUrl);
}

function parseMasterPlaylist(lines: string[], baseUrl: string): HlsMasterPlaylist {
  const variants: HlsVariant[] = [];
  const audioRenditions: HlsAudioRendition[] = [];
  let pendingStreamInf: Record<string, string> | null = null;

  for (const line of lines) {
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      pendingStreamInf = parseAttributeList(line.slice('#EXT-X-STREAM-INF:'.length));
      continue;
    }
    if (line.startsWith('#EXT-X-MEDIA:')) {
      const attrs = parseAttributeList(line.slice('#EXT-X-MEDIA:'.length));
      if (attrs['TYPE'] === 'AUDIO' && attrs['GROUP-ID']) {
        audioRenditions.push({
          groupId: attrs['GROUP-ID'],
          name: attrs['NAME'] ?? '',
          url: attrs['URI'] ? resolveUrl(attrs['URI'], baseUrl) : undefined,
          isDefault: attrs['DEFAULT'] === 'YES',
          language: attrs['LANGUAGE'],
        });
      }
      continue;
    }
    if (line.startsWith('#')) continue;

    // 태그가 아닌 줄 = 직전 EXT-X-STREAM-INF의 variant URI
    if (pendingStreamInf) {
      const { width, height } = parseResolution(pendingStreamInf['RESOLUTION']);
      variants.push({
        url: resolveUrl(line, baseUrl),
        bandwidth: Number(pendingStreamInf['BANDWIDTH']) || 0,
        width,
        height,
        codecs: pendingStreamInf['CODECS'],
        audioGroupId: pendingStreamInf['AUDIO'],
      });
      pendingStreamInf = null;
    }
  }

  return { kind: 'master', variants, audioRenditions };
}

function parseMediaPlaylist(lines: string[], baseUrl: string): HlsMediaPlaylist {
  const segments: HlsSegment[] = [];
  let endlist = false;
  let startSequence = 0;
  let currentKey: HlsKey | undefined;
  let currentMap: HlsMap | undefined;
  let pendingDuration = 0;
  let pendingByteRange: HlsByteRange | undefined;
  let previousRangeEnd = 0;

  for (const line of lines) {
    if (line.startsWith('#EXTINF:')) {
      pendingDuration = Number(line.slice('#EXTINF:'.length).split(',')[0]) || 0;
      continue;
    }
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      startSequence = Number(line.slice('#EXT-X-MEDIA-SEQUENCE:'.length)) || 0;
      continue;
    }
    if (line.startsWith('#EXT-X-KEY:')) {
      const key = parseKey(parseAttributeList(line.slice('#EXT-X-KEY:'.length)), baseUrl);
      currentKey = key.method === 'NONE' ? undefined : key;
      continue;
    }
    if (line.startsWith('#EXT-X-MAP:')) {
      const attrs = parseAttributeList(line.slice('#EXT-X-MAP:'.length));
      if (attrs['URI']) {
        currentMap = {
          url: resolveUrl(attrs['URI'], baseUrl),
          byteRange: attrs['BYTERANGE'] ? (parseByteRange(attrs['BYTERANGE'], 0) ?? undefined) : undefined,
        };
      }
      continue;
    }
    if (line.startsWith('#EXT-X-BYTERANGE:')) {
      pendingByteRange =
        parseByteRange(line.slice('#EXT-X-BYTERANGE:'.length), previousRangeEnd) ?? undefined;
      continue;
    }
    if (line === '#EXT-X-ENDLIST') {
      endlist = true;
      continue;
    }
    if (line.startsWith('#')) continue;

    // 태그가 아닌 줄 = 세그먼트 URI
    segments.push({
      url: resolveUrl(line, baseUrl),
      durationSec: pendingDuration,
      key: currentKey,
      mediaSequence: startSequence + segments.length,
      byteRange: pendingByteRange,
      map: currentMap,
    });
    previousRangeEnd = pendingByteRange ? pendingByteRange.offset + pendingByteRange.length : 0;
    pendingDuration = 0;
    pendingByteRange = undefined;
  }

  return { kind: 'media', segments, endlist, mediaSequence: startSequence };
}

/** 가장 높은 BANDWIDTH의 variant를 고른다 (동률이면 해상도 큰 쪽). */
export function selectVariant(master: HlsMasterPlaylist): HlsVariant | null {
  let best: HlsVariant | null = null;
  for (const variant of master.variants) {
    if (
      !best ||
      variant.bandwidth > best.bandwidth ||
      (variant.bandwidth === best.bandwidth && (variant.height ?? 0) > (best.height ?? 0))
    ) {
      best = variant;
    }
  }
  return best;
}

/**
 * variant의 AUDIO 그룹에서 별도 URI를 가진 오디오 렌디션을 고른다
 * (DEFAULT=YES 우선). URI가 없으면 오디오가 muxed된 것이므로 null.
 */
export function selectAudioRendition(
  master: HlsMasterPlaylist,
  variant: HlsVariant,
): HlsAudioRendition | null {
  if (!variant.audioGroupId) return null;
  const group = master.audioRenditions.filter(
    (r) => r.groupId === variant.audioGroupId && r.url !== undefined,
  );
  if (group.length === 0) return null;
  return group.find((r) => r.isDefault) ?? group[0] ?? null;
}
