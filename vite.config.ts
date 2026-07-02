import { crx } from '@crxjs/vite-plugin';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

import manifest from './manifest.config';

export default defineConfig({
  plugins: [
    crx({ manifest }),
    // ffmpeg.wasm 자산은 번들링하지 않고 그대로 복사한다.
    // - @ffmpeg/ffmpeg의 worker.js가 ./const.js 등을 상대 import하므로 esm 디렉터리 통째로 복사.
    // - MV3 CSP상 blob: worker가 금지라 이 파일들을 chrome.runtime.getURL로 로드한다 (ffmpegMuxer.ts).
    viteStaticCopy({
      targets: [
        // stripBase: 소스 경로(node_modules/...)를 떼고 dest 바로 아래에 놓는다
        {
          src: 'node_modules/@ffmpeg/ffmpeg/dist/esm/*',
          dest: 'vendor/ffmpeg',
          rename: { stripBase: true },
        },
        {
          src: 'node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.{js,wasm}',
          dest: 'vendor/ffmpeg-core',
          rename: { stripBase: true },
        },
      ],
    }),
  ],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)),
    },
  },
  optimizeDeps: {
    // dev 서버가 worker URL을 재작성하지 않도록 사전 번들링에서 제외
    exclude: ['@ffmpeg/ffmpeg'],
  },
  build: {
    rollupOptions: {
      input: {
        // offscreen 문서는 manifest에 선언되지 않고 chrome.offscreen.createDocument로 열리므로
        // crxjs가 아닌 일반 rollup 입력으로 추가한다 → dist/src/offscreen/index.html
        offscreen: 'src/offscreen/index.html',
      },
    },
  },
});
