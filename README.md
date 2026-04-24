# orthanc-mcp-app

> **Status: in development.** This is the MVP scaffold. See [plan.md](plan.md) for the implementation roadmap.

A Claude MCP App that embeds the OHIF DICOM viewer inline in a Claude conversation. Open any DICOMweb study by pasting a link.

## Non-diagnostic use only

**For demonstration, education, and non-diagnostic use only. Not a medical device. Not cleared by FDA, not CE-marked under MDR. Do not use for clinical diagnosis.**

## What it does (once shipped)

- Paste a DICOMweb URL, an Orthanc study URL, or a bare StudyInstanceUID in Claude and see the study render inline via the OHIF viewer.
- Scroll, window/level, and navigate series directly in the chat.
- Ask Claude questions about what is displayed ("what's the modality?", "how many slices?") and get answers grounded in live viewer state.
- Works with any DICOMweb-compliant server. Defaults to the Orthanc public demo at `https://orthanc.uclouvain.be/demo/dicom-web/`.

## Background

- [feasibility-study.md](feasibility-study.md) - approach, risks, and strategic verdict
- [tool-signatures.md](tool-signatures.md) - MCP tool schemas, URL parser spec, postMessage protocol
- [prior-art.md](prior-art.md) - competitive landscape (greenfield on the viewer embed)
- [plan.md](plan.md) - implementation plan (6 units)
- [probes/RESULTS.md](probes/RESULTS.md) - Day 0 probe outcomes

## Attribution

- Powered by [Orthanc](https://www.orthanc-server.com/), the open-source DICOM server.
- Default test corpus is the [Orthanc public demo](https://orthanc.uclouvain.be/demo/).
- Viewer: [OHIF Viewer v3](https://ohif.org/) (MIT licensed).
- Protocol: [MCP Apps (SEP-1865)](https://modelcontextprotocol.io/extensions/apps/overview).

## License

MIT - see [LICENSE](LICENSE).
