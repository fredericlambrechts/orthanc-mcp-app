---
title: MCP tool signatures and URL parsing
date: 2026-04-24
status: draft
owner: fred
---

# Tool signatures and URL parsing

Concrete v1 spec for the `superswift/dicom-mcp` server. Six tools, one UI resource, one URL parser. Written to be implementable directly.

## Tool surface at a glance

| Tool | Purpose | Side effect |
|---|---|---|
| `list_dicom_servers` | List configured DICOMweb endpoints | None |
| `list_public_datasets` | Curated sample StudyUIDs (chest CT, brain MR, etc.) | None |
| `search_studies` | QIDO-RS patient/modality/date search | None |
| `open_study` | Headline action. Parses URL/UID, mounts viewer | Returns `ui://viewer` resource |
| `describe_current_view` | Read live viewer state (study, series, slice, W/L) | None - pulls from last `STATE_UPDATE` |
| `set_view` | Programmatic navigation (series, slice, W/L) | Posts `SET_VIEW` to widget |

v2 additions (not in v1): `add_annotation`, `list_annotations`, `export_snapshot`, `compare_studies`.

## Tool schemas

### `list_dicom_servers`

```json
{
  "name": "list_dicom_servers",
  "description": "List DICOMweb endpoints available to this MCP server. Returns the default (Orthanc demo) plus any user-configured endpoints.",
  "input": {},
  "output": {
    "servers": [
      {
        "id": "orthanc-demo",
        "label": "Orthanc public demo server",
        "base_url": "https://demo.orthanc-server.com/dicom-web",
        "auth": "none",
        "default": true
      }
    ]
  }
}
```

### `list_public_datasets`

```json
{
  "name": "list_public_datasets",
  "description": "Curated sample studies from the Orthanc demo server. Use when the user wants to see an example without providing a URL.",
  "input": {},
  "output": {
    "datasets": [
      {
        "label": "Chest CT - adult, contrast",
        "modality": "CT",
        "study_uid": "1.2.840.113845.11.1000000001951524609.20200705182951.2689481",
        "server_id": "orthanc-demo"
      }
    ]
  }
}
```

Hardcode 5-8 entries for v1. Picked to demo the range: one CT, one MR, one mammography, one ultrasound, one PET/CT.

### `search_studies`

```json
{
  "name": "search_studies",
  "description": "QIDO-RS search against a DICOMweb server.",
  "input": {
    "server_id": { "type": "string", "optional": true },
    "patient_name": { "type": "string", "optional": true },
    "modality": { "type": "string", "optional": true, "enum": ["CT", "MR", "CR", "DX", "US", "MG", "PT", "NM", "XA"] },
    "study_date_from": { "type": "string", "format": "YYYYMMDD", "optional": true },
    "study_date_to": { "type": "string", "format": "YYYYMMDD", "optional": true },
    "limit": { "type": "integer", "default": 20, "max": 100 }
  },
  "output": {
    "studies": [
      {
        "study_uid": "1.2.840...",
        "patient_name": "ANON^0001",
        "study_date": "20200705",
        "modality": "CT",
        "study_description": "CHEST W/ CONTRAST",
        "num_series": 4,
        "num_instances": 612
      }
    ]
  }
}
```

### `open_study` (the headline)

```json
{
  "name": "open_study",
  "description": "Open a DICOM study in the embedded viewer. Accepts a StudyInstanceUID, a DICOMweb study URL, an Orthanc UI URL, or an Orthanc REST URL. Parses and normalises the reference, resolves to a StudyInstanceUID via QIDO-RS if needed, then mounts the OHIF viewer.",
  "input": {
    "reference": {
      "type": "string",
      "description": "Any of: bare StudyInstanceUID (e.g. '1.2.840.113...'), DICOMweb study URL, Orthanc UI URL, Orthanc REST URL."
    },
    "server_id": {
      "type": "string",
      "optional": true,
      "description": "Override the DICOMweb server. If omitted, inferred from the reference or defaults to orthanc-demo."
    },
    "initial_series_uid": { "type": "string", "optional": true }
  },
  "output": {
    "study_uid": "1.2.840...",
    "server_id": "orthanc-demo",
    "ui_resource": "ui://viewer",
    "ui_meta": {
      "resourceUri": "ui://viewer",
      "initialData": {
        "studyUid": "1.2.840...",
        "seriesUid": null,
        "dicomwebBaseUrl": "/dicomweb/orthanc-demo"
      }
    }
  }
}
```

