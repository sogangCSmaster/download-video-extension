import { defineManifest } from '@crxjs/vite-plugin';

import pkg from './package.json';

export default defineManifest({
  manifest_version: 3,
  name: 'Video Downloader',
  description: '현재 페이지에서 탐지된 동영상을 다운로드합니다.',
  version: pkg.version,
  icons: {
    16: 'icons/icon-16.png',
    48: 'icons/icon-48.png',
    128: 'icons/icon-128.png',
  },
  permissions: ['downloads', 'storage', 'webRequest'],
  host_permissions: ['<all_urls>'],
  background: {
    // 주의: background/content 진입점 파일명이 같으면(index.ts 등) CRXJS가 청크를 뒤섞는
    // 버그가 있어 고유한 파일명을 사용한다.
    service_worker: 'src/background/serviceWorker.ts',
    type: 'module',
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/contentScript.ts'],
      run_at: 'document_idle',
      all_frames: true,
    },
  ],
  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'Video Downloader',
  },
});
