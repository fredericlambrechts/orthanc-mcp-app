---
title: Handoff - OHIF renders DICOM pixels; inline embedding has a sandbox quirk
date: 2026-04-24
status: OHIF standalone works end-to-end; inline-in-Claude shows a broken-image placeholder
last_session: 2026-04-24 afternoon
---

# Handoff - pick up here in a fresh session

## Quick summary

**OHIF is rendering real DICOM pixels.** The self-hosted OHIF v3.12 bundle is
served from `/ohif/*` on Fly, pointed at our `/dicomweb/orthanc-demo/` proxy,
and it correctly queries the BRAINIX study (232 images across 7 series) and
renders axial MR slices with window/level, series thumbnails, and all the
standard OHIF chrome. Verified standalone at:

https://orthanc-mcp-app.fly.dev/ohif/viewer?StudyInstanceUIDs=2.16.840.1.113669.632.20.1211.10000357775

**Inline-in-Claude is still iffy.** The widget iframe mounts fullscreen
(1819×1147), the tool result reaches `ontoolresult` with `structuredContent`
intact, and the widget runs `loadStudyIntoIframe` with the right absolute URL.
But the nested OHIF iframe renders as a broken-image placeholder rather than
the viewer. Almost certainly a sandbox/CSP quirk specific to Claude's MCP Apps
iframe host — not a code bug in our widget or server.

- **Prod URL:** https://orthanc-mcp-app.fly.dev
- **MCP endpoint:** `/mcp` (and `/mcp-v2` alias)
- **OHIF viewer:** `/ohif/viewer?StudyInstanceUIDs=<uid>`
- **DICOMweb proxy:** `/dicomweb/orthanc-demo/*` → orthanc.uclouvain.be
- **Branch:** `main` (fast-forwarded from `claude/elastic-haslett-c8e8f1`)
- **Prod version:** `0.2.0-widget` (built from commit `30c6ab2`)

## What works end-to-end (verified 2026-04-24)

Visual proof captured during this session:

1. User sends "Show me the BRAINIX brain MR study."
2. Claude's MCP client receives 404 on its stale session-id → reinitializes.
3. `tools/call open_study` succeeds; `resources/read ui://viewer-v5` succeeds.
4. Widget mounts in Claude's sandbox iframe, connects via the ext-apps
   handshake (diag panel shows `widget js: running`, `app.connect: ok`,
   `ontoolresult: fired … keys=study_uid,server_id,reference_kind,ui_resource,ui_meta`).
5. `sendSizeChanged({ width: 900, height: 640 })` + `requestDisplayMode("fullscreen")`
   escalate the widget to the full chat viewport.
6. Widget calls `loadStudyIntoIframe(initialData)` with absolute
   `https://orthanc-mcp-app.fly.dev/ohif/viewer?StudyInstanceUIDs=…` URL.
7. Standalone (outside Claude): OHIF loads the full viewer, series panel,
   and renders actual MR pixels — see screenshot described in session logs.

## What's still off

**Inline OHIF iframe shows a broken-image placeholder in Claude's widget.**
Leading hypotheses, in priority order for a fresh investigation:

1. **Service-worker registration** — OHIF preloads
   `/ohif/init-service-worker.js`. Service workers can't register in
   sandboxed iframes without `allow-same-origin` on the OUTER iframe, and
   even then the behavior nested-inside-Claude's-sandbox may be blocked.
   Look for a config flag to disable SW, or ship a no-SW variant.
