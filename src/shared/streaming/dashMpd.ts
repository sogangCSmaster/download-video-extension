/**
 * 최소 정적(on-demand) DASH MPD 파서.
 * 지원: BaseURL 체인, SegmentTemplate($Number$/$Time$ + SegmentTimeline), SegmentList,
 * SegmentBase(단일 파일). 라이브(type="dynamic")와 DRM(ContentProtection)은 타입드 오류로 거부.
 * 반환하는 모든 URL은 절대 URL이다.
 */

import { StreamError } from './streamErrors';

export interface DashSegmentRef {
  url: string;
  /** HTTP Range 헤더 값 ("123-456"). SegmentList의 mediaRange 등 */
  range?: string;
}

export interface DashTrack {
  contentType: 'video' | 'audio';
  representationId: string;
  bandwidth: number;
  width?: number;
  height?: number;
  mimeType?: string;
  codecs?: string;
  /** fMP4 init 세그먼트. SegmentBase 단일 파일인 경우 없음(파일 전체를 받으면 됨) */
  init?: DashSegmentRef;
  segments: DashSegmentRef[];
}

export interface DashManifest {
  videoTracks: DashTrack[];
  audioTracks: DashTrack[];
}

/** ISO-8601 duration("PT1H2M3.5S", "P1DT2H")을 초로. 파싱 불가면 null. */
export function parseIsoDuration(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(
    /^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/,
  );
  if (!match) return null;
  const [, years, months, days, hours, minutes, seconds] = match;
  return (
    (Number(years) || 0) * 31536000 +
    (Number(months) || 0) * 2592000 +
    (Number(days) || 0) * 86400 +
    (Number(hours) || 0) * 3600 +
    (Number(minutes) || 0) * 60 +
    (Number(seconds) || 0)
  );
}

/** SegmentTemplate의 $식별자$ 치환. $Number$/$Time$은 %0Nd 패딩 지원. */
export function expandTemplate(
  template: string,
  vars: { representationId: string; bandwidth: number; number?: number; time?: number },
): string {
  return template.replace(
    /\$\$|\$(RepresentationID|Bandwidth|Number|Time)(?:%0(\d+)d)?\$/g,
    (whole, name: string | undefined, pad: string | undefined) => {
      let value: string | number;
      switch (name) {
        case undefined: // "$$" 이스케이프
          return '$';
        case 'RepresentationID':
          value = vars.representationId;
          break;
        case 'Bandwidth':
          value = vars.bandwidth;
          break;
        case 'Number':
          if (vars.number === undefined) return whole;
          value = vars.number;
          break;
        case 'Time':
          if (vars.time === undefined) return whole;
          value = vars.time;
          break;
        default:
          return whole;
      }
      const text = String(value);
      return pad ? text.padStart(Number(pad), '0') : text;
    },
  );
}

// --- XML 헬퍼 (네임스페이스 무시: localName으로 비교) ---

function childElements(parent: Element, name: string): Element[] {
  const found: Element[] = [];
  for (const child of Array.from(parent.children)) {
    if (child.localName === name) found.push(child);
  }
  return found;
}

function firstChild(parent: Element, name: string): Element | null {
  return childElements(parent, name)[0] ?? null;
}

function attr(el: Element | null, name: string): string | undefined {
  const value = el?.getAttribute(name);
  return value === null || value === undefined ? undefined : value;
}