The tool result includes the `_meta.ui.resourceUri` pointer that the host uses to render the widget inline per [MCP Apps SEP-1865](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx).

### `describe_current_view`

```json
{
  "name": "describe_current_view",
  "description": "Return the viewer's current state: active study, series, slice index, window/level, zoom, and any loaded metadata. Call this when the user asks questions about what they're looking at.",
  "input": {},
  "output": {
    "study_uid": "1.2.840...",
    "series_uid": "1.2.840...",
    "modality": "CT",
    "slice_index": 142,
    "slice_count": 512,
    "window_center": 40,
    "window_width": 400,
    "preset": "soft-tissue",
    "patient_age": "054Y",
    "patient_sex": "M",
    "slice_thickness_mm": 0.625,
    "last_updated_at": "2026-04-24T14:22:10.341Z"
  }
}
```

Server maintains this as cached state, updated by `STATE_UPDATE` postMessage from the widget. No live round-trip to the viewer.

### `set_view`

```json
{
  "name": "set_view",
  "description": "Programmatically navigate the viewer. Any omitted field is left unchanged.",
  "input": {
    "series_uid": { "type": "string", "optional": true },
    "slice_index": { "type": "integer", "optional": true },
    "window_center": { "type": "number", "optional": true },
    "window_width": { "type": "number", "optional": true },
    "preset": {
      "type": "string",
      "optional": true,
      "enum": ["soft-tissue", "lung", "bone", "brain", "mediastinum", "liver", "default"]
    }
  },
  "output": { "applied": true }
}
```

Presets are sugar. `"preset": "lung"` resolves server-side to `window_center: -600, window_width: 1500` before posting to the widget.

## URL parser spec

The single point where user input becomes a `StudyInstanceUID`. Must handle four shapes without prompting the user to disambiguate.

```
Input: string

1. Strip whitespace.
2. If matches OID regex (^[0-9]+(\.[0-9]+)+$) AND length > 16:
     -> treat as bare StudyInstanceUID, use default server.

3. If starts with http(s):// -> parse URL.

   3a. Orthanc UI URL:
       Pattern: /ui/app/#/studies/<orthanc-id>
       Example: https://demo.orthanc-server.com/ui/app/#/studies/4d52b9c7-ff3aa9c0-...
       Action:
         - Extract host -> match against configured servers OR register ad-hoc.
         - Extract orthanc-id from fragment.
         - GET {host}/studies/{orthanc-id} (Orthanc REST, not DICOMweb)
         - Read MainDicomTags.StudyInstanceUID.

   3b. Orthanc REST URL:
       Pattern: /studies/<orthanc-id>
       Example: https://demo.orthanc-server.com/studies/4d52b9c7-...
       Action: same as 3a step 3.

   3c. DICOMweb study URL:
       Pattern: /dicom-web/studies/<study-uid>  (also /dicomweb/, /wado-rs/)
       Example: https://demo.orthanc-server.com/dicom-web/studies/1.2.840.113...
       Action:
         - Extract host and base path -> register as server if unknown.
         - Extract study-uid from path. Done.

   3d. OHIF share URL:
       Pattern: /viewer?StudyInstanceUIDs=<uid>
       Action: extract query param.

   3e. Anything else from a known host:
       - Try QIDO-RS search on that host for anything matching the URL fragment.
       - If one result, take it. If zero or many, return an error the model can act on.

4. Else: return structured error
     { code: "UNPARSEABLE", message: "...", suggestions: ["paste a StudyInstanceUID", "..."] }
```

