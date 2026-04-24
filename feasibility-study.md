---
title: DICOM MCP App Feasibility Study
date: 2026-04-24
status: draft
owner: fred
---

# DICOM MCP App - Feasibility Study

Can we ship a Claude MCP App that embeds a DICOMweb viewer inline in a Claude conversation, loads studies by UID from remote DICOMweb servers, and exposes navigation commands (series, slice, W/L) as MCP tools? Short answer: **yes, technically feasible today on Claude.ai and Claude Cowork**, with OHIF or Stone Web Viewer behind a thin MCP server. The harder question is whether it belongs in the SuperSwift roadmap. Verdict at the end.

## 1. Claude MCP App surface - what's actually shippable today

The relevant protocol is **MCP Apps (SEP-1865)**, merged into MCP on 26 January 2026 as the first official extension. Tools declare a `_meta.ui.resourceUri` pointing at a `ui://` resource; the host fetches that resource (typically an HTML bundle) and renders it in a sandboxed iframe inside the chat. Bidirectional messaging uses JSON-RPC over `postMessage`; the widget can call tools back on the MCP server, update model context, and receive pushed tool results ([MCP Apps overview](https://modelcontextprotocol.io/extensions/apps/overview), [MCP Apps announcement](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/)).

Key facts that matter for a DICOM viewer:

- **Iframe sandbox**: hosts must grant `allow-scripts` and `allow-same-origin` on the sandbox proxy. Additional capabilities (camera, mic, clipboard) are opt-in via `_meta.ui.permissions`. WebGL / WebAssembly / canvas are not explicitly named in the spec but are not blocked either - they work under standard sandbox rules, which matters because both OHIF (Cornerstone3D + WebGL2) and Stone Web Viewer (WebAssembly) depend on them ([MCP Apps spec](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)).
- **CSP is first-class and required**. `_meta.ui.csp` takes four domain lists: `connectDomains` (maps to `connect-src`, i.e. `fetch`/XHR/WebSocket), `resourceDomains` (scripts, images, styles, fonts), `frameDomains`, and `baseUriDomains`. Default is `default-src 'none'; connect-src 'none'`, so **nothing external loads unless explicitly declared**. Cross-origin fetch to declared origins is allowed but still subject to standard browser CORS on the target server.
- **No published size limit** on UI resources in the spec, but treat it as "keep the initial bundle small, stream the heavy stuff." Practical implication: don't ship OHIF bundled inside the `ui://` resource - load it via `resourceDomains` from a CDN or our own origin.
- **Client support (verified from the official overview)**: Claude (web), Claude Desktop, VS Code GitHub Copilot, Goose, Postman, MCPJam. **Claude Cowork is NOT listed** in the official MCP Apps overview ([MCP Apps overview](https://modelcontextprotocol.io/extensions/apps/overview)). An earlier third-party guide claimed Cowork support; treat that as unverified until we see an official Anthropic announcement or test it live with any existing ext-apps example. **Claude Code is not supported** - no rendering surface.

For Fred's audience this means: **the demo ships on Claude.ai and Claude Desktop today, no caveats.** Cowork support is the one open question - if confirmed, the same MCP App trivially reaches Cowork sales/ops users; if not, the sales-demo use case shifts to "show this in Claude.ai" which is still a credible surface but a different audience motion. A 10-minute probe (load any existing ext-apps example in Cowork) settles it.

**Structural precedent already proven**: the [Autodesk APS Viewer MCP App](https://aps.autodesk.com/blog/embedding-aps-viewer-ai-chats-mcp-apps) is a near-exact twin of the proposed build. Heavy WebGL viewer, HTML shell bundled with Vite + `vite-plugin-singlefile`, assets loaded from CDN via CSP allowlists, bidirectional `app.ontoolresult` / `app.updateModelContext`. Zero performance caveats reported. The MCP Apps overview itself explicitly pitches this use case: *"Viewing rich media. When a user asks to review a PDF, see a 3D model, or preview generated images, text descriptions fall short. An MCP App embeds the actual viewer (pan, zoom, rotate) directly in the conversation."*

**Remaining uncertainty**: the spec is silent on max uncompressed iframe memory, whether Web Workers with WASM are throttled, and whether very large WebGL textures (multi-slice CT volumes, 600+ slices) are ever killed by the host. Not a rendering blocker - it's a volume-size ceiling. Mitigate by curating demo studies in the 50-200 slice range and adding thumbnail-first progressive loading. Empirical probe covered in section 7.

**OHIF-specific confirmation**: the [official OHIF iframe docs](https://docs.ohif.org/deployment/iframe) explicitly state the viewer is iframe-embeddable with postMessage-based host communication, and can be served as static files. No special flags required beyond the standard `allow-scripts` + `allow-same-origin` that MCP Apps already grant.

## 2. DICOM viewer options for embedding

| Viewer | Tech | License | Fit for MCP App | Notes |
|---|---|---|---|---|
| **OHIF Viewer v3** | React, Cornerstone3D, WebGL2, WASM | MIT | Best general fit | Documented iframe deployment, URL-param study loading, postMessage. Bundle is heavy (tens of MB). |
| **Stone Web Viewer** | C++ compiled to WebAssembly | **AGPL** | Lightweight alternative | Orthanc-native, designed for DICOMweb. AGPL is a problem for any closed embed. |
| **Cornerstone3D** (core) | TS/JS, WebGL2, WASM decoders | MIT | Best for bespoke minimal viewer | Build our own minimal UI - fastest to bundle, we control everything. |
| **dwv** | Pure JS, canvas | **GPL-3.0** | Smallest footprint | GPL again. Zero-footprint, good for a single 2D series, weak for volumetric. |

**OHIF supports exactly the pattern we need.** You can embed it in an iframe, point it at any DICOMweb endpoint via `dataSources` config, and drive it with a URL: `https://<host>/viewer?StudyInstanceUIDs=<uid>` (commas or repeated params for multi-study, plus `SeriesInstanceUIDs` for series filtering) ([OHIF iframe docs](https://docs.ohif.org/deployment/iframe/), [OHIF URL params](https://docs.ohif.org/configuration/url/)). It exposes a `postMessage` API for host-iframe communication.

**License note for Fred**: Stone Web Viewer is AGPL ([Stone Web Viewer](https://www.orthanc-server.com/static.php?page=stone-web-viewer)) and dwv is GPL-3.0. If this product ever needs to be proprietary or bundled into a closed SaaS, **OHIF (MIT) or a custom Cornerstone3D (MIT) build is the only clean choice**. Fred knows this dance from Osimis - Stone was the in-house answer specifically because Orthanc is AGPL-friendly and Osimis controlled the stack.

**Recommendation**: OHIF v3 for v1 (fastest demo), migrate to a custom Cornerstone3D-based minimal viewer for v2 if we want full control of UX, bundle size, and postMessage protocol.

## 3. Remote DICOM access

**Softneta DICOM Library** (dicomlibrary.com) is anonymisation + shareable viewer, not a clean DICOMweb endpoint. The public share URL is `https://www.dicomlibrary.com/?study=<StudyUID>` and views via MedDream HTML5. There is **no documented public DICOMweb base URL** for QIDO/WADO on dicomlibrary.com ([DICOM Library](https://www.dicomlibrary.com/), [MedDream FAQ](https://meddream.com/faq/meddream-dicom-viewer/)). For programmatic WADO-RS, this is not the right test corpus - it's a consumer viewer.

Better test servers:

- **Orthanc demo server**: `https://demo.orthanc-server.com/dicom-web/` is live, public, QIDO-able (`/studies?ModalitiesInStudy=CT`) and returns real sample studies ([Orthanc DICOMweb plugin](https://orthanc.uclouvain.be/book/plugins/dicomweb.html)). **This should be our primary dev corpus**, not Softneta.
- **Google Cloud Healthcare API** public datasets (TCIA mirror) - authenticated, production-grade.
- **dcm4che** test servers.

**CORS is the real blocker, not discovery.** A browser iframe running inside Claude's sandbox cannot fetch `demo.orthanc-server.com` unless that server sends `Access-Control-Allow-Origin` for the Claude app origin. The Orthanc demo server does allow CORS but with narrow allow-lists in the default config. **Standard workaround: the MCP server proxies DICOMweb requests**. The MCP server sits on a domain we control, returns `Access-Control-Allow-Origin: *` (or the Claude app origin), streams WADO-RS bytes through. We list our proxy domain in `_meta.ui.csp.connectDomains`. This is a one-afternoon proxy.

STOW-RS (upload) is out of scope for v1.

## 4. MCP server design

Keep the tool surface tight. Anything we add, Claude has to learn to call correctly.

**v1 tool surface (6 tools)**:

- `list_dicom_servers()` - return configured DICOMweb endpoints (demo Orthanc, a user-supplied one).
- `search_studies(query)` - QIDO-RS wrapper: patient name, modality, date range. Returns study UIDs + metadata.
- `open_study(study_uid, server?)` - the headline action. Returns a UI resource reference; the viewer widget mounts.
- `describe_current_view()` - the viewer, via postMessage, reports the active study/series/slice/W-L back to the MCP server. Claude can read this in subsequent reasoning. **This is the tool that makes the viewer AI-native rather than just an embed.**
- `set_view(series_uid?, slice_index?, window?, level?)` - programmatic navigation. Lets the user say "jump to the sagittal series" and have Claude execute it.
- `list_public_datasets()` - optional, returns curated sample study UIDs (teaching cases).

**v2**: annotations (add/list/clear), measurements, export snapshot as PNG for the chat, multi-study hanging protocols.

**Wiring**: the MCP server exposes tools + a single UI resource (`ui://viewer`). The HTML loads OHIF from our CDN (declared in `resourceDomains`) and initialises it against our proxy DICOMweb URL (declared in `connectDomains`). The widget listens on `postMessage` for commands from the MCP server (via the host) - `SET_STUDY`, `SET_SERIES`, `SET_WL` - and posts back state on any user interaction. Tool calls from the widget back to the MCP server route through the host's `callServerTool` bridge.

**Host**: Node.js (TypeScript, official `@modelcontextprotocol/sdk` + `@modelcontextprotocol/ext-apps`). Deploy as a Streamable HTTP MCP server behind a single domain. Cloudflare Workers or Fly.io both fine. No need for long-running stateful infra - DICOMweb is stateless, the viewer holds UI state client-side.

## 5. Architecture sketch

```
+-----------+        +------------+         +-----------------+
|   User    |  chat  |  Claude    |  tool   |  MCP Server     |
| (Cowork / +------->+  host      +-------->+  (Node/TS)      |
|  Claude.ai)        |            |         |                 |
+-----------+        +-----+------+         +--------+--------+
                           |                         |
             renders       | ui://viewer             | DICOMweb proxy
             sandboxed     | HTML bundle             | (WADO-RS / QIDO-RS)
             iframe        v                         v
                   +--------------+           +---------------+
                   |  OHIF widget |  fetch    |  Orthanc demo |
                   |  (React +    +---------->+  or user PACS |
                   |  Cornerstone)|  (CORS    |               |
                   +------+-------+   proxied)+---------------+
                          |
                          | postMessage (SET_STUDY, STATE_UPDATE)
                          v
                   JSON-RPC bridge to MCP server
```

Flow for "show me the Softneta chest CT sample":

1. User types the request in Claude Cowork.
2. Claude picks `search_studies` then `open_study(study_uid)`.
3. Host fetches `ui://viewer`, renders iframe, passes the study UID as part of the tool result payload.
4. OHIF inside the iframe issues WADO-RS/QIDO-RS to our MCP server's `/dicomweb/*` proxy path.
5. Proxy forwards to `demo.orthanc-server.com/dicom-web/*`, adds CORS headers, streams bytes back.
6. Viewer renders. User scrolls, changes W/L. `STATE_UPDATE` posts to host, flows into MCP server context.
7. User: "what's the modality?" - Claude already has it from the last `describe_current_view`.

**Auth**: v1 anonymous public corpora only. v2: bearer token passed via server-side config, never in the widget. Never through Claude's model context (PHI risk).

**Viewer hosting**: bundle OHIF static assets on our own origin or a known CDN, declare origin in `resourceDomains`. Do not try to inline it into the `ui://` resource - the bundle is tens of MB.

## 6. Risks and blockers (unsugared)

1. **Sandbox quirks on large WebGL workloads**. The spec doesn't commit to WebGL2 being stable, nor to how much VRAM/texture memory the host tolerates. A 600-slice CT might silently stutter or get killed. Mitigation: empirical probe (section 7), fall back to thumbnail-first then progressive series load.
2. **CORS on real-world PACS**. Every serious customer has a locked-down PACS with no CORS. Our proxy handles that for the demo, but **"point it at your own PACS" means deploying our MCP server inside their network or setting up an authenticated tunnel**. That's a deployment story, not a v1 story.
3. **Bundle size and cold start**. OHIF's main bundle is substantial; loading it inside a Claude chat for every session is not lightweight. Cache aggressively. Consider Cornerstone3D-only minimal viewer for v2 (tens of KB to low MB).
4. **Medical compliance**. Explicitly: **this must be marketed and labeled as "for demo, education, and non-diagnostic use only"**. Any clinical diagnostic framing triggers FDA (510(k) or De Novo), EU MDR Class IIa as a medical device software, and CE marking. Fred knows the drill from Osimis. The safe language: "review, triage support, teaching, and product demos - not diagnosis."
5. **PHI / GDPR the moment anyone points it at a real PACS**. The MCP server proxy sees pixel data and metadata in transit. If the user is a covered entity, we need BAA/DPA, encryption in transit is table stakes, no logging of DICOM payloads, documented data retention. Default posture: v1 is explicitly public-dataset-only, with a hard refusal to accept authenticated endpoints. We turn that on deliberately in a later, compliance-reviewed release.
6. **AGPL contamination**. Don't casually include Stone Web Viewer or dwv in a proprietary build.
7. **Claude app ecosystem immaturity**. SEP-1865 is three months old at time of writing. Expect breaking changes. The spec is silent on several things a production medical viewer cares about (memory ceiling, long-lived connections). Budget rework.

## 7. MVP - one-week build

**Goal**: demo. User types "show me a sample chest CT" in Claude Cowork, gets an inline viewer with scroll + W/L, can ask "what's the modality?" and get an answer derived from live viewer state.

**Scope**:

- MCP server on Fly.io, Node+TS. 3 tools: `list_public_datasets`, `open_study`, `describe_current_view`. Skip search in v1.
- DICOMweb proxy path at `/dicomweb/*` pointing at `demo.orthanc-server.com/dicom-web/*`, adds CORS.
- `ui://viewer` resource loads OHIF v3 from a CDN origin we declare. OHIF configured for our proxy as its single data source.
- Widget -> server postMessage bridge: `SET_STUDY` on open, `STATE_UPDATE` on any UI change.
- Hardcoded shortlist of 3-5 curated StudyInstanceUIDs from the Orthanc demo server (chest CT, brain MR, mammography - the classics).
- README + 60-second Loom.

**Effort estimate**: 5-7 focused engineering days for someone who knows OHIF and MCP. Breakdown:

- Day 1: MCP server scaffold, tool definitions, CORS proxy.
- Day 2: Host OHIF build, verify iframe loading outside Claude.
- Day 3: Integrate with Claude Cowork, work through CSP/connectDomains surprises.
- Day 4: postMessage bridge, `describe_current_view` working both ways.
- Day 5: Curated dataset, polish, record demo.
- Day 6-7: buffer for the inevitable sandbox friction.

**Probe to run before day 1**: stand up the smallest possible MCP App (say, the `threejs-server` example from the ext-apps repo) and confirm it renders WebGL inside Claude Cowork. If WebGL is rocky in the sandbox, the whole premise shifts and we re-scope to 2D-only (dwv-class) viewing for v1.

## 8. Strategic verdict for SuperSwift

Three angles to judge it against.

**(a) Marketing/demo asset for medtech**: **high value, low cost.** SuperSwift's thesis is "AI OS for medtech B2B GTM." A Claude app that renders DICOM inline lands like a clean dog whistle to the exact audience - medical imaging founders, radiology product people, PACS vendors. It's the demo Fred can open at ECR, Gleamer, Nuclivision, IntMeDA, Affidea, any imaging AI pilot conversation. Building it costs one engineering week. The story tells itself: "the guy who co-built Orthanc now has DICOM inside Claude." That's earned authority, not claimed. Demo surface is Claude.ai (and Claude Desktop), both of which work on day one - no Cowork dependency.

**(b) Genuine product wedge**: **weak-to-medium.** The wedge thesis would be sales teams demoing DICOM studies to prospects inline, or radiologists triaging inside Claude. Sales-demo use case is real but thin - how often do medtech sellers need a live DICOM viewer in a chat? Some. Not most. The triage use case is blocked by compliance and by the sandbox's performance ceiling. This is not a standalone product. If we ship it expecting revenue, we'll be disappointed.

**(c) Developer toolkit / distribution**: **medium.** Published under `superswift/dicom-mcp` on npm and the Claude marketplace, it's a calling card that ranks SuperSwift alongside the Amplitudes and Canvas in the MCP App ecosystem. That visibility matters more than the thing itself. Reference implementation in MIT; people find us through it.

**Recommendation: build it, frame it as angle (a) first and angle (c) second.** One engineer-week of work, it ties directly to Fred's unique credibility (Osimis -> Orthanc -> DICOM), it's demoable at ECR 2026 follow-ups and every medtech pilot conversation, and it contributes to SuperSwift's position in the Claude Cowork marketplace (per the existing "SuperSwift distribution surface" project). It does **not** replace the core GTM-for-medtech thesis; it garnishes it.

Do not market it as a diagnostic tool. Do not accept customer PACS connections in v1. Do ship it with a crisp demo, a Loom, and a blog post framed around "what the agent-native medical imaging interface looks like." That post writes itself given Fred's background.

Build window: **1-2 weeks calendar time, hitting the next pilot demo cycle.** If there's no hook to an actual pilot or event in the next 4-6 weeks, park it; its value is almost entirely demo-contextual.

---

## Sources

- [MCP Apps overview - modelcontextprotocol.io](https://modelcontextprotocol.io/extensions/apps/overview)
- [MCP Apps announcement, 26 Jan 2026](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/)
- [MCP Apps specification SEP-1865](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)
- [MCP-UI guide](https://mcpui.dev/guide/introduction)
- [Claude supports MCP Apps - The Register, Jan 2026](https://www.theregister.com/2026/01/26/claude_mcp_apps_arrives/)
- [Claude updates Q1 2026 guide - confirms Cowork MCP Apps support](https://aimaker.substack.com/p/anthropic-claude-updates-q1-2026-guide)
- [OHIF iframe embedding docs](https://docs.ohif.org/deployment/iframe/)
- [OHIF URL parameters (StudyInstanceUIDs)](https://docs.ohif.org/configuration/url/)
- [OHIF DICOMweb datasource config](https://docs.ohif.org/configuration/datasources/dicom-web/)
- [Stone Web Viewer (AGPL) - Orthanc](https://www.orthanc-server.com/static.php?page=stone-web-viewer)
- [Cornerstone3D](https://www.cornerstonejs.org/)
- [dwv (GPL-3.0)](https://github.com/ivmartel/dwv)
- [Orthanc DICOMweb plugin book](https://orthanc.uclouvain.be/book/plugins/dicomweb.html)
- [DICOM Library (Softneta)](https://www.dicomlibrary.com/)
- [MedDream online viewer FAQ](https://meddream.com/faq/meddream-dicom-viewer/)
