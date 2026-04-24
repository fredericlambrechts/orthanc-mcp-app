---
title: Handoff - real DICOM pixels render inline in Claude via server-side PNG
date: 2026-04-24
status: inline widget renders server-rendered DICOM pixels in-chat; launch-card scrapped
last_session: 2026-04-24 late evening
---

# Handoff - pick up here in a fresh session

## Quick summary

**The widget renders actual DICOM pixels inline in Claude.ai.** No nested
iframe, no OHIF bundle in the widget, no cornerstone megabytes. The server
decodes DICOM → PNG at `/render/:server/:study/:series/:instance.png`, the
widget body is a thin `<img>`-per-slice viewer with wheel-scroll slice
navigation and series tabs. 272 KB widget bundle.

See [tmp/brainix-widget-sandboxed.png](tmp/brainix-widget-sandboxed.png) for
the proof screenshot of the sandboxed-iframe e2e test — the widget is
rendering the coronal BRAINIX MR slice with all seven series as tabs along
the top.

## What changed in this session

- **Discovered Claude's CSP constraint**: the MCP Apps runtime propagates
  only `connectDomains` and `resourceDomains` from the widget's
  `_meta.ui.csp` (surfaced on the widget iframe URL as `connect-src=` and
  `resource-src=`). `frameDomains` is silently dropped. Nested
  cross-origin iframes inside the widget are blocked. This makes
  OHIF-in-nested-iframe impossible.
- **Pivoted twice**. First to a "launch card" that opens OHIF in a new
  tab (rejected as a workaround that defeats the inline goal). Then
  evaluated Cornerstone3D and dwv in the widget — both want web workers
  and produce 5+ MB bundles that `vite-plugin-singlefile` can't inline.
- **Landed on server-side DICOM→PNG**. [src/render/dicomPng.ts](src/render/dicomPng.ts)
  parses DICOM (uncompressed Little Endian only, which covers all Orthanc
  demo studies), applies a linear VOI LUT, downscales to 640 px max edge,
  encodes PNG with pngjs. Route at
  `/render/:serverId/:studyUid/:seriesUid/:instanceUid.png` fetches the
  WADO-RS instance upstream, decodes, responds. Caches for 24 h.
- **New widget**: [ui/src/widget.ts](ui/src/widget.ts) fetches series +
  instance lists via DICOMweb, renders `<img src="/render/…">`, handles
  wheel scroll to swap slices, renders a series tab strip.
- **E2E proof**:
  [test/e2e/ohif-widget-sandboxed.e2e.test.ts](test/e2e/ohif-widget-sandboxed.e2e.test.ts)
  loads the widget in a sandboxed iframe with Claude-equivalent sandbox
  tokens + COEP: require-corp, plays the ext-apps handshake, pushes a
  synthetic `open_study` tool-result, and asserts a non-trivial `.png`
  response returned from `/render/`.
  [test/e2e/ohif-standalone.e2e.test.ts](test/e2e/ohif-standalone.e2e.test.ts)
  still exercises the full OHIF SPA at `/ohif/viewer`.

## URLs

- **Widget** (MCP resource): `ui://viewer-v12` served from our `/mcp`
  endpoint. Bumped whenever the widget HTML changes so Claude re-fetches.
- **Render**: `https://orthanc-mcp-app.fly.dev/render/orthanc-demo/<study>/<series>/<instance>.png`
- **MCP**: `https://orthanc-mcp-app.fly.dev/mcp` (plus `/mcp-v2`, `/mcp-v3`
  aliases to let a user pick a cache-free URL when Claude's per-connector
  cache is in the way).
- **Shareable OHIF (full viewer in a new tab)**:
  `https://orthanc-mcp-app.fly.dev/ohif/viewer?StudyInstanceUIDs=<uid>`.
  Kept for anyone who wants scroll, window/level, MPR, etc.

Example studies:
- MR brain (BRAINIX): `2.16.840.1.113669.632.20.1211.10000357775`
- MR knee: `1.2.840.113619.2.176.2025.1499492.7391.1171285944.390`

## Widget flow in Claude

1. User says "open the BRAINIX brain MR study" (or similar).
2. Claude calls our `open_study` MCP tool. The tool resolves the study
   and returns `structuredContent.ui_meta.initialData` with
   `studyUid` + `dicomwebBaseUrl` (absolute URL to our proxy).
3. Claude fetches `resources/read ui://viewer-v12`, receives the built
   widget HTML (inlined JS, ~272 KB), renders it in a sandboxed iframe
   on `claudemcpcontent.com` with CSP from our `_meta.ui.csp`.
4. Claude sends the tool result to the widget via
   `ui/notifications/tool-result`.
