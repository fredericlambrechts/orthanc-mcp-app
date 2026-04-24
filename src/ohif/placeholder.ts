import { type Request, type Response } from 'express';

/**
 * Placeholder OHIF endpoint for U4.
 *
 * Real OHIF v3 static bundle is fetched and served from `/ohif/*` in U6.
 * Until then, this placeholder renders the inbound query params so we can
 * verify end-to-end URL plumbing without dragging in the ~30 MB OHIF bundle.
 */
export function ohifPlaceholder(req: Request, res: Response): void {
  const { StudyInstanceUIDs, SeriesInstanceUIDs, url } = req.query;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>OHIF placeholder</title>
  <style>
    body { margin: 0; padding: 32px; background: #151515; color: #eee;
           font: 14px/1.5 -apple-system, Segoe UI, sans-serif; }
    pre { background: #000; padding: 16px; border-radius: 4px; overflow-x: auto; }
    h1 { font-size: 16px; font-weight: 500; margin: 0 0 16px; }
    p { color: #a3a3a3; font-size: 12px; }
  </style>
</head>
<body>
  <h1>OHIF viewer (placeholder)</h1>
  <pre>StudyInstanceUIDs: ${escapeHtml(String(StudyInstanceUIDs ?? '(none)'))}
SeriesInstanceUIDs: ${escapeHtml(String(SeriesInstanceUIDs ?? '(none)'))}
DICOMweb base URL: ${escapeHtml(String(url ?? '(none)'))}</pre>
  <p>
    This is a placeholder. The real OHIF v3 bundle will be served from this
    path in U6. For demonstration, education, and non-diagnostic use only.
  </p>
</body>
</html>`);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
