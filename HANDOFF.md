---
title: Handoff - widget rendering debug in progress
date: 2026-04-24
status: blocked on widget mount
last_session: 2026-04-24 afternoon
---

# Handoff - pick up here in a fresh session

## Quick summary

**MVP shipped and deployed.** MCP tools work end-to-end. **One blocker:** the MCP Apps widget mounts in Claude.ai for a fraction of a second then disappears. All wire-level plumbing is correct. Need to diagnose why Claude's iframe renderer tears down our widget.

- **Prod URL:** https://orthanc-mcp-app.fly.dev
- **MCP endpoint (original):** https://orthanc-mcp-app.fly.dev/mcp
- **MCP endpoint (alias for cache-bust):** https://orthanc-mcp-app.fly.dev/mcp-v2
- **GitHub:** https://github.com/fredericlambrechts/orthanc-mcp-app
- **Current branch:** `main` (PR #1 merged; debug commits direct to main)
- **Prod version:** `0.2.0-widget`
- **Latest diagnostic commit:** `75da19f` - in-widget diagnostic panel

## What works

1. `/health` returns 200 with version + ohif_bundled flag
2. `/mcp` and `/mcp-v2` both handle full MCP Streamable HTTP protocol
3. Tools: all 7 register, callable, correct response shapes
4. `/dicomweb/orthanc-demo/*` proxy works against `orthanc.uclouvain.be/demo/dicom-web/`
5. URL parser handles all 5 reference shapes + SSRF/auth rejections
6. Server-side state sync (open_study pre-populates, describe_current_view reads)
7. Assets + favicon + OG meta on root (but Claude.ai's UI uses a curated registry, so custom connectors always show generic globe regardless)
8. `resources/read ui://viewer` returns 262 KB built HTML with inlined JS bundle
9. Server advertises `extensions.io.modelcontextprotocol/ui` with `mimeTypes: ["text/html;profile=mcp-app"]`
10. Logs confirm Claude DOES fetch `resources/read` for `ui://viewer` AND calls `tools/call open_study` - the protocol handshake completes

## What doesn't work (the blocker)

**Widget iframe does not persist in Claude.ai web or Claude Desktop.** Fred reports:
- "For a fraction of a second it gave the impression that it was going to load a widget"
- Final state: text-only tool call output, no visible iframe

## All known facts about the failure

- Fly logs show Claude fetching `resources/read` for `ui://viewer` - so Claude IS loading the widget HTML
- Fly logs show `tools/call open_study` succeeds - tool returns proper `_meta.ui.resourceUri` + `structuredContent`
- Claude.ai web console (top frame) shows:
  - `VM14:29 Sending message / Parsed message` - repeated many times → **our widget's ext-apps App class IS executing and posting messages**
  - `Ignoring message from unknown source MessageEvent` - repeated - may be Intercom/Datadog noise, unclear
  - `[MCP Apps] oncalltool handler replaced` - Claude's internal warning, unclear if relevant
  - `[COMPLETION] Starting completion request (attempt 1..5)` - Claude retrying completions, widget likely holding back the chat
- Fred did NOT yet test the 0.2.0-widget diagnostic deployment (commit `75da19f`) - he hit the session limit before running the test

## Current diagnostic state (deployed but untested)

Commit `75da19f` deployed a visual diagnostic panel inside the widget placeholder. When the widget renders (even for a fraction of a second), the placeholder now shows:

- `widget js: loading...` (initial state from HTML)
- `widget js: running` (when the bundled JS executes)
- `app.connect: calling...` / `app.connect: ok @ <time>` / `app.connect: FAILED: <error>`
- `ontoolresult: waiting` / `ontoolresult: fired @ <time>`

Also added `/mcp-v2` alias route because Claude.ai fingerprints connectors by URL and caches serverInfo/permissions per URL. Remove+re-add at the same URL does NOT force a fresh initialize handshake. The alias gives the client a clean slate.

## Exact next steps (for fresh session)

### Step 1 - test with the new diagnostic

Ask Fred to:

1. In Claude.ai → Settings → Connectors, **Remove** the existing Orthanc connector
2. Add a new custom connector with URL: `https://orthanc-mcp-app.fly.dev/mcp-v2` (note the `-v2`)
3. Open DevTools (F12) BEFORE sending the prompt
4. Paste this in top-level console to catch iframe teardowns:
   ```js
   const obs = new MutationObserver(muts => {
     for (const m of muts) for (const n of m.removedNodes) {
       if (n.tagName === 'IFRAME') {
         console.log('[iframe removed]', n.src || n.srcdoc?.slice(0, 100), new Error().stack);
       }
     }
   });
   obs.observe(document.body, {childList: true, subtree: true});
   console.log('[iframe observer] armed');
   ```
5. Send: *"Show me the BRAINIX brain MR study."*
6. Screenshot the flicker
7. Screenshot console - especially `[iframe removed]` entries and any widget-frame errors

### Step 2 - interpret

- If widget shows `widget js: running` in the flash → our JS ran. Check `app.connect` line:
  - `ok @ <time>` → handshake succeeded, something else killed the iframe (Claude-side tear-down)
  - `FAILED: <error>` → the ext-apps handshake failed, read the error
- If widget stays on `widget js: loading...` → script blocked (CSP, sandbox permissions). Check DevTools Console tab for `Refused to execute...` errors
- If widget never appears at all → Claude filtered the resource before rendering

### Step 3 - if handshake fails

Likely causes to investigate:
- **Sandbox permissions** - widget needs `allow-scripts` + `allow-same-origin` + possibly `allow-modals`
- **CSP from Claude's host** - may be stricter than our declared `_meta.ui.csp`
- **Module script blocking** - our bundle uses `<script type="module" crossorigin>` which some sandbox configs refuse
- **PostMessage transport target** - `window.parent` might resolve to wrong frame in nested iframe setup

### Step 4 - compare against known-good

The reference example at https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/threejs-server is confirmed working in Claude. Fred hasn't run Probe A yet (MVP-plan §U1) so we don't actually know if ANY custom MCP App widget renders in his Claude.ai account. This is still gated.

Before deep-debugging ours, **run Probe A** to verify Claude.ai even supports custom-connector widget rendering in his account/tier:

```bash
cd /tmp
git clone https://github.com/modelcontextprotocol/ext-apps.git
cd ext-apps/examples/threejs-server
npm install && npm run dev   # note port
# another terminal:
ngrok http <port>
# install ngrok https URL in Claude.ai, test in chat
```

If threejs widget renders: our server has a bug specific to our widget/config.
If threejs widget doesn't render either: Claude.ai web doesn't support custom-connector widgets in this account/tier. Options narrow to Claude Desktop, submit to directory, or ship without inline widget.

## Repo state

- Branch: `main`
- All tests passing: 143/143
- Recent commits (last 10):

```
75da19f chore(debug): in-widget diagnostic panel
fd8d8ec chore(debug): add /mcp-v2 alias
3d43f13 chore(debug): bump version to 0.2.0-widget, log every POST
5948e4a fix(mcp-apps): advertise io.modelcontextprotocol/ui server capability
cbd907c feat(branding): serve favicon directly + root page with OG tags
53b32ac feat(branding): Orthanc logo in Claude.ai connector UI
3d3f600 Merge pull request #1 from fredericlambrechts/feat/mvp
69e6b65 fix(api-contract): correct stale tool descriptions and sync protocol spec
5ff7e3d fix(reliability,ops): graceful shutdown, wire clearViewState, fail-fast PUBLIC_ORIGIN
c428e0e fix(security,reliability): harden DICOMweb proxy against traversal, SSRF redirects, hung upstreams
```

## Key files for the next session

- [plan.md](plan.md) - full 6-unit implementation plan (source of truth)
- [tool-signatures.md](tool-signatures.md) - MCP tool + postMessage spec
- [feasibility-study.md](feasibility-study.md) - architecture + risks
- [src/mcpServer.ts](src/mcpServer.ts) - where capability advertisement is set (line 40ish, `extensions.io.modelcontextprotocol/ui`)
- [src/ui/resource.ts](src/ui/resource.ts) - `ui://viewer` resource registration, CSP meta
- [ui/src/widget.ts](ui/src/widget.ts) - widget entry, App class init, diagnostic updates
- [ui/src/bridge.ts](ui/src/bridge.ts) - OHIF iframe bridge helpers
- [ui/index.html](ui/index.html) - widget shell with diagnostic panel (v0.2.0 build)
- [src/server.ts](src/server.ts) - Express routes, static mounts, /mcp + /mcp-v2 handlers
- [fly.toml](fly.toml) - Fly config (NOTE: `auto_stop_machines = "stop"`, `min_machines_running = 0` - cold starts are slow; Fred rejected a warm-machine change in this session)

## Fly.io operations

```bash
# Check logs
cd /Users/fredericlambrechts/code/orthanc-mcp-app
fly logs --no-tail

# Filter for MCP traffic
fly logs --no-tail | grep -E "mcp-init|mcp-post"

# Deploy a change
fly deploy --now

# Health check
curl https://orthanc-mcp-app.fly.dev/health
```

## Context from this session

- Started session post-PR #1 merge. Added Orthanc branding (logo) - discovered Claude.ai uses curated registry for icons, custom connectors show generic globe (cosmetic, not blocking)
- Attempted widget render; discovered capability mismatch - fixed in commit `5948e4a` by adding `extensions.io.modelcontextprotocol/ui` to server capabilities
- Fred reconnected multiple times but Claude.ai's URL-keyed cache kept reusing old serverInfo - added `/mcp-v2` alias as workaround
- After alias + capability fix, widget flickers but doesn't persist
- Added in-widget diagnostic panel to show state during flicker
- Fred hit context limit before running the diagnostic test

## Deferred items (also in [plan.md](plan.md) § "Deferred")

- Run Probe A (threejs-server in Claude.ai) - gated in U1 but skipped
- Run Probe B (threejs-server in Cowork) - informational
- Populate `ohif-dist/` for real OHIF pixel rendering - blocked on widget mount working first
- Record Loom (script at [demo/script.md](demo/script.md))
- Blog post (outline at [demo/blog-outline.md](demo/blog-outline.md))
- Heads-up to Benoit Crickboom (Orthanc team lead, Liège) - using their demo server as default corpus in a public Claude app, courtesy DM before any public launch
- Remaining P2/P3 from [code review](https://github.com/fredericlambrechts/orthanc-mcp-app/pull/1) - can wait until widget renders

## Cost / operational state

- Fly.io: single shared-cpu-1x machine, auto-stop when idle. First request after idle = 5-15s cold start. Fred rejected a proposed change to `min_machines_running = 1` in this session.
- Monthly cost estimate: ~$0-5 given low traffic. Fly $5 Hobby credit covers it.
- No OAuth on our `/mcp` endpoint yet - anyone can use it as a DICOMweb CORS proxy to Orthanc demo. Acceptable for v1 demo per the plan.
