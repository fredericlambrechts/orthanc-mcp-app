---
title: Prior art - DICOM MCP and adjacent work
date: 2026-04-24
status: research
---

## Verdict

This is genuinely greenfield on the specific combination: no one has shipped an MCP App that embeds a DICOM viewer (OHIF or otherwise) inline in Claude chat. Several DICOM MCP *servers* exist (query-only, no rendering), and the MCP Apps iframe pattern has been demonstrated with complex 3D/interactive content (Autodesk APS viewer, Three.js). The closest project is `sscotti/dicom-mcp`, which wires Orthanc + FHIR + a basic web UI together but does not use MCP Apps and has no viewer embed. The gap is real and the timing is right: MCP Apps shipped January 2026 and no one in the medical imaging community has reacted yet.

## Direct hits

No project has shipped a DICOM MCP App with an embedded viewer. The query-only DICOM MCP servers are:

- **ChristianHinge/dicom-mcp** - The most mature DICOM MCP server. Supports C-FIND (query patients, studies, series, instances), C-MOVE, C-ECHO, and PDF extraction from DICOM instances. Configured by default to point at a local Orthanc server. Last release v0.1.2, April 2025. 94 stars, 26 forks. No viewer, no UI widget. Explicitly marked not for clinical use. [GitHub](https://github.com/ChristianHinge/dicom-mcp) | [PulseMCP](https://www.pulsemcp.com/servers/christianhinge-dicom)

- **sscotti/dicom-mcp** - The most ambitious. Integrates Orthanc (PACS), FHIR resources, a mini-RIS database, MWL/MPPS services, radiology report generation, and PDF output. Includes an experimental custom web UI at port 8080 with LLM-chat and a tool browser. 82 commits, 2 stars, actively maintained. Does NOT use MCP Apps for the UI - the web interface is separate from the MCP protocol. No viewer embed. [GitHub](https://github.com/sscotti/dicom-mcp)

- **berkdurmus/mcp-dicom-server** - File-level DICOM tool: metadata extraction, tag management, PNG conversion with window/level, anonymization, batch processing. 1 star, 1 commit. No viewer. [GitHub](https://github.com/berkdurmus/mcp-dicom-server)

- **fluxinc/dicom-mcp-server** - Minimal connectivity tester: C-ECHO and node listing only. 3 stars, 2 commits. [GitHub](https://github.com/fluxinc/dicom-mcp-server)

## Near misses

- **OHIF-AI (CCI-Bonn)** - Adds AI segmentation (SAM2, nnInteractive, MedSAM2) and LLM report generation (MedGemma, GPT, Claude, Gemini) to the OHIF viewer via server-side inference. The viewer stays separate from the LLM interaction - no conversational loop, no MCP. The LLM generates text reports, not images. [GitHub](https://github.com/CCI-Bonn/OHIF-AI)

- **mcp-slicer** - Connects 3D Slicer to Claude Desktop via MCP. Claude can execute Python inside Slicer and capture screenshots for feedback, creating a vision-based REACT loop. Viewer stays in its own window - not embedded in chat. 30 stars, 11 commits, experimental.

- **UBOS OHIF MCP listing** - A marketplace listing that wraps OHIF for enterprise AI agent workflows. Details are ambiguous; no confirmed inline viewer in chat. [UBOS](https://ubos.tech/mcp/ohif-medical-imaging-viewer/overview/)

- **RSNA 2024 / ChatGPT + DICOM de-identification lab** - GPT-4o used to examine PNG exports of DICOM images for de-ID tasks. No viewer embedding, no MCP, one-shot image analysis only. [GitHub](https://github.com/georgezero/rsna24-chatctp-dicom-deid-using-chatgpt-mllm)

## Reference MCP UI apps

These prove what is structurally possible inside the MCP Apps iframe sandbox:

- **Autodesk APS Viewer MCP App** - Embeds Autodesk's full 3D model viewer inside Claude chat. A `preview-design` tool fetches viewer credentials, returns config; the iframe loads the viewer via `ui://` URI, communicates bidirectionally with the MCP server via `@modelcontextprotocol/ext-apps`. Users can orbit, zoom, select elements; selections flow back to the AI. This is the closest structural analog to the proposed OHIF embed. [Autodesk blog](https://aps.autodesk.com/blog/embedding-aps-viewer-ai-chats-mcp-apps)

- **threejs-server (ext-apps repo)** - Official reference implementation: interactive 3D scene rendered in-chat. Demonstrates that WebGL-based renderers work inside the sandboxed iframe. [GitHub](https://github.com/modelcontextprotocol/ext-apps) | [Three.js forum discussion](https://discourse.threejs.org/t/hello3dmcp-ai-driven-3d-interactive-app/89133)

- **map-server (ext-apps repo)** - Interactive 3D globe (CesiumJS) rendered inline, proving CDN-loaded large JS libraries work in the sandbox. [GitHub](https://github.com/modelcontextprotocol/ext-apps)

- **pdf-server (ext-apps repo)** - Interactive PDF viewer with chunked loading inline in chat. Structurally analogous to streaming DICOM frames on demand. [GitHub](https://github.com/modelcontextprotocol/ext-apps)

The ext-apps sandbox allows: sandboxed iframes, CDN asset loading (CSP configuration required), bidirectional JSON-RPC communication, and pre-declared HTML templates that hosts review before rendering. No medical imaging example exists in the 18 official examples.

## Commercial competitive landscape

No PACS or radiology AI vendor has shipped an LLM chat interface with inline DICOM image rendering as of April 2026.

- **Aidoc** - Deep EHR/PACS/scheduling integration, FDA-cleared foundation model, worklist triage. No conversational viewer.
- **Rad AI** - Radiology report drafting (pre-fills impressions from structured findings). No image display.
- **Harrison.ai** - Multimodal radiology LLM (harrison.rad.1) trained on DICOM images; accepts interleaved text+image input. Server-side inference model, no viewer widget.
- **New Lantern** - "AI-native radiology platform" combining worklist, viewer, and AI reporting in one workspace. Closest to a unified UI but no conversational image-display feature confirmed. [New Lantern](https://newlantern.ai/)
- **OHIF-AI** - Academic project (CCI-Bonn), not a commercial product.

The commercial bar is: LLMs are used for report drafting or worklist triage, not for interactive image exploration in a chat UI. Nobody has crossed that line.

## What this means

- **The gap is the viewer embed.** Every DICOM MCP server stops at metadata and text. The proposed build - DICOMweb query + OHIF rendered inline via MCP Apps iframe + bidirectional study-selection feedback - has no direct competitor in open source or commercial products as of April 2026.

- **The Autodesk APS app is the template.** The `ui://` resource + `@modelcontextprotocol/ext-apps` bidirectional pattern is proven with a similarly heavy 3D viewer. OHIF is a React SPA loadable from a CDN (or self-hosted); the technical approach is the same. The main unknowns are CSP configuration for DICOMweb requests and WADO-RS binary frame streaming inside the iframe.

- **Watch `sscotti/dicom-mcp`.** It has Orthanc integration, FHIR, and a custom chat UI already. The author is close to this problem space. If they discover MCP Apps and wire in OHIF, they could ship a rough version quickly. 82 commits suggests active development.

## Sources

- [ChristianHinge/dicom-mcp - GitHub](https://github.com/ChristianHinge/dicom-mcp)
- [DICOM MCP Server - PulseMCP](https://www.pulsemcp.com/servers/christianhinge-dicom)
- [sscotti/dicom-mcp - GitHub](https://github.com/sscotti/dicom-mcp)
- [berkdurmus/mcp-dicom-server - GitHub](https://github.com/berkdurmus/mcp-dicom-server)
- [fluxinc/dicom-mcp-server - GitHub](https://github.com/fluxinc/dicom-mcp-server)
- [OHIF-AI (CCI-Bonn) - GitHub](https://github.com/CCI-Bonn/OHIF-AI)
- [UBOS OHIF MCP listing](https://ubos.tech/mcp/ohif-medical-imaging-viewer/overview/)
- [Autodesk APS Viewer MCP App blog](https://aps.autodesk.com/blog/embedding-aps-viewer-ai-chats-mcp-apps)
- [MCP Apps announcement - modelcontextprotocol.io blog](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/)
- [ext-apps official repo - GitHub](https://github.com/modelcontextprotocol/ext-apps)
- [Three.js MCP forum discussion](https://discourse.threejs.org/t/hello3dmcp-ai-driven-3d-interactive-app/89133)
- [TensorBlock awesome-mcp-servers healthcare section](https://github.com/TensorBlock/awesome-mcp-servers/blob/main/docs/healthcare--life-sciences.md)
- [sunanhe/awesome-medical-mcp-servers](https://github.com/sunanhe/awesome-medical-mcp-servers)
- [RSNA 2024 ChatGPT DICOM lab](https://github.com/georgezero/rsna24-chatctp-dicom-deid-using-chatgpt-mllm)
- [The Register - Claude MCP Apps launch](https://www.theregister.com/2026/01/26/claude_mcp_apps_arrives/)
- [New Lantern radiology platform](https://newlantern.ai/)
