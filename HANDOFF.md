---
title: Handoff - manual steps before deploy
date: 2026-04-24
status: ready-for-fred
---

# Handoff

U1-U6 are complete on the `feat/mvp` branch. 91 passing tests, local production build verified. The remaining work is manual and requires your accounts.

## 1. Run the two probes (~15 minutes)

These were gated in the plan and need your Claude.ai / Cowork accounts. Results record to [probes/RESULTS.md](probes/RESULTS.md).

### Probe A - threejs-server in Claude.ai

Proves a WebGL MCP App widget renders inside Claude.ai at all. Must pass before deploy.

```bash
# In a separate terminal
cd /tmp
git clone https://github.com/modelcontextprotocol/ext-apps.git
cd ext-apps/examples/threejs-server
npm install
npm run dev    # notes which port it uses

# In another terminal
ngrok http <port>   # grab the https URL
```

Then in Claude.ai → Settings → Connectors (or Apps) → Add a custom MCP server → paste the ngrok https URL. Invoke it in a chat. Confirm: a WebGL scene renders inline and responds to mouse drag.

Update `probes/RESULTS.md` with: date, pass/fail, screenshot path.

### Probe B - same thing in Claude Cowork

Same ngrok URL, same install flow, but in Cowork. Informational - documents whether we can pitch this to Cowork sales/ops users.

Record outcome.

## 2. Populate `ohif-dist/` (optional for first deploy)

Without this, `/ohif/viewer` serves a placeholder that echoes query params. Tools still work, MCP plumbing still works, but no actual DICOM pixels render.

Three options - pick one:

- **Easiest (punt to v2):** deploy without OHIF. The demo still shows MCP + DICOMweb + tool calls. Pixel rendering is a follow-up.
- **Fastest (temporary CDN):** edit `src/tools/open_study.ts` `ohifBasePath` to `https://viewer.ohif.org/viewer` and add that origin to `src/ui/resource.ts` `frameDomains`. Violates Path A's single-origin principle but gets pixels on screen in a day.
- **Proper (self-hosted):** clone OHIF Viewers, `yarn build`, copy `platform/app/dist/*` into `ohif-dist/`, redeploy. Budget 2-3 hours for first-time OHIF build.

See [scripts/download-ohif.sh](scripts/download-ohif.sh) for details.

## 3. Deploy to Fly.io (~10 minutes)

```bash
cd /Users/fredericlambrechts/code/orthanc-mcp-app
fly apps create orthanc-mcp-app
fly secrets set PUBLIC_ORIGIN=https://orthanc-mcp-app.fly.dev
fly deploy
```

Watch for the deploy URL. Hit `/health` to confirm it's up:

```bash
curl https://orthanc-mcp-app.fly.dev/health
# {"ok":true,"name":"orthanc-mcp-app","version":"0.1.0","ohif_bundled":false}
```

## 4. Install in Claude.ai (~2 minutes)

1. Claude.ai → Settings → Connectors.
2. Add custom MCP server → `https://orthanc-mcp-app.fly.dev/mcp`.
3. Install and approve.
4. In a new chat: *"Show me the BRAINIX study."*

If `ohif_bundled: true` you'll see the real OHIF viewer. If false, you'll see the placeholder page echoing the study UID and DICOMweb base URL.

## 5. Record the Loom

Script is at [demo/script.md](demo/script.md). 60 seconds. Use whatever recorder you prefer - QuickTime is fine if you don't want to sign up for Loom yet.

## 6. Write the blog post (when the demo feels right)

Outline is at [demo/blog-outline.md](demo/blog-outline.md). 800-1200 words. Ships through LinkedIn first, then cross-post to Hacker News / /r/medicalimaging.

## Done state

When all of the above is green:

- PR merged (or feat/mvp deployed directly)
- Fly.io instance is running and reachable
- MCP App installed in your Claude.ai account
- Loom recorded and uploaded
- Blog post drafted

Then this is a usable demo asset for the ECR follow-up conversations and next pilot intro.

---

## Things deferred (not part of v1)

- STOW-RS upload
- Authenticated PACS connections (requires BAA/DPA compliance review)
- Annotations / measurements / segmentation overlays
- Multi-study comparison and hanging protocols
- Export snapshot to chat
- Cornerstone3D-only minimal bespoke viewer (alternative to OHIF)

See [plan.md](plan.md) § "Deferred to Follow-Up Work".
