---
title: Handoff - widget rendering unblocked
date: 2026-04-24
status: widget mounts and persists; polish + demo are next
last_session: 2026-04-24 afternoon
---

# Handoff - pick up here in a fresh session

## Quick summary

**The widget-render blocker is resolved.** Root cause was a server bug, not a widget bug: on unknown `mcp-session-id` the server returned HTTP 400 instead of 404, so Claude.ai's MCP client did not re-initialize after Fly machine restarts wiped the in-memory session map. Claude retried 3× with the stale session, surfaced "server returning errors on every call", and the widget never had tool output to render — which previously *looked* like a "widget flickers then disappears" problem.

- **Prod URL:** https://orthanc-mcp-app.fly.dev
- **MCP endpoint:** https://orthanc-mcp-app.fly.dev/mcp (and `/mcp-v2` alias)
- **GitHub:** https://github.com/fredericlambrechts/orthanc-mcp-app
- **Current branch:** `main` (PR #1 merged; fix landed direct)
- **Prod version:** `0.2.0-widget` (built from commit `162373f`)
- **Latest commit:** `162373f` - fix(mcp): return 404 for unknown session so client re-initializes

## What works end-to-end (verified 2026-04-24)

Verified by driving Claude.ai via the Chrome extension MCP and reading Fly logs:

1. User sends *"Show me the BRAINIX brain MR study"* in a fresh chat
2. Claude sends `tools/call` with stale `mcp-session-id` → server returns **404**
3. Claude immediately sends a fresh `initialize` → new session created
4. Claude calls tools; `resources/read ui://viewer` succeeds
5. Widget iframe mounts at `https://<hash>.claudemcpcontent.com/mcp_apps?...` with `sandbox="allow-scripts allow-same-origin allow-forms"`, parent in the assistant message bubble
6. Iframe persists (no teardown) for the life of the chat turn

MutationObserver proof: only one `added` event for the widget iframe during the turn, zero `removed` events.

## What's left

These were deferred in [plan.md](plan.md) §Deferred and are now unblocked:

- **Populate `ohif-dist/`** for real OHIF pixel rendering. Widget currently shows our placeholder/viewer shell — pixels are not yet being displayed because the OHIF bundle is not included. `/health` reports `ohif_bundled:false`.
- **Back the widget's full viewport**. Current rendered size is 720×150; the OHIF iframe needs more height. Check Claude's sizing constraints.
- **Remove the in-widget diagnostic panel** introduced by commit `75da19f`. Keep the production shell clean once OHIF ships.
- **Run Probe A** (threejs reference widget in Claude.ai) — was gated in U1 but skipped. Useful for sanity-checking our widget against the known-good reference.
- **Record Loom demo** (script at [demo/script.md](demo/script.md)).
- **Blog post** (outline at [demo/blog-outline.md](demo/blog-outline.md)).
- **Courtesy DM** to Benoit Crickboom (Orthanc team lead, Liège) before any public launch — we default to their demo server.
- **Remaining P2/P3 items** from [code review](https://github.com/fredericlambrechts/orthanc-mcp-app/pull/1).

## How the session-404 fix works

Files touched:
- [src/server.ts](src/server.ts) - split the POST handler: stale session id → 404 with JSON-RPC code `-32001`; GET and DELETE aligned the same way.
- [test/mcp.session.test.ts](test/mcp.session.test.ts) - 5 new tests covering POST/GET/DELETE behavior on stale id, missing id on non-initialize, and the `/mcp-v2` alias.

All 148 tests pass.

## If the widget starts misbehaving again

Useful reproduction / diagnostic commands:

```bash
# health + version
curl -sS https://orthanc-mcp-app.fly.dev/health

# confirm 404 contract (the fix)
curl -sS -o /dev/null -w "%{http_code}\n" -X POST \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -H "mcp-session-id: stale" \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{}}' \
  https://orthanc-mcp-app.fly.dev/mcp
# expected: 404

# tail logs
fly logs --no-tail

# deploy
cd /Users/fredericlambrechts/code/orthanc-mcp-app && fly deploy --now
```

Drive Claude.ai from Claude Code (no manual steps): run `/chrome` to confirm the browser extension is connected, then ask this agent to test the widget. It can send prompts, arm a `MutationObserver`, and read the iframe lifecycle without the user having to paste anything.

## Key files for the next session

- [plan.md](plan.md) - full 6-unit implementation plan
- [tool-signatures.md](tool-signatures.md) - MCP tool + postMessage spec
- [src/mcpServer.ts](src/mcpServer.ts) - capability advertisement (`extensions.io.modelcontextprotocol/ui`)
- [src/ui/resource.ts](src/ui/resource.ts) - `ui://viewer` resource registration, CSP meta
- [ui/src/widget.ts](ui/src/widget.ts) - widget entry, App class init
- [ui/src/bridge.ts](ui/src/bridge.ts) - OHIF iframe bridge helpers
- [ui/index.html](ui/index.html) - widget shell (currently includes diagnostic panel — remove when shipping OHIF)
- [src/server.ts](src/server.ts) - Express routes, 404-on-stale-session behavior (lines 154–192 for POST, 205–234 for GET/DELETE)

## Fly.io operations

```bash
cd /Users/fredericlambrechts/code/orthanc-mcp-app
fly logs --no-tail              # tail
fly logs --no-tail | grep mcp   # filter MCP traffic
fly deploy --now                # deploy
```

Cost: single shared-cpu-1x machine, auto-stop when idle. First request after idle = 5–15s cold start. `min_machines_running = 0` per `fly.toml` — Fred rejected a proposed change to keep one warm. Machine restarts were the trigger for the session-404 bug, which is now handled gracefully.

## Cost / operational state

- Monthly cost: ~$0–5. Fly $5 Hobby credit covers it.
- No OAuth on `/mcp` endpoint; anyone can use it as a DICOMweb CORS proxy to Orthanc demo. Acceptable for v1 demo per the plan.
