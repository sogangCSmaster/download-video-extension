import type { VideoKind } from './types';

const DIRECT_VIDEO_EXTENSIONS = ['.mp4', '.webm', '.ogg', '.ogv', '.mov', '.m4v'];
const HLS_EXTENSIONS = ['.m3u8'];
const DASH_EXTENSIONS = ['.mpd'];

const DIRECT_MIME_PREFIXES = ['video/'];
const HLS_MIME_TYPES = ['application/vnd.apple.mpegurl', 'application/x-mpegurl', 'audio/mpegurl'];
const DASH_MIME_TYPES = ['application/dash+xml'];

/** Content-Type 헤더에서 파라미터를 떼고 소문자 mime만 얻는다. */
export function parseMimeType(header: string | undefined): string | undefined {
  const mime = header?.split(';')[0]?.trim().toLowerCase();
  return mime || undefined;
}

/** dedupe 키 용도로 URL을 정규화한다. fragment만 제거하고 query는 유지한다 (query가 다른 자원을 가리킬 수 있음). */
export function normalizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hash = '';
    return url.toString();
  } catch {
    return rawUrl;
  }
}

/** 정규화된 URL로부터 안정적인 id를 생성한다. */
export function videoIdFromUrl(rawUrl: string): string {
  const normalized = normalizeUrl(rawUrl);
  // 짧고 충돌 가능성 낮은 비암호학적 해시 (FNV-1a). storage 키·DOM id로 쓰기 위함.
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** URL pathname의 마지막 세그먼트를 디코드해 반환한다. 없거나 URL이 아니면 null. */
export function urlBasename(rawUrl: string): string | null {
  try {
    const segment = new URL(rawUrl).pathname.split('/').filter(Boolean).at(-1);
    if (!segment) return null;
    try {
      return decodeURIComponent(segment);
    } catch {
      // 잘못된 percent-encoding은 원문 그대로 사용
      return segment;
    }
  } catch {
    return null;
  }
}

function urlPathname(rawUrl: string): string {
  try {
    return new URL(rawUrl).pathname.toLowerCase();
  } catch {
    return rawUrl.toLowerCase();
  }
}

/** URL과 (있다면) Content-Type으로 동영상 종류를 판별한다. 동영상이 아니면 null. */
export function classifyVideoUrl(rawUrl: string, mimeType?: string): VideoKind | null {
  if (rawUrl.startsWith('blob:')) return 'blob';

  const mime = parseMimeType(mimeType);
  if (mime) {
    if (HLS_MIME_TYPES.includes(mime)) return 'hls';
    if (DASH_MIME_TYPES.includes(mime)) return 'dash';
    if (DIRECT_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))) return 'direct';
  }

  const pathname = urlPathname(rawUrl);
  if (HLS_EXTENSIONS.some((ext) => pathname.endsWith(ext))) return 'hls';
  if (DASH_EXTENSIONS.some((ext) => pathname.endsWith(ext))) return 'dash';
  if (DIRECT_VIDEO_EXTENSIONS.some((ext) => pathname.endsWith(ext))) return 'direct';

  return null;
}

/** 실제 다운로드 가능한 종류인지. blob(MSE)만 페이지 밖에서 접근할 수 없어 미지원. */
export function isDownloadableKind(kind: VideoKind): boolean {
  return kind === 'direct' || kind === 'hls' || kind === 'dash';
}