function numAttr(el: Element | null, name: string): number | undefined {
  const value = attr(el, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** 요소 자신의 BaseURL 자식으로 base를 한 단계 확장한다. */
function resolveBase(el: Element, base: string): string {
  const baseUrlText = firstChild(el, 'BaseURL')?.textContent?.trim();
  if (!baseUrlText) return base;
  try {
    return new URL(baseUrlText, base).toString();
  } catch {
    return base;
  }
}

interface SegmentTemplateInfo {
  media?: string;
  initialization?: string;
  timescale: number;
  duration?: number;
  startNumber: number;
  timeline: Element | null;
}

/** AdaptationSet→Representation 상속을 반영해 SegmentTemplate 속성을 병합한다. */
function mergeSegmentTemplate(
  inherited: SegmentTemplateInfo | null,
  el: Element | null,
): SegmentTemplateInfo | null {
  if (!el) return inherited;
  return {
    media: attr(el, 'media') ?? inherited?.media,
    initialization: attr(el, 'initialization') ?? inherited?.initialization,
    timescale: numAttr(el, 'timescale') ?? inherited?.timescale ?? 1,
    duration: numAttr(el, 'duration') ?? inherited?.duration,
    startNumber: numAttr(el, 'startNumber') ?? inherited?.startNumber ?? 1,
    timeline: firstChild(el, 'SegmentTimeline') ?? inherited?.timeline ?? null,
  };
}

interface TimelineEntry {
  time: number;
  number: number;
}

/** SegmentTimeline의 S@t/@d/@r을 (시작시간, 번호) 목록으로 전개한다. */
function expandTimeline(
  timeline: Element,
  startNumber: number,
  timescale: number,
  periodDurationSec: number | null,
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  let time = 0;
  let number = startNumber;
  const periodEnd = periodDurationSec !== null ? periodDurationSec * timescale : null;

  for (const s of Array.from(timeline.children)) {
    if (s.localName !== 'S') continue;
    const d = numAttr(s, 'd');
    if (d === undefined || d <= 0) continue;
    time = numAttr(s, 't') ?? time;
    let repeat = numAttr(s, 'r') ?? 0;
    if (repeat < 0) {
      // r=-1: 다음 S@t 또는 period 끝까지 반복
      const nextS = s.nextElementSibling;
      const until = numAttr(nextS?.localName === 'S' ? nextS : null, 't') ?? periodEnd;
      repeat = until !== null && until !== undefined ? Math.max(0, Math.ceil((until - time) / d) - 1) : 0;
    }
    for (let i = 0; i <= repeat; i++) {
      entries.push({ time, number });
      time += d;
      number += 1;
    }
  }
  return entries;
}

function trackFromTemplate(
  template: SegmentTemplateInfo,
  base: string,
  rep: { id: string; bandwidth: number },
  periodDurationSec: number | null,
): { init?: DashSegmentRef; segments: DashSegmentRef[] } | null {
  if (!template.media) return null;
  const vars = { representationId: rep.id, bandwidth: rep.bandwidth };

  const init: DashSegmentRef | undefined = template.initialization
    ? { url: new URL(expandTemplate(template.initialization, vars), base).toString() }
    : undefined;

  const segments: DashSegmentRef[] = [];
  if (template.timeline) {
    for (const entry of expandTimeline(
      template.timeline,
      template.startNumber,
      template.timescale,
      periodDurationSec,
    )) {
      segments.push({
        url: new URL(
          expandTemplate(template.media, { ...vars, number: entry.number, time: entry.time }),
          base,
        ).toString(),
      });
    }
  } else if (template.duration && periodDurationSec !== null) {
    const segmentDurationSec = template.duration / template.timescale;
    const count = Math.ceil(periodDurationSec / segmentDurationSec);
    for (let i = 0; i < count; i++) {
      segments.push({
        url: new URL(
          expandTemplate(template.media, { ...vars, number: template.startNumber + i }),
          base,
        ).toString(),
      });
    }
  } else {
    return null;
  }

  return segments.length > 0 ? { init, segments } : null;
}

function trackFromSegmentList(
  list: Element,
  base: string,
): { init?: DashSegmentRef; segments: DashSegmentRef[] } | null {
  const initEl = firstChild(list, 'Initialization');
  const initUrl = attr(initEl, 'sourceURL');
  const init: DashSegmentRef | undefined = initEl
    ? {
        url: initUrl ? new URL(initUrl, base).toString() : base,
        range: attr(initEl, 'range'),
      }
    : undefined;

  const segments: DashSegmentRef[] = [];
  for (const segmentUrl of childElements(list, 'SegmentURL')) {
    const media = attr(segmentUrl, 'media');
    segments.push({
      url: media ? new URL(media, base).toString() : base,
      range: attr(segmentUrl, 'mediaRange'),
    });
  }
  return segments.length > 0 ? { init, segments } : null;
}

function contentTypeOf(adaptationSet: Element, representation: Element): 'video' | 'audio' | null {
  const explicit = attr(adaptationSet, 'contentType');
  if (explicit === 'video' || explicit === 'audio') return explicit;
  const mime = attr(representation, 'mimeType') ?? attr(adaptationSet, 'mimeType') ?? '';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  // mimeType이 application/mp4 등인 경우 해상도 유무로 추정
  if (attr(representation, 'width') ?? attr(adaptationSet, 'width')) return 'video';
  return null;
}

function hasContentProtection(...elements: Element[]): boolean {
  return elements.some((el) => childElements(el, 'ContentProtection').length > 0);
}

/**
 * MPD XML을 파싱해 다운로드 가능한 트랙 목록을 만든다.
 * @throws StreamError 라이브(dynamic) 또는 DRM 보호 스트림
 */
export function parseMpd(xmlText: string, mpdUrl: string): DashManifest {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  const mpd = doc.documentElement;
  if (!mpd || mpd.localName !== 'MPD') {
    throw new StreamError('unsupported', 'MPD 문서가 아님');
  }
  if (attr(mpd, 'type') === 'dynamic') {
    throw new StreamError('live');
  }

  const mediaPresentationDurationSec = parseIsoDuration(attr(mpd, 'mediaPresentationDuration'));
  const mpdBase = resolveBase(mpd, mpdUrl);

  // 다중 Period 이어붙이기는 범위 밖 — 첫 Period만 다운로드한다.
  const period = firstChild(mpd, 'Period');
  if (!period) throw new StreamError('unsupported', 'Period 없음');
  const periodDurationSec =
    parseIsoDuration(attr(period, 'duration')) ?? mediaPresentationDurationSec;
  const periodBase = resolveBase(period, mpdBase);

  const videoTracks: DashTrack[] = [];
  const audioTracks: DashTrack[] = [];

  for (const adaptationSet of childElements(period, 'AdaptationSet')) {
    const setBase = resolveBase(adaptationSet, periodBase);
    const setTemplate = mergeSegmentTemplate(null, firstChild(adaptationSet, 'SegmentTemplate'));

    for (const representation of childElements(adaptationSet, 'Representation')) {
      const contentType = contentTypeOf(adaptationSet, representation);
      if (!contentType) continue;
      if (hasContentProtection(adaptationSet, representation)) {
        throw new StreamError('drm');
      }

      const repBase = resolveBase(representation, setBase);
      const rep = {
        id: attr(representation, 'id') ?? '',
        bandwidth: numAttr(representation, 'bandwidth') ?? 0,
      };

      const template = mergeSegmentTemplate(
        setTemplate,
        firstChild(representation, 'SegmentTemplate'),
      );
      const segmentList =
        firstChild(representation, 'SegmentList') ?? firstChild(adaptationSet, 'SegmentList');

      let parts: { init?: DashSegmentRef; segments: DashSegmentRef[] } | null = null;
      if (segmentList) {
        parts = trackFromSegmentList(segmentList, repBase);
      } else if (template?.media) {
        parts = trackFromTemplate(template, repBase, rep, periodDurationSec);
      } else if (firstChild(representation, 'SegmentBase') ?? firstChild(representation, 'BaseURL')) {
        // SegmentBase 단일 파일: init 포함 파일 전체를 하나의 세그먼트로 받는다
        parts = { segments: [{ url: repBase }] };
      }
      if (!parts) continue;

      const track: DashTrack = {
        contentType,
        representationId: rep.id,
        bandwidth: rep.bandwidth,
        width: numAttr(representation, 'width') ?? numAttr(adaptationSet, 'width'),
        height: numAttr(representation, 'height') ?? numAttr(adaptationSet, 'height'),
        mimeType: attr(representation, 'mimeType') ?? attr(adaptationSet, 'mimeType'),
        codecs: attr(representation, 'codecs') ?? attr(adaptationSet, 'codecs'),
        init: parts.init,
        segments: parts.segments,
      };
      (contentType === 'video' ? videoTracks : audioTracks).push(track);
    }
  }

  if (videoTracks.length === 0 && audioTracks.length === 0) {
    throw new StreamError('unsupported', '다운로드 가능한 트랙 없음');
  }
  return { videoTracks, audioTracks };
}

function bestTrack(tracks: DashTrack[]): DashTrack | null {
  let best: DashTrack | null = null;
  for (const track of tracks) {
    if (
      !best ||
      track.bandwidth > best.bandwidth ||
      (track.bandwidth === best.bandwidth && (track.height ?? 0) > (best.height ?? 0))
    ) {
      best = track;
    }
  }
  return best;
}

/** 최고 대역폭의 비디오/오디오 트랙을 고른다. */
export function selectRepresentations(manifest: DashManifest): {
  video: DashTrack | null;
  audio: DashTrack | null;
} {
  return { video: bestTrack(manifest.videoTracks), audio: bestTrack(manifest.audioTracks) };
}
