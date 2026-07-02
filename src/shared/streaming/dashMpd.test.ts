// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { expandTemplate, parseIsoDuration, parseMpd, selectRepresentations } from './dashMpd';
import { StreamError } from './streamErrors';

const MPD_URL = 'https://cdn.example.com/dash/manifest.mpd';

function mpd(inner: string, attrs = 'type="static" mediaPresentationDuration="PT20S"'): string {
  return `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" ${attrs}>
  <Period>${inner}</Period>
</MPD>`;
}

describe('parseIsoDuration', () => {
  it('시/분/초와 소수점을 처리한다', () => {
    expect(parseIsoDuration('PT1H2M3.5S')).toBe(3723.5);
    expect(parseIsoDuration('PT30S')).toBe(30);
    expect(parseIsoDuration('P1DT1S')).toBe(86401);
  });

  it('파싱 불가면 null', () => {
    expect(parseIsoDuration('abc')).toBeNull();
    expect(parseIsoDuration(undefined)).toBeNull();
  });
});

describe('expandTemplate', () => {
  it('$Number$의 %0Nd 패딩을 처리한다', () => {
    expect(
      expandTemplate('seg-$RepresentationID$-$Number%05d$.m4s', {
        representationId: 'v1',
        bandwidth: 1000,
        number: 7,
      }),
    ).toBe('seg-v1-00007.m4s');
  });

  it('$Time$과 $$ 이스케이프를 처리한다', () => {
    expect(
      expandTemplate('$$-$Time$.m4s', { representationId: 'a', bandwidth: 1, time: 900000 }),
    ).toBe('$-900000.m4s');
  });
});

describe('parseMpd — SegmentTemplate', () => {
  it('duration 기반으로 세그먼트 수를 계산한다', () => {
    const xml = mpd(`
      <AdaptationSet contentType="video" mimeType="video/mp4">
        <SegmentTemplate media="v-$Number$.m4s" initialization="v-init.mp4"
                         duration="5" timescale="1" startNumber="1"/>
        <Representation id="v1" bandwidth="1000000" width="1280" height="720"/>
      </AdaptationSet>`);
    const manifest = parseMpd(xml, MPD_URL);
    const track = manifest.videoTracks[0];
    expect(track?.init?.url).toBe('https://cdn.example.com/dash/v-init.mp4');
    // 20초 / 5초 = 4개
    expect(track?.segments).toHaveLength(4);
    expect(track?.segments[3]?.url).toBe('https://cdn.example.com/dash/v-4.m4s');
  });

  it('SegmentTimeline($Time$, r 반복, r=-1)을 전개한다', () => {
    const xml = mpd(`
      <AdaptationSet contentType="video" mimeType="video/mp4">
        <SegmentTemplate media="v-$Time$.m4s" initialization="init.mp4" timescale="1000">
          <SegmentTimeline>
            <S t="0" d="4000" r="1"/>
            <S d="4000" r="-1"/>
          </SegmentTimeline>
        </SegmentTemplate>
        <Representation id="v1" bandwidth="1"/>
      </AdaptationSet>`);
    const manifest = parseMpd(xml, MPD_URL);
    const urls = manifest.videoTracks[0]?.segments.map((s) => s.url);
    // 20초 = t 0,4000,8000,12000,16000 (r=-1이 period 끝까지 채움)
    expect(urls).toEqual([
      'https://cdn.example.com/dash/v-0.m4s',
      'https://cdn.example.com/dash/v-4000.m4s',
      'https://cdn.example.com/dash/v-8000.m4s',
      'https://cdn.example.com/dash/v-12000.m4s',
      'https://cdn.example.com/dash/v-16000.m4s',
    ]);
  });

  it('AdaptationSet의 SegmentTemplate을 Representation이 상속한다', () => {
    const xml = mpd(`
      <AdaptationSet contentType="audio" mimeType="audio/mp4">
        <SegmentTemplate media="$RepresentationID$/$Number$.m4s" initialization="$RepresentationID$/init.mp4"
                         duration="10" timescale="1" startNumber="0"/>
        <Representation id="a1" bandwidth="64000"/>
        <Representation id="a2" bandwidth="128000"/>
      </AdaptationSet>`);
    const manifest = parseMpd(xml, MPD_URL);
    expect(manifest.audioTracks).toHaveLength(2);
    expect(manifest.audioTracks[1]?.segments[0]?.url).toBe('https://cdn.example.com/dash/a2/0.m4s');
  });
});

