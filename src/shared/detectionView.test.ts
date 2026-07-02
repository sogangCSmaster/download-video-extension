import { describe, expect, it } from 'vitest';

import { collapseFrameDuplicates } from './detectionView';
import type { DetectedVideo } from './types';

function video(partial: Partial<DetectedVideo> & Pick<DetectedVideo, 'id' | 'kind'>): DetectedVideo {
  return {
    url: `https://cdn.example.com/${partial.id}`,
    sources: ['network'],
    ...partial,
  };
}

describe('collapseFrameDuplicates', () => {
  it('같은 프레임의 blob+HLS를 하나로 합치고 blob의 제목/포스터를 옮긴다', () => {
    const blob = video({
      id: 'b1',
      kind: 'blob',
      url: 'blob:https://x/abc',
      sources: ['dom'],
      frameId: 3,
      pageTitle: '01_Opening',
      posterUrl: 'https://x/p.jpg',
    });
    const hls = video({ id: 'h1', kind: 'hls', frameId: 3, url: 'https://x/file_id_1.m3u8' });

    const result = collapseFrameDuplicates([blob, hls]);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('h1');
    expect(result[0]?.kind).toBe('hls');
    expect(result[0]?.pageTitle).toBe('01_Opening');
    expect(result[0]?.posterUrl).toBe('https://x/p.jpg');
  });

  it('스트림에 이미 제목이 있으면 유지한다', () => {
    const blob = video({ id: 'b1', kind: 'blob', frameId: 1, pageTitle: 'from-blob' });
    const dash = video({ id: 'd1', kind: 'dash', frameId: 1, pageTitle: 'from-stream' });
    const result = collapseFrameDuplicates([blob, dash]);
    expect(result).toHaveLength(1);
    expect(result[0]?.pageTitle).toBe('from-stream');
  });

  it('프레임이 다르면 합치지 않는다', () => {
    const blob = video({ id: 'b1', kind: 'blob', frameId: 1, pageTitle: 't' });
    const hls = video({ id: 'h1', kind: 'hls', frameId: 2 });
    expect(collapseFrameDuplicates([blob, hls])).toHaveLength(2);
  });

  it('한 프레임에 스트림이 여러 개면(모호) 합치지 않는다', () => {
    const blob = video({ id: 'b1', kind: 'blob', frameId: 0, pageTitle: 't' });
    const h1 = video({ id: 'h1', kind: 'hls', frameId: 0 });
    const h2 = video({ id: 'h2', kind: 'hls', frameId: 0 });
    expect(collapseFrameDuplicates([blob, h1, h2])).toHaveLength(3);
  });

  it('한 프레임에 blob이 여러 개면(모호) 합치지 않는다', () => {
    const b1 = video({ id: 'b1', kind: 'blob', frameId: 0, pageTitle: 't1' });
    const b2 = video({ id: 'b2', kind: 'blob', frameId: 0, pageTitle: 't2' });
    const hls = video({ id: 'h1', kind: 'hls', frameId: 0 });
    expect(collapseFrameDuplicates([b1, b2, hls])).toHaveLength(3);
  });

  it('여러 iframe(각 blob+HLS)을 각각 합친다', () => {
    const input = [
      video({ id: 'b1', kind: 'blob', frameId: 1, pageTitle: '01' }),
      video({ id: 'h1', kind: 'hls', frameId: 1 }),
      video({ id: 'b2', kind: 'blob', frameId: 2, pageTitle: '02' }),
      video({ id: 'h2', kind: 'hls', frameId: 2 }),
    ];
    const result = collapseFrameDuplicates(input);
    expect(result.map((v) => v.id)).toEqual(['h1', 'h2']);
    expect(result.map((v) => v.pageTitle)).toEqual(['01', '02']);
  });

  it('direct(mp4)는 blob과 합치지 않는다', () => {
    const blob = video({ id: 'b1', kind: 'blob', frameId: 1, pageTitle: 't' });
    const direct = video({ id: 'm1', kind: 'direct', frameId: 1 });
    expect(collapseFrameDuplicates([blob, direct])).toHaveLength(2);
  });

  it('합칠 대상이 없으면 원본 배열을 그대로 반환한다', () => {
    const input = [video({ id: 'h1', kind: 'hls', frameId: 1 })];
    expect(collapseFrameDuplicates(input)).toBe(input);
  });
});
