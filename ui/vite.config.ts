import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { resolve } from 'node:path';

// Vite config for the UI widget.
// Emits a single self-contained index.html (via vite-plugin-singlefile) that the MCP
// server serves as the `ui://viewer` resource body.
export default defineConfig({
  root: resolve(__dirname),
  plugins: [viteSingleFile()],
  build: {
    // Separate from dist/ui/ (which holds compiled TS) to avoid collision.
    outDir: resolve(__dirname, '../dist/widget'),
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        manualChunks: undefined,
      },
    },
  },
});
