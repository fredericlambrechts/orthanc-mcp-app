---
title: feat: Orthanc DICOM MCP App MVP
type: feat
status: active
date: 2026-04-24
origin: feasibility-study.md
---

# feat: Orthanc DICOM MCP App MVP

## Overview

Build the 1-week MVP of `superswift/dicom-mcp`: a Claude MCP App that embeds OHIF v3 inline in chat and opens a DICOM study from a pasted link. Backed by a Node/TypeScript MCP server deployed to Fly.io with a DICOMweb CORS proxy. Primary demo corpus is the Orthanc public demo server. Demo-quality, non-diagnostic, public-corpus only.

---

## Problem Frame

Greenfield opportunity (see `prior-art.md`): four existing DICOM MCP servers exist but none render images; no PACS vendor has shipped an LLM chat with inline DICOM display. MCP Apps (SEP-1865, Jan 2026) provides the primitive. The Autodesk APS Viewer MCP App is a proven structural twin. SuperSwift's positioning angle: Fred's Osimis/Orthanc credibility + first-mover on MCP Apps + OHIF. This plan builds the demo that opens medtech pilot conversations (see feasibility study section 8).

---

## Requirements Trace

- R1. User pastes any of {DICOMweb study URL, Orthanc UI URL, Orthanc REST URL, bare StudyInstanceUID, OHIF share URL} in Claude.ai → inline OHIF viewer renders the study
- R2. User can scroll through slices and adjust window/level (manual and by preset) via chat commands that drive the viewer
- R3. Claude can answer questions about what is displayed ("what's the modality?", "what's the slice thickness?") via `describe_current_view` backed by live viewer state
- R4. App ships as an installable MCP App on Claude.ai (and Claude Desktop by extension); Cowork support probed and documented
- R5. v1 connects only to public DICOMweb corpora; authenticated endpoints are actively rejected
- R6. README, install flow, and demo Loom framed as non-diagnostic / demo / education use; no diagnostic language

---

## Scope Boundaries

- No authenticated PACS connections (v1 rejects any URL that looks authenticated)
- No STOW-RS upload
- No annotations, measurements, or segmentation overlays
- No multi-study comparison / hanging protocols
- No export snapshot to chat (v2)
- Not FDA/CE-marked - marketed explicitly as non-diagnostic
- Not tuned for mobile or for Claude Desktop UX polish beyond what renders by default
- No persistent user data / session storage

### Deferred to Follow-Up Work

- Authenticated PACS support with BAA/DPA posture: separate v2 release with compliance review
- Cornerstone3D-only minimal bespoke viewer (bundle size reduction): v2 iteration
- `add_annotation` / `list_annotations` / `export_snapshot`: v2 tools
- Blog post + product page copy: separate content task post-demo

---

## Context & Research

### Relevant Code and Patterns

