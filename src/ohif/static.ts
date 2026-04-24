import { type Request, type Response, type NextFunction } from 'express';
import express from 'express';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// When compiled: dist/src/ohif/static.js -> ../../.. -> project root -> ohif-dist/
// When run under tsx: src/ohif/static.ts -> ../../ohif-dist
const PROD_OHIF_DIR = resolve(__dirname, '../../../ohif-dist');
const DEV_OHIF_DIR = resolve(__dirname, '../../ohif-dist');

function resolveOhifDir(): string | null {
  for (const p of [PROD_OHIF_DIR, DEV_OHIF_DIR]) {
    if (existsSync(p) && existsSync(resolve(p, 'index.html'))) {
      return p;
    }
  }
  return null;
}

/**
 * Returns an Express router that serves the OHIF static bundle from
 * ohif-dist/ if present. If the directory is empty or missing, returns null
 * so the caller can fall back to the placeholder endpoint.
 */
export function createOhifStaticRouter(): express.Router | null {
  const dir = resolveOhifDir();
  if (!dir) return null;

  const router = express.Router();

  // Serve the static assets.
  router.use(
    express.static(dir, {
      maxAge: '1h',
      etag: true,
      index: false,
    }),
  );

  // SPA fallback: any path under /ohif/* that doesn't match a file should
  // serve index.html. OHIF uses client-side routing for /viewer.
  router.get(/.*/, (req: Request, res: Response, next: NextFunction) => {
    const accept = req.headers.accept ?? '';
    if (!accept.includes('text/html')) {
      next();
      return;
    }
    res.sendFile(resolve(dir, 'index.html'));
  });

  return router;
}

export function hasOhifBundle(): boolean {
  return resolveOhifDir() !== null;
}
