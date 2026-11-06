import { defineConfig } from 'vite';

/*
 * `npm run build` writes dist/ (code-split, one small chunk per page). Asset paths are relative ('./'), so the
 * same build works wherever the server mounts it (the panel lives at /admin/).
 *
 * CSS goes through lightningcss so modern syntax (nesting, clamp, inset, ...) is down-levelled for the older
 * Android WebViews that many low-end phones still run.
 */
const targets = {
  chrome: 80 << 16,
  android: 80 << 16,
  safari: 13 << 16,
  ios_saf: 13 << 16,
  firefox: 78 << 16,
  samsung: 12 << 16,
};

export default defineConfig({
  base: './',
  /* `npm run dev:supplier` serves this app on its own port and forwards /api to the server (npm run dev, port 3000). */
  server: { port: 5174, proxy: { '/api': 'http://127.0.0.1:3000' } },
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
    outDir: 'dist',
    assetsInlineLimit: 2048,
  },
});