- **Autodesk APS Viewer MCP App** - near-exact structural template. Vite + `vite-plugin-singlefile` for the HTML shell, CDN-loaded viewer assets via `_meta.ui.csp.resourceDomains`, bidirectional `app.ontoolresult` / `app.updateModelContext`. Reference: [APS blog](https://aps.autodesk.com/blog/embedding-aps-viewer-ai-chats-mcp-apps)
- **ext-apps reference examples** - `threejs-server`, `pdf-server`, `map-server` (CesiumJS) all prove heavy WebGL/streaming viewers work in the sandbox. [ext-apps repo](https://github.com/modelcontextprotocol/ext-apps)
- **OHIF iframe docs** - official iframe + postMessage pattern supported. [OHIF iframe](https://docs.ohif.org/deployment/iframe/), [URL params](https://docs.ohif.org/configuration/url/)
- **Orthanc DICOMweb plugin** - public demo endpoint at `https://demo.orthanc-server.com/dicom-web/`, supports QIDO-RS + WADO-RS. [Orthanc DICOMweb](https://orthanc.uclouvain.be/book/plugins/dicomweb.html)

### External References

- [MCP Apps overview](https://modelcontextprotocol.io/extensions/apps/overview) - confirmed supported clients: Claude (web), Claude Desktop, VS Code Copilot, Goose, Postman, MCPJam. Cowork NOT officially listed.
- [MCP Apps specification SEP-1865](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx) - `_meta.ui.resourceUri`, CSP shape, postMessage protocol
- [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) + [@modelcontextprotocol/ext-apps](https://github.com/modelcontextprotocol/ext-apps) - canonical TypeScript SDKs

### Internal References

- `feasibility-study.md` - approach, risks, strategic verdict
- `tool-signatures.md` - 6-tool surface, URL parser logic, postMessage protocol
- `prior-art.md` - competitive landscape, greenfield confirmation

---

## Key Technical Decisions

- **Viewer: OHIF v3 (MIT)** - not Stone (AGPL) or dwv (GPL). Allows proprietary distribution and future closed-source commercial use. [from feasibility study §2]
- **Deploy: Fly.io** - DICOMweb pixel streaming can be ≥100 MB per series with long-lived responses. Cloudflare Workers' CPU time and response size limits risk throttling WADO-RS. Fly.io gives us unbounded streaming, persistent regions, simple Node deployment. Revisit for v2 if edge distribution becomes a concern.
- **Self-host OHIF on our Fly.io origin (Path A)** - the MCP server serves the OHIF bundle at `/ohif/*` instead of loading from a third-party CDN. Single-origin CSP, no CDN dependency, ~15-30 MB added to the Docker image. Minor reliability win for no real cost.
- **Any DICOMweb URL is first-class** - the default corpus is the Orthanc public demo server (pays tribute, stable, well-curated). But `open_study` accepts any DICOMweb-compliant URL via ad-hoc server registration: users can paste a study URL from KHEOPS, Google Healthcare, dcm4che, their own Orthanc, anything DICOMweb-speaking. The URL parser's unknown-host branch (see `tool-signatures.md` §"URL parser spec") covers this.
- **Server runtime: Node 22 + TypeScript + Streamable HTTP transport** - matches ext-apps examples and SDK defaults.
- **UI shell: Vite + `vite-plugin-singlefile`** - exact pattern used by Autodesk APS. Produces a single HTML file served as the `ui://viewer` resource; OHIF is loaded from our own Fly.io origin, not from a third-party CDN.
- **CORS proxy mounted on the MCP server itself** (`/dicomweb/:serverId/*`) - single origin to declare in `connectDomains`. Strips inbound `Authorization` as v1 safety rail.
- **Default corpus: Orthanc public demo server** (`demo.orthanc-server.com/dicom-web/`). Pays tribute to the Orthanc project - Fred's roots. No Softneta DICOM Library (not a DICOMweb endpoint per feasibility study §3). Any other DICOMweb endpoint works via paste-a-link.
- **State model: in-memory per session** - no database for v1. `describe_current_view` reads from the last `STATE_UPDATE` postMessage cached per MCP session.
- **License: MIT** - matches OHIF, maximises adoption, supports "calling card" strategy.

---

## Open Questions

### Resolved During Planning

- *Which deploy target?* → Fly.io (streaming + simplicity, see Decisions).
- *Which public corpus?* → Orthanc demo server only (feasibility study §3).
- *Fly.io vs a self-hosted Orthanc?* → Use Orthanc's public demo; we don't run infra. Self-hosted Orthanc is a v2 decision tied to authenticated PACS.

### Deferred to Implementation

- *Exact OHIF bundle version to pin* - check latest stable at build time; prefer the most recent release with stable `StudyInstanceUIDs` URL parameter support.
- *Curated StudyInstanceUIDs for `list_public_datasets`* - resolve during U6 by running QIDO-RS against `demo.orthanc-server.com/dicom-web/studies` and picking one each of CT, MR, CR/DX, MG, US with clean, non-empty series.
- *Final CSP `connectDomains` list* - the Fly.io app domain once known. Probably `https://dicom-mcp.fly.dev` or a custom domain.
- *Cowork installation UX* - depends on Probe B outcome (U1).

---

## Output Structure

```
orthanc-mcp-app/
  package.json
  tsconfig.json
  fly.toml
  Dockerfile
  .gitignore
  LICENSE                      (MIT)
  README.md                    (install + usage + non-diagnostic framing)
  feasibility-study.md         (exists)
  tool-signatures.md           (exists)
  prior-art.md                 (exists)
  plan.md                      (this file)
  probes/
    RESULTS.md                 (Day 0 probe outcomes)
  src/
    server.ts                  (MCP server bootstrap, Streamable HTTP, static mounts)
    tools/
      list_dicom_servers.ts
      list_public_datasets.ts
      search_studies.ts
      open_study.ts
      describe_current_view.ts
      set_view.ts
    dicomweb/
      proxy.ts                 (CORS proxy for any DICOMweb server)
      client.ts                (server-side QIDO-RS helpers)
    parser/
      url.ts                   (URL parser from tool-signatures §"URL parser spec")
    state/
      session.ts               (per-session view state cache)
    ui/
      resource.ts              (ui://viewer resource registration)
  ohif-dist/                    (OHIF v3 production build, self-hosted on our Fly.io origin)
  ui/
    vite.config.ts
    index.html                 (single-file shell for ui://viewer)
    src/
      widget.tsx               (OHIF iframe host + postMessage bridge)
      bridge.ts                (SET_STUDY / SET_VIEW / STATE_UPDATE protocol)
  test/
    parser.url.test.ts
    proxy.cors.test.ts
    open_study.integration.test.ts
    describe_current_view.test.ts
  demo/
    script.md                  (60-second Loom script)
    blog-outline.md            (post-launch content draft)
```

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification.*

```
  User in Claude.ai
        |
        | "Open https://demo.orthanc-server.com/ui/app/#/studies/<orthanc-id>"
        v
  Claude host
        |-- tool call: open_study(reference=URL)
        v
  MCP Server (Fly.io)
    - URL parser -> StudyInstanceUID
    - returns tool result with _meta.ui.resourceUri = ui://viewer
        |
        v
  Host renders sandboxed iframe with ui://viewer
        |
        |-- loads OHIF bundle via CSP resourceDomains (CDN)
        |-- sends SET_STUDY{studyUid, dicomwebBaseUrl=/dicomweb/orthanc-demo}
        v
  OHIF in iframe
        |-- fetch WADO-RS / QIDO-RS -> MCP Server /dicomweb/* proxy (CORS OK)
        |                                        |
        |                                        v
        |                           demo.orthanc-server.com/dicom-web/*
        |-- user scrolls, changes W/L
        |-- emits STATE_UPDATE (debounced 250ms)
        v
  MCP Server caches STATE_UPDATE in per-session store
        |
        v
  describe_current_view tool -> reads cache -> returns to Claude
```

---

## Implementation Units

- [ ] U1. **Day 0 probes + project scaffold**

**Goal:** De-risk the two unverified assumptions (Cowork support, WebGL ceiling) and stand up the empty project.

**Requirements:** R4 (surface verification)

**Dependencies:** None

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `LICENSE`, `README.md` (stub), `probes/RESULTS.md`

**Approach:**
- **Probe A: threejs-server on Claude.ai.** Clone `ext-apps`, deploy the `threejs-server` example locally or via ngrok, install in Claude.ai, confirm the WebGL widget renders and responds to messages. This proves our sandbox assumptions for Claude web.
- **Probe B: same example in Claude Cowork.** If it works, Cowork is a valid demo surface too. If it doesn't, document the failure and pin the pitch to Claude.ai. This resolves the Cowork unverified question.
- **Probe C: OHIF iframe against Orthanc demo.** Run the OHIF demo build locally, point it at `https://demo.orthanc-server.com/dicom-web/`, confirm a known study loads and renders. This validates DICOMweb compatibility independent of MCP.
- Write outcomes to `probes/RESULTS.md`. **Gate: Probe A and Probe C must pass before U2 starts.** Probe B is informational.
- Initialise Node 22 + TypeScript + ESM project. Add SDK deps: `@modelcontextprotocol/sdk`, `@modelcontextprotocol/ext-apps`. Dev deps: `vite`, `vite-plugin-singlefile`, `vitest`, `tsx`.

**Patterns to follow:**
- `ext-apps/examples/basic-server-react` for baseline server/client layout.

**Test scenarios:**
- Happy path: threejs-server renders in Claude.ai → probe A recorded as pass
- Happy path: OHIF loads a known Orthanc demo study in a plain iframe → probe C recorded as pass
- Edge case: Cowork behaviour documented either way → probe B outcome in `RESULTS.md`

**Verification:**
- `probes/RESULTS.md` records all three outcomes with timestamps and screenshots.
- `npm install` succeeds; `npm run build` produces an empty but valid output.

---

- [ ] U2. **MCP server skeleton with 6 tool stubs**

**Goal:** Wire the Streamable HTTP MCP server with all six tools as typed stubs. No viewer yet.

**Requirements:** R1 (tool surface exists), R5 (reject-auth scaffold)

**Dependencies:** U1

**Files:**
- Create: `src/server.ts`, `src/tools/list_dicom_servers.ts`, `src/tools/list_public_datasets.ts`, `src/tools/search_studies.ts`, `src/tools/open_study.ts`, `src/tools/describe_current_view.ts`, `src/tools/set_view.ts`
- Create: `src/config.ts` (server registry with Orthanc demo default), `src/state/session.ts` (in-memory cache)
- Test: `test/tools.schema.test.ts`

**Approach:**
- Streamable HTTP transport on `/mcp`. Port from env.
- Each tool exports name, input schema (zod), description matching `tool-signatures.md`, and a handler. Handlers return placeholder results in U2.
- `src/state/session.ts` exposes `getViewState(sessionId)` / `setViewState(sessionId, partial)` - used later by `describe_current_view` and `set_view`.
- `src/config.ts` holds the single default server: `{ id: 'orthanc-demo', base_url: 'https://demo.orthanc-server.com/dicom-web', auth: 'none', default: true }`.

**Execution note:** Test-first on the tool schemas - the shape is the contract with Claude, easiest to validate as unit tests before implementation logic lands.

**Patterns to follow:**
- ext-apps examples for tool registration idioms.
- Pin SDK versions in `package.json` (spec is 3 months old, expect breaking changes).

**Test scenarios:**
- Happy path: `list_dicom_servers` returns the Orthanc demo entry
- Happy path: `list_public_datasets` returns an array (empty in U2, filled in U6)
- Edge case: each tool's input validation rejects malformed args with a clear error
- Error path: calling an unregistered tool returns a proper MCP error response
- Integration: server starts on configured port, responds to `initialize` and `tools/list`

**Verification:**
- `npm run dev` starts the server; MCP Inspector lists all six tools with correct schemas.

---

- [ ] U3. **DICOMweb CORS proxy**

**Goal:** Mount `/dicomweb/:serverId/*` on the MCP server; forward to the configured base URL with CORS headers.

**Requirements:** R1 (viewer must fetch DICOM), R5 (strip inbound auth)

**Dependencies:** U2

**Files:**
- Create: `src/dicomweb/proxy.ts`, `src/dicomweb/client.ts` (server-side QIDO helpers reused by `search_studies`)
- Modify: `src/server.ts` (mount proxy route)
- Test: `test/proxy.cors.test.ts`

**Approach:**
- Node `fetch` passthrough. For each incoming request, look up `serverId` in config, forward path and query to the upstream base URL.
- **Strip any inbound `Authorization` header** before forwarding - v1 safety rail.
- Return response body as stream (Node Readable to Fetch Response). Preserve `Content-Type`, `Transfer-Encoding`.
- Add response headers: `Access-Control-Allow-Origin: *` (tighten to Claude's iframe origin once known), `Access-Control-Allow-Methods: GET, OPTIONS`, `Access-Control-Allow-Headers: Accept`.
- Handle `OPTIONS` preflight inline.
- No caching in v1; rely on upstream cache headers.

**Patterns to follow:**
- Standard Node streaming proxy - no framework needed beyond the built-in HTTP / undici stack.

**Test scenarios:**
- Happy path: `GET /dicomweb/orthanc-demo/studies` proxies to `https://demo.orthanc-server.com/dicom-web/studies` and returns JSON with CORS headers
- Happy path: `GET /dicomweb/orthanc-demo/studies/<uid>/series` streams the response through
- Edge case: unknown `serverId` returns 404 with JSON error
- Error path: upstream returns 500 → proxy surfaces 502 with body describing the upstream failure
- Error path: inbound request with `Authorization` header → header is stripped, not forwarded (asserted by a mock upstream that echoes headers)
- Integration: `OPTIONS` preflight returns 204 with correct CORS headers

**Verification:**
- Against the real Orthanc demo server: `curl http://localhost:<port>/dicomweb/orthanc-demo/studies` returns a JSON array. Headers include `Access-Control-Allow-Origin`.

---

- [ ] U4. **OHIF widget bundle + ui://viewer resource**

**Goal:** Produce the single-file HTML shell that loads OHIF, connects to our proxy, and responds to `SET_STUDY` / `SET_VIEW`. Register as `ui://viewer`.

**Requirements:** R1 (viewer renders), R2 (scroll + W/L via UI)

**Dependencies:** U3 (proxy must work)

**Files:**
- Create: `ui/vite.config.ts`, `ui/index.html`, `ui/src/widget.tsx`, `ui/src/bridge.ts`, `ui/package.json`
- Create: `src/ui/resource.ts` (registers `ui://viewer` pointing at the Vite build output)
- Modify: `src/server.ts` (register UI resource), `src/tools/open_study.ts` (return `_meta.ui.resourceUri: 'ui://viewer'` + `initialData`)

**Approach:**
- Vite + `vite-plugin-singlefile` emits a single `index.html` with all JS/CSS inlined. This is served as the `ui://viewer` resource body.
- **OHIF is self-hosted on our Fly.io origin at `/ohif/*`** (Path A). Added to the Docker image as a static build. Eliminates third-party CDN dependency. The shell embeds OHIF via its supported iframe URL form: `<iframe src="https://<our-fly-origin>/ohif/viewer?StudyInstanceUIDs=<uid>&url=<dicomweb-proxy-url>">`.
- `_meta.ui.csp`:
  - `resourceDomains`: only our MCP server origin
  - `connectDomains`: only our MCP server origin
  - `frameDomains`: only our MCP server origin
- `bridge.ts` subscribes to `message` events from the inner OHIF iframe (OHIF postMessage API) and from the MCP host (ext-apps `App` class). Translates between the two.
- `SET_STUDY` from MCP server → reload inner iframe with new `StudyInstanceUIDs`. `SET_VIEW` → postMessage to OHIF's viewport controls.
- `STATE_UPDATE` from OHIF → debounce 250 ms → `app.updateModelContext` back to MCP server.

**Patterns to follow:**
- Autodesk APS architecture: Vite + singlefile shell, postMessage bridge. We diverge on one point: OHIF is self-hosted, not CDN-loaded.

**Test scenarios:**
- Happy path: Vite build produces a single `index.html` under the declared size budget (target < 200 KB before OHIF load)
- Happy path: the widget shell, opened in a plain browser iframe, loads OHIF from our origin and renders a test study
- Edge case: if the OHIF path is misconfigured, the widget shows a readable error rather than a blank frame
- Integration: `open_study` tool result includes `_meta.ui.resourceUri: 'ui://viewer'` and `initialData.studyUid` that the widget can read on mount

**Verification:**
- Manual: in the MCP Inspector or a local host, calling `open_study` renders an OHIF viewer displaying the test study, with scroll and W/L working.

---

- [ ] U5. **URL parser + open_study + state sync for describe_current_view**

**Goal:** Complete the headline flow: paste any of the four URL shapes → viewer opens → `describe_current_view` returns accurate live state.

**Requirements:** R1 (all URL shapes), R3 (describe works), R5 (reject auth)

**Dependencies:** U4

**Files:**
- Create: `src/parser/url.ts`
- Modify: `src/tools/open_study.ts`, `src/tools/describe_current_view.ts`, `src/tools/set_view.ts`, `src/state/session.ts`
- Test: `test/parser.url.test.ts`, `test/open_study.integration.test.ts`, `test/describe_current_view.test.ts`

**Approach:**
- Implement the 5-branch parser from `tool-signatures.md` §"URL parser spec":
  1. OID regex → bare StudyInstanceUID
  2. Orthanc UI URL → fetch Orthanc REST `/studies/<orthanc-id>` → extract `MainDicomTags.StudyInstanceUID`
  3. Orthanc REST URL → same as 2
  4. DICOMweb study URL → extract UID from path
  5. OHIF share URL → extract `StudyInstanceUIDs` param
- Rejection list: `file://`, `data:`, IP-literal hosts, URLs with `Authorization:` hints or `token=` params, `/auth/` path segments.
- `open_study`: parse → resolve server (configured or register ad-hoc anonymous) → return UI resource reference with `initialData`.
- `set_view`: resolve preset shortcuts server-side (`lung` → wc=-600, ww=1500 etc.), post `SET_VIEW` through the host to the widget, update session cache.
- `describe_current_view`: read session cache populated by `STATE_UPDATE`.

**Execution note:** Test-first on the URL parser - five distinct shapes plus rejection rules is exactly the surface that rewards table-driven tests.

**Patterns to follow:**
- `tool-signatures.md` §"URL parser spec" is the normative spec.

**Test scenarios:**
- Happy path: bare UID `1.2.840...` parses to the UID, default server
- Happy path: Orthanc UI URL parses via REST lookup to a StudyInstanceUID
- Happy path: Orthanc REST URL parses identically
- Happy path: DICOMweb study URL `/dicom-web/studies/<uid>` extracts UID directly
- Happy path: OHIF share URL with `StudyInstanceUIDs=<uid>` query param extracts UID
- Edge case: trailing slash and fragment variants on each URL shape
- Edge case: unknown host → registers ad-hoc server with hashed ID
- Error path: `file://` rejected with `UNPARSEABLE`
- Error path: URL with `token=...` query param rejected as "authenticated - not supported in v1"
- Error path: URL with `/auth/` segment rejected with same reason
- Integration (`open_study.integration.test.ts`): given an Orthanc demo UI URL, the tool resolves to a valid StudyInstanceUID (against the real demo server)
- Integration (`describe_current_view.test.ts`): after simulating a STATE_UPDATE postMessage, the tool returns the cached state within 100 ms

**Verification:**
- Full flow: paste an Orthanc UI URL in Claude.ai → viewer opens → ask "what's the modality?" → Claude replies correctly using `describe_current_view`.

---

- [ ] U6. **Deploy, curated corpus, demo package**

**Goal:** Ship to Fly.io, install in Claude.ai, populate `list_public_datasets`, record demo.

**Requirements:** R1-R6 all met end-to-end

**Dependencies:** U5

**Files:**
- Create: `fly.toml`, `Dockerfile`, `demo/script.md`, `demo/blog-outline.md`
- Create: `ohif-dist/` (static OHIF v3 build fetched during Docker image build)
- Modify: `src/tools/list_public_datasets.ts` (populate with resolved Orthanc demo UIDs), `src/server.ts` (mount `/ohif/*` static), `README.md` (install instructions, non-diagnostic disclaimer, Orthanc attribution)

**Approach:**
- Fly.io: single `Dockerfile` building the Node app + Vite UI output + OHIF static build; `fly.toml` single-region (AMS or FRA) with HTTPS, 512 MB RAM.
- Domain: `orthanc-mcp-app.fly.dev` for v1 (matches repo name; no custom domain yet); update `connectDomains` / `resourceDomains` / `frameDomains` CSP to that origin.
- **Self-host OHIF (Path A)**: fetch the OHIF v3 production build to `ohif-dist/` during the Docker build (either from npm `@ohif/viewer` or from a GitHub release), served from `/ohif/*`. Removes CDN dependency.
- **Resolve curated dataset**: run `GET https://demo.orthanc-server.com/dicom-web/studies` locally, pick one each of CT (chest), MR (brain), CR/DX (chest plain film), MG (mammography), US (obstetrics or abdominal). Record `StudyInstanceUID`, `PatientName`, `StudyDescription`, `Modality` in `list_public_datasets` with `server_id: "orthanc-demo"`. 5 entries. Loaded live from Orthanc via our CORS proxy.
- README sections (explicit):
  - What it is (one paragraph)
  - Install in Claude.ai (step-by-step with the MCP server URL)
  - Usage examples (paste a link; ask "what's the modality")
  - **Non-diagnostic disclaimer** in a callout at the top: "For demonstration, education, and non-diagnostic use only. Not a medical device. Not cleared by FDA, not CE-marked under MDR. Do not use for clinical diagnosis."
  - License (MIT)
  - Sources of sample data (Orthanc demo server attribution)
- Demo script: 60-second Loom. Open Claude.ai, paste an Orthanc UI URL, viewer appears, scroll, switch to lung window, ask "what am I looking at," close with a line about non-diagnostic framing.
- Blog post outline: Why medical imaging in Claude matters; what we shipped; how MCP Apps + OHIF + Orthanc fit together; the Osimis connection (Fred's authority); non-diagnostic framing; repo link + install instructions.

**Patterns to follow:**
- Fly.io Node deployment conventions.
- Autodesk APS blog for tone/framing reference.

**Test scenarios:**
- Integration: deployed Fly.io instance responds to `tools/list` over HTTPS
- Integration: installing the MCP server URL in Claude.ai succeeds; `open_study` with a curated dataset entry renders the viewer
- Happy path: each of the 5 curated studies loads successfully when named by `list_public_datasets`
- Edge case: re-deploy does not break an in-flight session (or if it does, client recovers with a clear error)

**Verification:**
- End-to-end acceptance criteria (see next section) all pass.
- Loom recorded and stored at `demo/`; blog outline at `demo/blog-outline.md`.

---

## Acceptance Criteria (demo gate)

The MVP is done when, in a live Claude.ai session with the MCP App installed, all of these work:

1. **Paste any DICOMweb URL:** user pastes an Orthanc UI URL, a bare StudyInstanceUID, or a DICOMweb study URL from any DICOMweb-speaking server → viewer renders the study within 10 seconds.
2. **Curated library:** user asks "show me a chest CT" → Claude uses `list_public_datasets` + `open_study`, the right Orthanc demo study loads.
3. **Scroll:** user scrolls through slices via the OHIF UI, navigation works smoothly on a ≤200-slice study.
4. **Window/level by chat:** user says "switch to the lung window" → viewer W/L updates.
5. **Describe current view:** user asks "what's the modality?" / "what's the slice thickness?" → Claude answers correctly using `describe_current_view`.
6. **Arbitrary server:** user pastes a DICOMweb URL from a non-Orthanc server (e.g. KHEOPS if accessible, or any compliant endpoint) → study loads via ad-hoc server registration.
7. **Reject authenticated:** user pastes a URL with `token=...` → tool returns a clear error, no connection attempted.
8. **Non-diagnostic framing** visible in the app description, README, and Loom intro.
9. **Single-origin static assets:** browser devtools show OHIF and the UI shell load from our Fly.io origin only, no third-party CDN.

---

## System-Wide Impact

- **Interaction graph:** greenfield; no existing SuperSwift system is modified. Live dependencies: Fly.io (our hosting), Orthanc public demo server (default corpus). OHIF is self-hosted on our Fly.io origin so no third-party CDN dependency. Any user-supplied DICOMweb endpoint becomes an additional live dependency only for that session's studies.
- **Error propagation:** upstream DICOMweb failures → 502 from our proxy → OHIF shows "failed to load study" → widget posts `ERROR` message → MCP server returns an actionable tool error to Claude.
- **State lifecycle risks:** per-session in-memory state will be lost on Fly.io process restart. Acceptable for v1 (session is short). Callout in README that this is not a persistence layer.
- **API surface parity:** n/a (single surface).
- **Integration coverage:** integration tests exercise the real Orthanc demo server for parser + proxy + open_study. Avoids the mock/prod divergence trap.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|-----------|
| WebGL memory ceiling kills large CT volumes in the sandbox | Curate modest studies (50-200 slices) for the demo library. If it surfaces for larger studies, document "for best results, use studies under X slices" and defer volumetric streaming optimisation to v2. |
| Cowork doesn't support MCP Apps | Probe B (U1) resolves it. If negative, scope the pitch to Claude.ai / Claude Desktop - still a valid demo surface. No code change. |
| CORS regression on Orthanc demo server | Our proxy handles CORS ourselves; not dependent on upstream CORS config. |
| OHIF bundle load time feels slow | Self-hosted on Fly.io origin with aggressive caching. Widget shows a loading skeleton. V2: bespoke Cornerstone3D minimal viewer if this becomes painful. |
| MCP Apps spec breaking changes | Pin `@modelcontextprotocol/sdk` and `@modelcontextprotocol/ext-apps` versions. Budget 0.5 days for SDK upgrade churn during the 2-week calendar window. |
| Orthanc demo server availability / rate limits | Primary corpus dependency. If it's down during a demo, pivot to any other DICOMweb URL via paste-a-link. Acceptable for a demo asset; would need addressing for a production product. |
| Arbitrary DICOMweb endpoints with unexpected behavior (non-standard responses, weird metadata) | URL parser's ad-hoc registration path handles the common cases. Document "works with any DICOMweb-compliant server; may need tweaks for non-conforming ones". |
| Someone interprets it as diagnostic | Explicit non-diagnostic framing in three places (app description in Claude, README top callout, Loom intro sentence). |

---

## Documentation / Operational Notes

- README with install flow, usage examples, non-diagnostic disclaimer, MIT license, attribution to Orthanc demo server.
- `probes/RESULTS.md` recording the Day 0 probe outcomes (persisted in repo as evidence for future decisions).
- `demo/script.md` - Loom script.
- `demo/blog-outline.md` - post-launch content outline Fred or Bolt can fill in.
- Fly.io deployment: `fly deploy` from local, no CI in v1.
- Monitoring: Fly.io default logs are sufficient for a demo instance. No alerting for v1.

---

## Sources & References

- **Origin documents** (all in `orthanc-mcp-app/`):
  - [feasibility-study.md](feasibility-study.md)
  - [tool-signatures.md](tool-signatures.md)
  - [prior-art.md](prior-art.md)
- External:
  - [MCP Apps overview](https://modelcontextprotocol.io/extensions/apps/overview)
  - [MCP Apps spec SEP-1865](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)
  - [Autodesk APS Viewer MCP App blog](https://aps.autodesk.com/blog/embedding-aps-viewer-ai-chats-mcp-apps)
  - [OHIF iframe docs](https://docs.ohif.org/deployment/iframe/)
  - [OHIF URL parameters](https://docs.ohif.org/configuration/url/)
  - [Orthanc DICOMweb plugin](https://orthanc.uclouvain.be/book/plugins/dicomweb.html)
  - [ext-apps repo and examples](https://github.com/modelcontextprotocol/ext-apps)
