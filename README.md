# orthanc-mcp-app

A Claude MCP App that embeds the OHIF DICOM viewer inline in a Claude conversation. Paste any DICOMweb study link and the viewer renders in-chat. Backed by a thin Node/TypeScript MCP server with a DICOMweb CORS proxy, deployed on Fly.io.

> ### For demonstration, education, and non-diagnostic use only
>
> **This is not a medical device.** Not cleared by FDA, not CE-marked under MDR. Do not use for clinical diagnosis.

## What it does

- Paste any DICOMweb study URL, Orthanc URL, or bare StudyInstanceUID in Claude and see the study render inline.
- Scroll, window/level, switch series - the viewer is fully interactive inside the chat iframe.
- Ask Claude questions about what is displayed ("what's the modality?", "how many slices?") and get answers grounded in live viewer state.
- Works with any DICOMweb-compliant server. Default corpus is the [Orthanc public demo](https://orthanc.uclouvain.be/demo/).

## Tool surface

| Tool | Purpose |
|---|---|
| `list_dicom_servers` | List configured DICOMweb endpoints |
| `list_public_datasets` | Curated shortlist of sample studies (Orthanc demo) |
| `search_studies` | QIDO-RS search |
| `open_study` | Parse a URL/UID and render the viewer |
| `describe_current_view` | Read live viewer state |
| `set_view` | Programmatic navigation (series, slice, window/level presets) |

Internal tool (widget -> server only): `_record_view_state`. See [tool-signatures.md](tool-signatures.md) for full schemas.

## Install in Claude.ai

Once the server is deployed to Fly.io (see below):

1. Open Claude.ai Settings → Connectors / Apps.
2. Add a custom MCP server. Point it at `https://orthanc-mcp-app.fly.dev/mcp` (replace with your Fly.io domain if different).
3. Install and approve.
4. In a new chat, try: **"Show me a chest CT"** or paste an Orthanc study link.

Also supported: **Claude Desktop** (same URL, add via Settings → MCP Apps).

Cowork support is not officially documented as of April 2026 - see [probes/RESULTS.md](probes/RESULTS.md).

## Usage examples

- *"Show me the BRAINIX study."* - Claude uses `list_public_datasets` + `open_study`.
- *"Open https://orthanc.uclouvain.be/demo/ui/app/#/studies/&lt;id&gt;"* - URL parsed, Orthanc REST looked up, study opened.
- *"Switch to the lung window."* - `set_view` with preset, viewer updates live.
- *"What modality am I looking at?"* - `describe_current_view` returns state.

## Local development

```bash
# Prereqs: Node 22+, npm
git clone https://github.com/fredericlambrechts/orthanc-mcp-app.git
cd orthanc-mcp-app
npm install
npm run build:ui   # builds the widget bundle into dist/ui/index.html
npm run dev        # starts the MCP server on http://localhost:3000
```

Test the health endpoint:
```bash
curl http://localhost:3000/health
```

Test the MCP endpoint with MCP Inspector:
```bash
npx @modelcontextprotocol/inspector
# Connect to http://localhost:3000/mcp (Streamable HTTP)
```

Run the test suite (includes live integration tests against Orthanc demo):
```bash
npm test
```

## Deploy to Fly.io

```bash
# One-time setup
fly auth login
fly apps create orthanc-mcp-app
fly secrets set PUBLIC_ORIGIN=https://orthanc-mcp-app.fly.dev

# Deploy
fly deploy
```

The `fly.toml` is tuned for a demo instance: 512 MB RAM, `shared-cpu-1x`, auto-stop when idle, Amsterdam (EU) region.

## OHIF bundle

OHIF v3 is self-hosted at `/ohif/*` on the Fly.io origin (single-origin deployment, no third-party CDN). Before the first deploy, populate `ohif-dist/` with an OHIF build - see [scripts/download-ohif.sh](scripts/download-ohif.sh) for options. If `ohif-dist/` is empty, `/ohif/viewer` serves a placeholder that echoes query params; all other routes still work.

## Architecture

```
User prompt                 Claude host (Claude.ai / Desktop)
     |                              |
     '------ chat message --------->|
                                    |
                                    |-- tool call (open_study) ------>  MCP server (Fly.io)
                                    |                                        |
                                    |   <--- _meta.ui.resourceUri ----'      |
                                    |                                        |
                                    |-- fetch ui://viewer resource -->'      |
                                    |                                        |
                                    |   <--- HTML widget bundle ------'      |
                                    |                                        |
  iframe mounted in chat   <--------'                                        |
     |                                                                        |
     |-- OHIF iframe -> /dicomweb/:server/... -----------------------> CORS proxy
     |                                                                        |
     |                                                              forwards to Orthanc /
     |                                                              any DICOMweb server
     |                                                                        |
     |-- postMessage STATE_UPDATE ---> callServerTool(_record_view_state) --->|
     |
  user sees viewer
```

Background docs:

- [feasibility-study.md](feasibility-study.md) - approach, risks, strategic verdict
- [tool-signatures.md](tool-signatures.md) - MCP tool schemas, URL parser spec, postMessage protocol
- [prior-art.md](prior-art.md) - competitive landscape
- [plan.md](plan.md) - 6-unit implementation plan
- [probes/RESULTS.md](probes/RESULTS.md) - Day 0 probe outcomes

## Attribution

- Viewer: [OHIF Viewer v3](https://ohif.org/) - MIT licensed.
- Default test corpus: the [Orthanc public demo](https://orthanc.uclouvain.be/demo/) - thanks to the Orthanc team for maintaining it.
- Protocol: [MCP Apps (SEP-1865)](https://modelcontextprotocol.io/extensions/apps/overview) - Model Context Protocol extension specified and merged January 2026.

## License

MIT - see [LICENSE](LICENSE).
