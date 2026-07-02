import { describe, expect, it } from 'vitest';

import { classifyVideoUrl, normalizeUrl, videoIdFromUrl } from './urlUtils';

describe('normalizeUrl', () => {
  it('fragment를 제거한다', () => {
    expect(normalizeUrl('https://a.com/v.mp4#t=10')).toBe('https://a.com/v.mp4');
  });

  it('query는 유지한다', () => {
    expect(normalizeUrl('https://a.com/v.mp4?token=x')).toBe('https://a.com/v.mp4?token=x');
  });

  it('URL이 아니면 원문을 반환한다', () => {
    expect(normalizeUrl('not-a-url')).toBe('not-a-url');
  });
});

describe('videoIdFromUrl', () => {
  it('같은 자원(fragment만 다름)은 같은 id를 만든다', () => {
    expect(videoIdFromUrl('https://a.com/v.mp4#t=10')).toBe(videoIdFromUrl('https://a.com/v.mp4'));
  });

  it('다른 URL은 다른 id를 만든다', () => {
    expect(videoIdFromUrl('https://a.com/v1.mp4')).not.toBe(videoIdFromUrl('https://a.com/v2.mp4'));
  });
});

describe('classifyVideoUrl', () => {
  it('blob URL은 blob', () => {
    expect(classifyVideoUrl('blob:https://a.com/uuid')).toBe('blob');
  });

  it('확장자로 direct 판별', () => {
    expect(classifyVideoUrl('https://a.com/v.mp4')).toBe('direct');
    expect(classifyVideoUrl('https://a.com/v.webm?q=1')).toBe('direct');
  });

  it('mime으로 direct 판별 (확장자 없어도)', () => {
    expect(classifyVideoUrl('https://a.com/stream', 'video/mp4')).toBe('direct');
    expect(classifyVideoUrl('https://a.com/stream', 'video/mp4; codecs="avc1"')).toBe('direct');
  });

  it('HLS/DASH를 분류한다', () => {
    expect(classifyVideoUrl('https://a.com/master.m3u8')).toBe('hls');
    expect(classifyVideoUrl('https://a.com/x', 'application/vnd.apple.mpegURL')).toBe('hls');
    expect(classifyVideoUrl('https://a.com/manifest.mpd')).toBe('dash');
    expect(classifyVideoUrl('https://a.com/x', 'application/dash+xml')).toBe('dash');
  });

  it('동영상이 아니면 null', () => {
    expect(classifyVideoUrl('https://a.com/page.html')).toBeNull();
    expect(classifyVideoUrl('https://a.com/x', 'text/html')).toBeNull();
  });
});
