# Video Downloader (Chrome Extension)

현재 페이지에서 탐지된 동영상 목록을 보여주고 다운로드할 수 있는 Chrome 확장 프로그램 (Manifest V3).

## 기능

- 페이지의 `<video>` 태그와 네트워크 미디어 요청을 함께 관찰해 동영상을 탐지 (양쪽에서 잡힌 항목은 하나로 병합)
- 팝업에서 탐지된 목록 확인 및 다운로드 (해상도·길이·용량 표시)
- 툴바 아이콘 배지에 탭별 탐지 개수 표시
- 직접 파일(mp4, webm, ogg, mov, m4v) 다운로드
- **HLS(m3u8)/DASH(mpd) 스트리밍 다운로드**: 세그먼트를 수집해 ffmpeg.wasm으로 단일 MP4로 변환
  - 최고 화질 variant/representation 자동 선택
  - HLS AES-128 암호화 세그먼트 복호화 (WebCrypto)
  - DASH·HLS의 분리된 비디오/오디오 트랙을 하나의 MP4로 병합
  - 팝업에 단계별 진행률 표시 (준비 → 다운로드 % → 변환 → 저장), 취소 지원

## 개발 환경

```bash
npm install
npm run dev      # 개발 모드 (HMR)
npm run build    # 타입 체크 + 프로덕션 빌드 → dist/
npm run test     # 단위 테스트 (vitest)
```

### Chrome에 로드하기

1. `npm run build` (또는 `npm run dev`)
2. `chrome://extensions` 접속 → 우측 상단 **개발자 모드** 활성화
3. **압축해제된 확장 프로그램을 로드합니다** → `dist/` 폴더 선택

## 아키텍처

```
src/
├── shared/       # 순수 코드: 도메인 타입, 타입 안전 메시징, URL 분류, 파일명 생성
│   └── streaming/ # HLS(M3U8)·DASH(MPD) 파서 — 순수 함수, vitest로 테스트
├── content/      # DOM에서 <video> 후보 수집 (MutationObserver로 동적 페이지 대응)
├── background/   # 상태 관리(storage.session)·네트워크 탐지(webRequest)·다운로드·배지
│   └── download/ # Downloader 인터페이스 — direct(URL 그대로) / stream(HLS·DASH)
├── offscreen/    # 스트림 다운로드 실행기: 세그먼트 수집·복호화·ffmpeg.wasm 변환
└── popup/        # 목록 UI (vanilla TS)
```

- **탐지 흐름**: content script(DOM 스캔) / background(webRequest 관찰: media + 매니페스트 xhr) → 정규화 URL 기준 dedupe·병합 → `chrome.storage.session`의 `videos:<tabId>` 키에 저장
- **메시징**: `src/shared/messages.ts`의 discriminated union — SW용(`DOWNLOAD_VIDEO`, `STREAM_JOB_*` 등)과 offscreen용(`OFFSCREEN_*`)을 분리
- **manifest**: `manifest.config.ts`가 권한·엔트리의 단일 진실 공급원

### 스트림 다운로드 파이프라인

MV3 service worker에는 `DOMParser`·`URL.createObjectURL`·`Worker`가 없어 실제 작업은
[offscreen 문서](https://developer.chrome.com/docs/extensions/reference/api/offscreen)가 수행한다.

```
popup ─DOWNLOAD_VIDEO→ SW(streamDownloader) ─OFFSCREEN_START_JOB→ offscreen
  offscreen: 매니페스트 파싱 → 세그먼트 fetch(동시 4, AES-128 복호화) → ffmpeg.wasm mux → blob URL
  ─STREAM_JOB_COMPLETE→ SW가 chrome.downloads.download(blob URL) → 완료 시 blob 해제·offscreen 종료
진행률: offscreen → SW → storage.session dl:<tabId> → popup (팝업을 닫았다 열어도 복원)
```

- SW는 언제든 종료될 수 있으므로 잡 상태를 메모리에 두지 않는다 — offscreen 메시지가 식별 정보를 자체 포함하고, `downloadId→blob` 매핑은 storage.session에 영속
- ffmpeg.wasm은 MV3 CSP에서 blob: worker가 금지라 worker/core/wasm 전부를
  `dist/vendor/`의 `chrome-extension://` URL로 로드한다 (`'wasm-unsafe-eval'` CSP 필요, `src/offscreen/ffmpegMuxer.ts` 참고)

## 알려진 제약

- `blob:` URL(MSE 기반 플레이어)은 원리상 URL 다운로드 불가 — 대신 재생 시 네트워크에서 잡히는 HLS/DASH 매니페스트 항목으로 다운로드
- 스트림 조립이 전부 메모리에서 이뤄져(피크 ≈ 스트림 크기의 2.5~3배) 원본 총량을 **1GiB로 제한** — 초과 시 오류 표시. 디스크 스트리밍(OPFS)은 향후 과제
- **라이브 스트림**(ENDLIST 없는 HLS, dynamic MPD)과 **DRM**(SAMPLE-AES, Widevine 등 ContentProtection)은 명시적 오류로 거부
- 확장 컨텍스트에서 fetch하므로 Referer를 검사하는 CDN은 403으로 실패할 수 있음 — 에러 메시지로 표시
- 다중 Period MPD는 첫 Period만 다운로드
