# Video Downloader (Chrome Extension)

현재 페이지에서 탐지된 동영상 목록을 보여주고 다운로드할 수 있는 Chrome 확장 프로그램 (Manifest V3).

## 기능

- 페이지의 `<video>` 태그와 네트워크 미디어 요청을 함께 관찰해 동영상을 탐지 (양쪽에서 잡힌 항목은 하나로 병합)
- 팝업에서 탐지된 목록 확인 및 다운로드 (해상도·길이·용량 표시)
- 툴바 아이콘 배지에 탭별 탐지 개수 표시
- 직접 파일(mp4, webm, ogg, mov, m4v)만 다운로드 지원 — `blob:`(MSE 스트리밍)·HLS·DASH는 탐지 시 미지원으로 표시하거나 제외

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
├── content/      # DOM에서 <video> 후보 수집 (MutationObserver로 동적 페이지 대응)
├── background/   # 상태 관리(storage.session)·네트워크 탐지(webRequest)·다운로드·배지
│   └── download/ # Downloader 인터페이스 — HLS 지원 시 여기에 다운로더 추가
└── popup/        # 목록 UI (vanilla TS)
```

- **탐지 흐름**: content script(DOM 스캔) / background(webRequest 관찰) → 정규화 URL 기준 dedupe·병합 → `chrome.storage.session`의 `videos:<tabId>` 키에 저장
- **메시징**: `src/shared/messages.ts`의 discriminated union — `VIDEOS_DETECTED`, `GET_VIDEOS`, `DOWNLOAD_VIDEO`, `RESCAN_TAB`
- **manifest**: `manifest.config.ts`가 권한·엔트리의 단일 진실 공급원

## 알려진 제약 (1단계)

- `blob:` URL(유튜브 등 MSE 기반 플레이어)은 원리상 URL 다운로드 불가 — 목록에 비활성으로 표시
- HLS(m3u8)/DASH(mpd) 스트림: 네트워크에서 탐지된 것은 목록에서 제외하고, `<video>` 태그에서 발견된 것은 미지원 배지와 함께 비활성으로 표시 — 2단계에서 `Downloader` 인터페이스로 확장 예정
- Referer를 검사하는 서버는 다운로드가 403으로 실패할 수 있음 — 에러 메시지로 표시