2. **CSP from Claude's sandbox host** — we declare `resourceDomains/
   connectDomains/frameDomains: [origin]` in the widget's `_meta.ui.csp`,
   but Claude's outer sandbox may apply a stricter CSP that forbids
   the nested iframe's load of the OHIF bundle.
3. **Sandbox attribute inheritance** — the outer widget iframe has
   `sandbox="allow-scripts allow-same-origin allow-forms"`. Nested iframes
   inherit the parent's sandbox unless overridden. OHIF wants workers,
   XHR, fullscreen — several of these may need explicit `allow-*` tokens
   (`allow-popups`, `allow-modals`, `allow-pointer-lock`, etc.) in the
   widget's declared permissions.
4. **Mixed content or redirect** — less likely since standalone loads
   cleanly from HTTPS, but worth a quick network inspection.

### Suggested debug approach

- Reduce the widget to a minimal `<iframe src="https://orthanc-mcp-app.fly.dev/ohif/viewer?StudyInstanceUIDs=2.16.840.1.113669.632.20.1211.10000357775">` (no postMessage, no ext-apps) and see if THAT renders. If yes → our handshake is the confound. If no → nesting OHIF in Claude's sandbox is the confound.
- Open DevTools on the claudemcpcontent.com sandbox frame and look at its console for CSP violation reports, service-worker errors, or fetch failures.
- Check OHIF's own config options: there may be a `useSharedArrayBuffer`, `workers.enabled`, or `serviceWorker.enabled` knob that avoids features Claude's sandbox forbids.

## How the OHIF bundle gets built

`ohif-dist/` is gitignored. Regenerate it with:

```bash
scripts/ohif/build-ohif-dist.sh
# or pin a different version:
OHIF_VERSION=v3.13.0-beta.6 scripts/ohif/build-ohif-dist.sh
```

Steps (encoded in the script):

1. Shallow-clone OHIF/Viewers at the pinned tag.
2. `yarn install --frozen-lockfile` (slow — ~5-10 min first run).
3. Drop `scripts/ohif/orthanc-mcp-app.config.js` into `platform/app/public/config/orthanc-mcp-app.js`.
4. `APP_CONFIG=config/orthanc-mcp-app.js PUBLIC_URL=/ohif/ yarn build`.
5. `rsync --exclude '*.map'` the dist into repo-root `ohif-dist/`.

Final size is ~125 MB. The Fly Docker build pulls `ohif-dist/*` into the
image via `COPY ohif-dist* ./ohif-dist` (wildcard tolerates its absence).

Note: the build is NOT yet wired into CI or the Dockerfile. Fred rebuilds it
locally before `fly deploy` when the bundle needs to change. Adding a CI step
that runs this build and bakes the bundle into the image would eliminate the
manual step.

## Recent commits (session timeline)

```
30c6ab2 feat(ohif): self-hosted OHIF bundle renders DICOM pixels
b6cca1d docs: mark widget blocker resolved in HANDOFF
162373f fix(mcp): return 404 for unknown session so client re-initializes
5fb509a docs: rewrite HANDOFF.md with widget-render blocker state
```

## Useful probes

```bash
# Everything up?
curl -sS https://orthanc-mcp-app.fly.dev/health
# Expected: {"ok":true,"name":"orthanc-mcp-app","version":"0.2.0-widget","ohif_bundled":true}

# OHIF SPA serves?
curl -sS -H 'Accept: text/html' https://orthanc-mcp-app.fly.dev/ohif/viewer | grep -o 'OHIF Viewer'

# Session 404 contract intact?
curl -sS -o /dev/null -w "%{http_code}\n" -X POST \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -H 'mcp-session-id: stale' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{}}' \
  https://orthanc-mcp-app.fly.dev/mcp
# Expected: 404

# BRAINIX UID still available?
curl -sS 'https://orthanc-mcp-app.fly.dev/dicomweb/orthanc-demo/studies?PatientName=BRAINIX' \
  -H 'accept: application/dicom+json' \
  | python3 -c "import sys,json;print([s['0020000D']['Value'][0] for s in json.load(sys.stdin)])"

# Fly logs
fly logs --no-tail
```

## Key files

- [src/server.ts](src/server.ts) — Express routes, 404-on-stale-session,
  `/ohif/*` static mount, `/mcp` + `/mcp-v2` aliases.
- [src/ohif/static.ts](src/ohif/static.ts) — `ohif-dist/` resolution and
  SPA fallback.
- [src/tools/open_study.ts](src/tools/open_study.ts) — emits absolute
  `dicomwebBaseUrl` and `ohifBasePath` so the sandboxed widget resolves
  them against our Fly origin.
- [src/ui/resource.ts](src/ui/resource.ts) — `ui://viewer-v5` resource
  registration and widget CSP meta.
- [ui/index.html](ui/index.html) — widget shell, `body { height: 640px }`,
  placeholder + OHIF iframe slot.
- [ui/src/widget.ts](ui/src/widget.ts) — connects to ext-apps, wires
  `ontoolresult`, calls `sendSizeChanged` + `requestDisplayMode`.
- [scripts/ohif/build-ohif-dist.sh](scripts/ohif/build-ohif-dist.sh) —
  reproducible OHIF build.
- [scripts/ohif/orthanc-mcp-app.config.js](scripts/ohif/orthanc-mcp-app.config.js) —
  OHIF app config for our deployment.

## Fly.io operations

```bash
fly logs --no-tail          # tail
fly deploy --now            # build + deploy current tree
```

Note on logging: Express isn't configured with a request logger, so GETs to
`/ohif/*` and `/dicomweb/*` don't show in `fly logs` — only the MCP POST
trace lines do. Add `morgan('tiny')` on a debug branch if you need to see
the OHIF fetch traffic from inside the widget.

## Deferred (next sessions)

- Inline-in-Claude embedding debug (see hypotheses above).
- Populate `ohif-dist/` as part of CI / Docker build so developers don't
  need to rebuild it locally before every deploy.
- Tighten the `/ohif/viewer` SPA test so it runs against the built bundle
  under vitest (currently skipped because of path-resolution differences
  between the TS source and compiled dist).
- Record Loom demo ([demo/script.md](demo/script.md)).
- Blog post ([demo/blog-outline.md](demo/blog-outline.md)).
- Courtesy DM to Benoit Crickboom (Orthanc team lead) before any public
  launch — we default to their demo server.
- Remaining P2/P3 items from [code review](https://github.com/fredericlambrechts/orthanc-mcp-app/pull/1).

## Cost / operational state

- Fly: single shared-cpu-1x, auto-stop on idle. Cold start 5-15s.
  `min_machines_running = 0` per `fly.toml` — Fred rejected a proposal to
  keep one warm. Machine restarts are now handled gracefully because stale
  `mcp-session-id` headers produce HTTP 404, which triggers Claude.ai's
  re-init path.
- Monthly cost: ~$0-5. Fly $5 Hobby credit covers it.
- No OAuth on `/mcp`; anyone can use it as a DICOMweb CORS proxy to the
  Orthanc demo. Acceptable for v1 per the plan.