describe('parseMpd — SegmentList/SegmentBase/BaseURL', () => {
  it('SegmentList의 mediaRange를 보존한다', () => {
    const xml = mpd(`
      <AdaptationSet contentType="video" mimeType="video/mp4">
        <Representation id="v1" bandwidth="1">
          <SegmentList>
            <Initialization sourceURL="init.mp4" range="0-800"/>
            <SegmentURL media="s1.m4s"/>
            <SegmentURL media="all.mp4" mediaRange="801-2000"/>
          </SegmentList>
        </Representation>
      </AdaptationSet>`);
    const track = parseMpd(xml, MPD_URL).videoTracks[0];
    expect(track?.init).toEqual({ url: 'https://cdn.example.com/dash/init.mp4', range: '0-800' });
    expect(track?.segments[1]).toEqual({
      url: 'https://cdn.example.com/dash/all.mp4',
      range: '801-2000',
    });
  });

  it('SegmentBase 단일 파일은 BaseURL 체인을 따라 파일 전체를 받는다', () => {
    const xml = `<?xml version="1.0"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT10S">
  <BaseURL>https://media.example.com/</BaseURL>
  <Period>
    <AdaptationSet contentType="video" mimeType="video/mp4">
      <Representation id="v1" bandwidth="1">
        <BaseURL>bbb/video.mp4</BaseURL>
        <SegmentBase indexRange="800-1000"><Initialization range="0-799"/></SegmentBase>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;
    const track = parseMpd(xml, MPD_URL).videoTracks[0];
    expect(track?.init).toBeUndefined();
    expect(track?.segments).toEqual([{ url: 'https://media.example.com/bbb/video.mp4' }]);
  });
});

describe('parseMpd — 거부 경로', () => {
  it('dynamic(라이브)은 StreamError(live)', () => {
    const xml = mpd(
      `<AdaptationSet contentType="video"><Representation id="v" bandwidth="1"/></AdaptationSet>`,
      'type="dynamic"',
    );
    expect(() => parseMpd(xml, MPD_URL)).toThrowError(StreamError);
    try {
      parseMpd(xml, MPD_URL);
    } catch (error) {
      expect((error as StreamError).code).toBe('live');
    }
  });

  it('ContentProtection은 StreamError(drm)', () => {
    const xml = mpd(`
      <AdaptationSet contentType="video" mimeType="video/mp4">
        <ContentProtection schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"/>
        <SegmentTemplate media="v-$Number$.m4s" duration="5" timescale="1"/>
        <Representation id="v1" bandwidth="1"/>
      </AdaptationSet>`);
    try {
      parseMpd(xml, MPD_URL);
      throw new Error('던져야 함');
    } catch (error) {
      expect((error as StreamError).code).toBe('drm');
    }
  });
});

describe('selectRepresentations', () => {
  it('비디오/오디오 각각 최대 대역폭을 고른다', () => {
    const xml = mpd(`
      <AdaptationSet contentType="video" mimeType="video/mp4">
        <SegmentTemplate media="$RepresentationID$-$Number$.m4s" duration="5" timescale="1"/>
        <Representation id="v-lo" bandwidth="500000"/>
        <Representation id="v-hi" bandwidth="3000000"/>
      </AdaptationSet>
      <AdaptationSet contentType="audio" mimeType="audio/mp4">
        <SegmentTemplate media="$RepresentationID$-$Number$.m4s" duration="5" timescale="1"/>
        <Representation id="a-lo" bandwidth="64000"/>
        <Representation id="a-hi" bandwidth="192000"/>
      </AdaptationSet>`);
    const { video, audio } = selectRepresentations(parseMpd(xml, MPD_URL));
    expect(video?.representationId).toBe('v-hi');
    expect(audio?.representationId).toBe('a-hi');
  });
});