5. Widget's `ontoolresult` handler:
   a. Reads `structuredContent.ui_meta.initialData`.
   b. `fetchSeriesList` → one DICOMweb QIDO-RS request.
   c. `fetchInstanceUids` for the preferred/first series → one request.
   d. Swaps in `<img src="/render/...">` for the middle instance.
   e. Renders series tabs + overlay (modality · description, slice N/M).
6. Wheel over the viewport → swap `<img src>` to the next instance.

## Source code map

- [src/render/dicomPng.ts](src/render/dicomPng.ts) — DICOM → PNG. Pulls
  the WADO-RS instance bytes, de-envelopes multipart, parses with
  dicom-parser, applies window/level (from DICOM or from min/max),
  downscales, encodes PNG. Throws `UnsupportedTransferSyntax` for
  compressed syntaxes (not implemented).
- [src/server.ts](src/server.ts) — Express app. Mounts `/render/...`,
  `/dicomweb/...` proxy, `/ohif/*` static, MCP routes, `/widget.html`.
  Sends CORP + COEP headers on every response (needed for Claude's
  COEP: require-corp widget host).
- [src/tools/open_study.ts](src/tools/open_study.ts) — emits absolute
  `dicomwebBaseUrl` (and the legacy `ohifBasePath` field for back-compat).
- [src/ui/resource.ts](src/ui/resource.ts) — `ui://viewer-v12` registration,
  CSP meta (`connectDomains` + `resourceDomains` are the keys Claude
  actually honors).
- [ui/src/widget.ts](ui/src/widget.ts) — widget entry, ext-apps
  handshake, `loadStudy`, wheel-scroll slice swap.
- [ui/src/bridge.ts](ui/src/bridge.ts) — DICOMweb helpers
  (`fetchSeriesList`, `fetchInstanceUids`), UI helpers (`setStatus`,
  `hidePlaceholder`, `shortenUid`), `createDebouncedStateUpdater`.
- [ui/index.html](ui/index.html) — widget shell (topbar + series tabs +
  viewport + footer).
- [ui/vite.config.ts](ui/vite.config.ts) — single-file output.
- [test/e2e/ohif-widget-sandboxed.e2e.test.ts](test/e2e/ohif-widget-sandboxed.e2e.test.ts)
  — widget e2e: reproduces Claude's sandbox, verifies `/render/*.png`
  response + writes tmp/brainix-widget-sandboxed.png.
- [test/e2e/ohif-standalone.e2e.test.ts](test/e2e/ohif-standalone.e2e.test.ts)
  — OHIF SPA e2e: cornerstone canvas sees non-zero pixels + writes
  tmp/brainix-standalone.png.

## Running the tests

```
npx vitest run                             # unit suite (~144)
E2E=1 npx vitest run test/e2e/             # playwright against prod
```

## Known limits / follow-ups

- **Only uncompressed Little Endian.** `renderDicomToPng` throws 415 for
  JPEG2000, JPEG-LS, RLE. The Orthanc demo studies are all Explicit VR
  Little Endian so this is fine for the demo. Adding compressed support
  means adding a Node DICOM decoder (`dcmjs-codecs`, native binding, etc.)
  — not done.
- **Window/level is static.** The server picks a W/C/W based on the DICOM
  tag or min/max, bakes it into the PNG, and caches. There's no client
  widget-level/preset toggle. Would be a 30-line addition: add a slider
  to the widget that drives `?wc=…&ww=…` query params.
- **MONOCHROME1 only on photometric check.** Color DICOM (US, MG) would
  need a different pixel unpacking path.
- **Series panel is thin.** No thumbnail preview, no sort control. Tabs
  only.
- **ohifBasePath legacy field** is still emitted by `open_study` for
  back-compat with the old iframe widget. Safe to remove next session.
- **Courtesy DM to Benoit Crickboom** (Orthanc lead) before any public
  launch — we're defaulting to their demo server.
- **Loom/blog demo** using the inline widget + the shareable URL.

## Recent commits

```
1a4d85b feat(widget): replace nested iframe with launch-card + openLink
a09c0fe feat(e2e): Playwright harness + CORP/COEP headers for inline embed
ff85d85 chore(deps): add playwright devDependency for e2e tests
856160f docs: HANDOFF - OHIF pixels render; inline embedding has sandbox quirk
30c6ab2 feat(ohif): self-hosted OHIF bundle renders DICOM pixels
162373f fix(mcp): return 404 for unknown session so client re-initializes
```

## Cost / ops

- Fly: single shared-cpu-1x, `min_machines_running=1`, suspend on idle.
  Cold resumes are sub-2s.
- `/render/*.png` is a public endpoint. Rate limiting and auth would be
  needed before exposing beyond the demo context.
- The render endpoint holds ~100 MB of cached PNGs per 24 h in memory via
  HTTP Cache-Control only (no server-side cache). Acceptable for demo
  traffic.
