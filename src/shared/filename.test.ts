import { describe, expect, it } from 'vitest';

import { buildDownloadFilename } from './filename';

describe('buildDownloadFilename', () => {
  it('URL basename을 사용한다', () => {
    expect(buildDownloadFilename({ url: 'https://a.com/videos/movie.mp4' })).toBe('movie.mp4');
  });

  it('query/fragment를 무시한다', () => {
    expect(buildDownloadFilename({ url: 'https://a.com/v.webm?token=abc#t=3' })).toBe('v.webm');
  });

  it('인코딩된 파일명을 디코드한다', () => {
    expect(buildDownloadFilename({ url: 'https://a.com/%EB%8F%99%EC%98%81%EC%83%81.mp4' })).toBe(
      '동영상.mp4',
    );
  });

  it('확장자 없으면 mime에서 유추한다', () => {
    expect(buildDownloadFilename({ url: 'https://a.com/stream', mimeType: 'video/webm' })).toBe(
      'stream.webm',
    );
  });

  it('mime도 없으면 기본 확장자 .mp4', () => {
    expect(buildDownloadFilename({ url: 'https://a.com/stream' })).toBe('stream.mp4');
  });

  it('basename이 없으면 pageTitle을 사용한다', () => {
    expect(
      buildDownloadFilename({ url: 'https://a.com/', pageTitle: 'My Page', mimeType: 'video/mp4' }),
    ).toBe('My Page.mp4');
  });

  it('아무것도 없으면 기본 이름', () => {
    expect(buildDownloadFilename({ url: 'https://a.com/' })).toBe('video.mp4');
  });

  it('예약 문자를 제거한다', () => {
    expect(buildDownloadFilename({ url: 'https://a.com/a%3Ab%3Fc.mp4' })).toBe('a b c.mp4');
  });

  it('선행 마침표를 제거한다 (숨김 파일 방지)', () => {
    expect(buildDownloadFilename({ url: 'https://a.com/.hidden.mp4' })).toBe('hidden.mp4');
  });

  it('긴 이름을 자른다', () => {
    const long = 'a'.repeat(300);
    const result = buildDownloadFilename({ url: `https://a.com/${long}.mp4` });
    expect(result.length).toBeLessThanOrEqual(185);
    expect(result.endsWith('.mp4')).toBe(true);
  });

  it('숫자 버전은 확장자로 오인하지 않는다', () => {
    expect(buildDownloadFilename({ url: 'https://a.com/video.v1.2', mimeType: 'video/mp4' })).toBe(
      'video.v1.2.mp4',
    );
  });
});
