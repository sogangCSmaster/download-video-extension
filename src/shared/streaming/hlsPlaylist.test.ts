import { describe, expect, it } from 'vitest';

import {
  parseAttributeList,
  parsePlaylist,
  selectAudioRendition,
  selectVariant,
} from './hlsPlaylist';

const BASE = 'https://cdn.example.com/hls/master.m3u8';

describe('parseAttributeList', () => {
  it('따옴표 값 안의 쉼표를 보존한다', () => {
    const attrs = parseAttributeList('BANDWIDTH=1000,CODECS="avc1.4d401f,mp4a.40.2",AUDIO="aud"');
    expect(attrs['BANDWIDTH']).toBe('1000');
    expect(attrs['CODECS']).toBe('avc1.4d401f,mp4a.40.2');
    expect(attrs['AUDIO']).toBe('aud');
  });
});

describe('parsePlaylist — master', () => {
  const master = [
    '#EXTM3U',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Korean",DEFAULT=NO,URI="audio/ko.m3u8"',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",DEFAULT=YES,URI="audio/en.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,AUDIO="aud"',
    'low/index.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1280x720,AUDIO="aud"',
    'high/index.m3u8',
  ].join('\n');

  it('variant와 오디오 렌디션을 절대 URL로 파싱한다', () => {
    const playlist = parsePlaylist(master, BASE);
    if (playlist.kind !== 'master') throw new Error('master여야 함');
    expect(playlist.variants).toHaveLength(2);
    expect(playlist.variants[1]?.url).toBe('https://cdn.example.com/hls/high/index.m3u8');
    expect(playlist.variants[1]?.width).toBe(1280);
    expect(playlist.audioRenditions).toHaveLength(2);
    expect(playlist.audioRenditions[0]?.url).toBe('https://cdn.example.com/hls/audio/ko.m3u8');
  });

  it('selectVariant는 최대 대역폭을 고른다', () => {
    const playlist = parsePlaylist(master, BASE);
    if (playlist.kind !== 'master') throw new Error('master여야 함');
    expect(selectVariant(playlist)?.bandwidth).toBe(2400000);
  });

  it('selectAudioRendition은 DEFAULT=YES를 우선한다', () => {
    const playlist = parsePlaylist(master, BASE);
    if (playlist.kind !== 'master') throw new Error('master여야 함');
    const variant = selectVariant(playlist);
    if (!variant) throw new Error('variant 없음');
    expect(selectAudioRendition(playlist, variant)?.name).toBe('English');
  });

  it('AUDIO 그룹이 없으면 오디오 렌디션은 null', () => {
    const noAudio = ['#EXTM3U', '#EXT-X-STREAM-INF:BANDWIDTH=1000', 'v.m3u8'].join('\n');
    const playlist = parsePlaylist(noAudio, BASE);
    if (playlist.kind !== 'master') throw new Error('master여야 함');
    const variant = selectVariant(playlist);
    if (!variant) throw new Error('variant 없음');
    expect(selectAudioRendition(playlist, variant)).toBeNull();
  });
});

describe('parsePlaylist — media', () => {
  it('세그먼트, ENDLIST, media sequence를 파싱한다', () => {
    const media = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:10',
      '#EXT-X-MEDIA-SEQUENCE:5',
      '#EXTINF:9.5,',
      'seg5.ts',
      '#EXTINF:10,',
      'seg6.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');
    const playlist = parsePlaylist(media, BASE);
    if (playlist.kind !== 'media') throw new Error('media여야 함');
    expect(playlist.endlist).toBe(true);
    expect(playlist.segments).toHaveLength(2);
    expect(playlist.segments[0]?.url).toBe('https://cdn.example.com/hls/seg5.ts');
    expect(playlist.segments[0]?.durationSec).toBe(9.5);
    expect(playlist.segments[0]?.mediaSequence).toBe(5);
    expect(playlist.segments[1]?.mediaSequence).toBe(6);
  });

  it('ENDLIST가 없으면 라이브로 표시한다', () => {
    const live = ['#EXTM3U', '#EXTINF:6,', 'a.ts'].join('\n');
    const playlist = parsePlaylist(live, BASE);
    if (playlist.kind !== 'media') throw new Error('media여야 함');
    expect(playlist.endlist).toBe(false);
  });

  it('EXT-X-KEY는 이후 세그먼트에 적용되고 METHOD=NONE에서 해제된다', () => {
    const media = [
      '#EXTM3U',
      '#EXTINF:6,',
      'clear1.ts',
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x0102030405060708090a0b0c0d0e0f10',
      '#EXTINF:6,',
      'enc1.ts',
      '#EXT-X-KEY:METHOD=NONE',
      '#EXTINF:6,',
      'clear2.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');
    const playlist = parsePlaylist(media, BASE);
    if (playlist.kind !== 'media') throw new Error('media여야 함');
    expect(playlist.segments[0]?.key).toBeUndefined();
    expect(playlist.segments[1]?.key?.method).toBe('AES-128');
    expect(playlist.segments[1]?.key?.url).toBe('https://cdn.example.com/hls/key.bin');
    expect(playlist.segments[1]?.key?.iv).toBe('0x0102030405060708090a0b0c0d0e0f10');
    expect(playlist.segments[2]?.key).toBeUndefined();
  });

  it('EXT-X-MAP(fMP4 init)을 세그먼트에 연결한다', () => {
    const media = [
      '#EXTM3U',
      '#EXT-X-MAP:URI="init.mp4"',
      '#EXTINF:4,',
      'seg1.m4s',
      '#EXT-X-ENDLIST',
    ].join('\n');
    const playlist = parsePlaylist(media, BASE);
    if (playlist.kind !== 'media') throw new Error('media여야 함');
    expect(playlist.segments[0]?.map?.url).toBe('https://cdn.example.com/hls/init.mp4');
  });

  it('EXT-X-BYTERANGE의 오프셋 생략은 직전 범위 끝을 잇는다', () => {
    const media = [
      '#EXTM3U',
      '#EXTINF:4,',
      '#EXT-X-BYTERANGE:1000@0',
      'all.ts',
      '#EXTINF:4,',
      '#EXT-X-BYTERANGE:500',
      'all.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');
    const playlist = parsePlaylist(media, BASE);
    if (playlist.kind !== 'media') throw new Error('media여야 함');
    expect(playlist.segments[0]?.byteRange).toEqual({ length: 1000, offset: 0 });
    expect(playlist.segments[1]?.byteRange).toEqual({ length: 500, offset: 1000 });
  });
});
