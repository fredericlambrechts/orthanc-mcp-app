import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { resolve } from 'node:path';

// Vite config for the UI widget.
// Emits a single self-contained index.html (via vite-plugin-singlefile) that the MCP
// server serves as the `ui://viewer` resource body.
export default defineConfig({
  root: resolve(__dirname),
  plugins: [viteSingleFile()],
  worker: {
    // singlefile builds are IIFE/no-split; ESM workers are compatible.
    // Cornerstone's DICOM image loader ships web-worker-spawning code;
    // without this vite tries to emit an IIFE worker chunk and fails with
    // "UMD and IIFE output formats are not supported for code-splitting".
    format: 'es',
  },
  build: {
    // Separate from dist/ui/ (which holds compiled TS) to avoid collision.
    outDir: resolve(__dirname, '../dist/widget'),
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        manualChunks: undefined,
      },
    },
  },
});
