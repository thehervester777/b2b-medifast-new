import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/*
 * Two builds:
 *   npm run build         -> dist/         (code-split, jsPDF loads on demand)
 *   npm run build:single  -> dist-single/  (one self-contained index.html for quick sharing)
 *
 * CSS goes through lightningcss so modern syntax (nesting, clamp, inset, ...)
 * is down-levelled for older Android WebViews that many low-end phones still run.
 */
const targets = {
  chrome: 80 << 16,
  android: 80 << 16,
  safari: 13 << 16,
  ios_saf: 13 << 16,
  firefox: 78 << 16,
  samsung: 12 << 16,
};

export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    plugins: single ? [viteSingleFile()] : [],
    css: {
      transformer: 'lightningcss',
      lightningcss: { targets },
    },
    build: {
      target: ['chrome80', 'safari13', 'firefox78'],
      cssMinify: 'lightningcss',
      cssCodeSplit: false,
      sourcemap: false,
      reportCompressedSize: true,
      outDir: single ? 'dist-single' : 'dist',
      assetsInlineLimit: single ? 100_000_000 : 2048,
    },
  };
});
