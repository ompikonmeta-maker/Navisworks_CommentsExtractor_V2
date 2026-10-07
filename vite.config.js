import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Portable single-file build:
//   - base './'                → works from any path, incl. file://
//   - viteSingleFile()         → inline all JS/CSS into one dist/index.html
//   - assetsInlineLimit huge   → embed the sample report + images as data
//                                URLs so nothing is fetched at runtime.
// Result: one self-contained index.html that runs by double-click, no
// server, no install, no admin rights.
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  build: {
    assetsInlineLimit: 100 * 1024 * 1024, // 100 MB — inline everything
    chunkSizeWarningLimit: 5000,
    cssCodeSplit: false,
  },
});
