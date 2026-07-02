import type { DetectedVideo } from './types';

/**
 * MSE 플레이어의 blob <video>와, 그 플레이어가 실제로 받아오는 HLS/DASH 스트림은
 * 같은 논리적 영상이다. 하지만 URL이 서로 달라(blob: vs https .m3u8) 별도 항목으로
 * 잡히므로, 같은 프레임(iframe)에 blob 1개 + 스트림 1개인 명확한 경우에만 하나로 합친다.
 *
 * 결과: blob 항목은 목록에서 제거하고, 남는 스트림 항목에 blob이 갖고 있던 제목/포스터를
 * 옮긴다 (스트림 URL의 basename은 대개 불투명한 file_id라 사람이 읽을 제목이 없다).
 *
 * 모호한 경우(한 프레임에 blob 여러 개 또는 스트림 여러 개)는 어느 것이 짝인지 알 수
 * 없으므로 합치지 않고 그대로 둔다. 프레임이 다르면(플레이어가 매니페스트를 상위
 * 프레임에서 요청하는 등) 짝을 맺지 못하고 두 항목이 남는데, 이는 안전한 폴백이다.
 *
 * 순수 함수 — storage/detection 상태를 바꾸지 않고 표시용 뷰만 만든다.
 */
export function collapseFrameDuplicates(videos: DetectedVideo[]): DetectedVideo[] {
  const byFrame = new Map<number, DetectedVideo[]>();
  for (const video of videos) {
    const frame = video.frameId ?? 0;
    const group = byFrame.get(frame);
    if (group) group.push(video);
    else byFrame.set(frame, [video]);
  }

  const dropIds = new Set<string>();
  const enrichById = new Map<string, DetectedVideo>();

  for (const group of byFrame.values()) {
    const blobs = group.filter((v) => v.kind === 'blob');
    const streams = group.filter((v) => v.kind === 'hls' || v.kind === 'dash');
    if (blobs.length !== 1 || streams.length !== 1) continue;

    const [blob] = blobs;
    const [stream] = streams;
    if (!blob || !stream) continue;

    dropIds.add(blob.id);
    enrichById.set(stream.id, {
      ...stream,
      pageTitle: stream.pageTitle ?? blob.pageTitle,
      posterUrl: stream.posterUrl ?? blob.posterUrl,
    });
  }

  if (dropIds.size === 0) return videos;
  return videos.filter((v) => !dropIds.has(v.id)).map((v) => enrichById.get(v.id) ?? v);
}
