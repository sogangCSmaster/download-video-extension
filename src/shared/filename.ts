import { parseMimeType, urlBasename } from './urlUtils';

const MIME_TO_EXTENSION: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/ogg': '.ogv',
  'video/quicktime': '.mov',
  'video/x-m4v': '.m4v',
};

const MAX_BASENAME_LENGTH = 180;
const DEFAULT_BASENAME = 'video';
const DEFAULT_EXTENSION = '.mp4';

function sanitizeBasename(name: string): string {
  const cleaned = name
    // 파일 시스템 예약 문자 및 제어 문자 제거
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    // 선행 마침표는 숨김 파일이 되므로 제거
    .replace(/^\.+/, '');
  return cleaned.slice(0, MAX_BASENAME_LENGTH);
}

function extensionFromMime(mimeType?: string): string | null {
  const mime = parseMimeType(mimeType);
  return mime ? (MIME_TO_EXTENSION[mime] ?? null) : null;
}

function splitExtension(name: string): { base: string; ext: string } {
  const dotIndex = name.lastIndexOf('.');
  // 확장자는 1~5자의 영숫자만 인정하되, 숫자로만 된 것("v1.2"의 ".2")은 확장자로 보지 않는다
  if (dotIndex > 0) {
    const ext = name.slice(dotIndex);
    if (/^\.[a-z0-9]{1,5}$/i.test(ext) && !/^\.\d+$/.test(ext)) {
      return { base: name.slice(0, dotIndex), ext: ext.toLowerCase() };
    }
  }
  return { base: name, ext: '' };
}

/**
 * 다운로드에 사용할 파일명을 만든다.
 * URL pathname의 basename → 없으면 pageTitle → 그래도 없으면 기본값 순으로 시도하고,
 * 확장자가 없으면 mimeType에서 유추한다.
 */
export function buildDownloadFilename(options: {
  url: string;
  mimeType?: string;
  pageTitle?: string;
}): string {
  const { url, mimeType, pageTitle } = options;

  let { base, ext } = splitExtension(urlBasename(url) ?? '');
  base = sanitizeBasename(base);

  if (!base) {
    base = sanitizeBasename(pageTitle ?? '') || DEFAULT_BASENAME;
  }
  if (!ext) {
    ext = extensionFromMime(mimeType) ?? DEFAULT_EXTENSION;
  }

  return `${base}${ext}`;
}
