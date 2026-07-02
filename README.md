# Video Downloader (Chrome Extension)

A Chrome extension (Manifest V3) that lists the videos detected on the current page and lets you download them.

## Features

- Detects videos by observing both `<video>` tags in the page and network media requests (entries caught by both are merged into one)
- Popup lists detected videos with download buttons (shows resolution, duration, and size)
- Toolbar icon badge shows the per-tab detection count
- Direct file downloads (mp4, webm, ogg, mov, m4v)
- **HLS (m3u8) / DASH (mpd) stream downloads**: collects segments and converts them into a single MP4 with ffmpeg.wasm
  - Automatically selects the highest-quality variant/representation
  - Decrypts HLS AES-128 encrypted segments (WebCrypto)
  - Merges separate video/audio tracks (DASH, HLS renditions) into one MP4
  - Per-phase progress in the popup (preparing → downloading % → converting → saving), with cancel support
- Localized UI (English/Korean) via `chrome.i18n` — catalogs live in `public/_locales/`

## Development

```bash
npm install
npm run dev      # dev mode (HMR)
npm run build    # typecheck + production build → dist/
npm run test     # unit tests (vitest)
```

### Loading into Chrome

1. `npm run build` (or `npm run dev`)
2. Open `chrome://extensions` → enable **Developer mode** (top right)
3. Click **Load unpacked** → select the `dist/` folder

## Architecture

```
src/
├── shared/       # Pure code: domain types, type-safe messaging, URL classification, filename generation, i18n helper
│   └── streaming/ # HLS (M3U8) / DASH (MPD) parsers — pure functions, tested with vitest
├── content/      # Collects <video> candidates from the DOM (MutationObserver for dynamic pages)
├── background/   # State (storage.session), network detection (webRequest), downloads, badge
│   └── download/ # Downloader interface — direct (URL as-is) / stream (HLS·DASH)
├── offscreen/    # Stream download executor: segment collection, decryption, ffmpeg.wasm conversion
└── popup/        # List UI (vanilla TS)
```

- **Detection flow**: content script (DOM scan) / background (webRequest observation: media + manifest XHR) → dedupe/merge by normalized URL → stored under the `videos:<tabId>` key in `chrome.storage.session`
- **Messaging**: discriminated union in `src/shared/messages.ts` — service-worker messages (`DOWNLOAD_VIDEO`, `STREAM_JOB_*`, …) are kept separate from offscreen messages (`OFFSCREEN_*`)
- **Manifest**: `manifest.config.ts` is the single source of truth for permissions and entry points
- **i18n**: `manifest.json` uses `__MSG_*__` placeholders; runtime strings go through the typed `t()` helper in `src/shared/i18n.ts`. To add a locale, add `public/_locales/<locale>/messages.json`

### Stream download pipeline

The MV3 service worker has no `DOMParser`, `URL.createObjectURL`, or `Worker`, so the actual work happens
in an [offscreen document](https://developer.chrome.com/docs/extensions/reference/api/offscreen).

```
popup ─DOWNLOAD_VIDEO→ SW (streamDownloader) ─OFFSCREEN_START_JOB→ offscreen
  offscreen: parse manifest → fetch segments (4 concurrent, AES-128 decryption) → ffmpeg.wasm mux → blob URL
  ─STREAM_JOB_COMPLETE→ SW calls chrome.downloads.download(blob URL) → on completion, release blob & close offscreen
progress: offscreen → SW → storage.session dl:<tabId> → popup (restored even after the popup is closed and reopened)
```

- The SW can be terminated at any time, so job state is never kept in memory — offscreen messages are self-describing, and the `downloadId → blob` mapping is persisted in storage.session
- ffmpeg.wasm cannot use `blob:` workers under the MV3 CSP, so the worker/core/wasm files are all loaded
  from `chrome-extension://` URLs in `dist/vendor/` (requires the `'wasm-unsafe-eval'` CSP; see `src/offscreen/ffmpegMuxer.ts`)

## Known limitations

- `blob:` URLs (MSE-based players) cannot be downloaded by URL in principle — instead, the HLS/DASH manifest entries caught on the network during playback are used
- Stream assembly happens entirely in memory (peak ≈ 2.5–3× the stream size), so the source total is **capped at 1 GiB** — exceeding it shows an error. Disk streaming (OPFS) is future work
- **Live streams** (HLS without ENDLIST, dynamic MPD) and **DRM** (SAMPLE-AES, ContentProtection such as Widevine) are rejected with explicit errors
- Fetching happens from the extension context, so CDNs that check the Referer may fail with 403 — surfaced as an error message
- Multi-Period MPDs download only the first Period