Server matching rule: if the host matches a configured `base_url` origin, use that `server_id`. Otherwise, register an ad-hoc server entry and proxy through the MCP server's `/dicomweb/<host-hash>/*` path. Ad-hoc servers only accept anonymous endpoints in v1 - any URL that looks authenticated (presence of `Authorization` hint, `/auth/` segment, or `token=` param) returns an error refusing to connect.

Rejection list for v1: no `file://`, no `data:`, no non-HTTP schemes, no IP-literal URLs (force hostnames so we can reason about where data is flowing).

## postMessage protocol (widget <-> host <-> server)

```
// Server -> Widget (via host relay)
{ type: "SET_STUDY", studyUid, dicomwebBaseUrl, seriesUid? }
{ type: "SET_VIEW", seriesUid?, sliceIndex?, windowCenter?, windowWidth? }

// Widget -> Server (via host relay)
{ type: "STATE_UPDATE", studyUid, seriesUid, sliceIndex, slice_count, wc, ww, modality, ... }
{ type: "ERROR", code: "LOAD_FAILED" | "CORS" | "NOT_FOUND", detail }

// Widget -> Server (tool call back, via host's callServerTool bridge)
{ tool: "log_event", args: { name: "window_level_changed", wc, ww } }
```

The widget debounces `STATE_UPDATE` to 250 ms to avoid flooding the MCP server during scroll.

## Example chat flow (actual tool calls)

User:

> Open this: https://demo.orthanc-server.com/ui/app/#/studies/4d52b9c7-ff3aa9c0-e9ffef79-5ef2ec49-7a72eefc

Claude calls:

```json
{
  "tool": "open_study",
  "args": {
    "reference": "https://demo.orthanc-server.com/ui/app/#/studies/4d52b9c7-ff3aa9c0-e9ffef79-5ef2ec49-7a72eefc"
  }
}
```

Server:

1. Parses as Orthanc UI URL (case 3a).
2. Resolves orthanc-id to StudyInstanceUID: `GET https://demo.orthanc-server.com/studies/4d52b9c7-...` -> `StudyInstanceUID: 1.2.840.113...`.
3. Returns tool result with `_meta.ui.resourceUri: ui://viewer` and `initialData.studyUid`.

Host mounts the iframe. OHIF boots, reads `initialData`, configures `dataSources.wadoRoot` to `/dicomweb/orthanc-demo`, issues `GET /dicomweb/orthanc-demo/studies/1.2.840.../metadata`. The MCP server's proxy forwards to Orthanc's DICOMweb plugin and streams the response back with CORS headers.

User:

> Switch to the lung window

Claude calls:

```json
{
  "tool": "set_view",
  "args": { "preset": "lung" }
}
```

Server posts `SET_VIEW { windowCenter: -600, windowWidth: 1500 }` through the host to the widget. OHIF applies. `STATE_UPDATE` flows back. `describe_current_view` is now current.

User:

> What's the slice thickness?

Claude calls `describe_current_view`, sees `slice_thickness_mm: 0.625`, replies directly without further tool calls.

## Implementation notes for the builder

- Use `@modelcontextprotocol/sdk` + `@modelcontextprotocol/ext-apps` (TypeScript). Stream HTTP transport.
- Host the MCP server on Fly.io or Cloudflare Workers. No persistence layer needed for v1 - state is per-session in memory.
- DICOMweb proxy: Node `http-proxy` or raw `fetch` passthrough. Strip any inbound `Authorization` header in v1 (defense against user pasting an authenticated URL by accident).
- OHIF: bundle the static build, serve from same origin as the MCP server to simplify CSP. Declare only that origin in `_meta.ui.csp.resourceDomains` and `connectDomains`.
- Tests: URL parser gets unit tests for each of the four shapes plus edge cases (trailing slashes, fragment vs. path, query params). CORS proxy gets an integration test against the Orthanc demo server.
