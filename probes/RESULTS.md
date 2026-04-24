---
title: Day 0 Probe Results
date: 2026-04-24
status: partial
---

# Day 0 Probe Results

Plan §U1 defines three probes that gate the MVP build. Probe A and Probe C are must-pass. Probe B is informational.

## Probe C - OHIF against Orthanc demo DICOMweb endpoint (PASS)

**Date:** 2026-04-24
**Status:** PASS

**What we tested:**
- QIDO-RS `/studies` listing
- QIDO-RS `/studies/{uid}/series`
- Response content type and CORS behavior
- Availability of test corpus

**Findings:**

1. **Orthanc demo DICOMweb endpoint is operational and DICOMweb-compliant.**
   - Actual URL: `https://orthanc.uclouvain.be/demo/dicom-web/`
   - The old URL in the feasibility study (`https://demo.orthanc-server.com/dicom-web/`) 301-redirects to this canonical location.
   - Returns `application/dicom+json` with proper DICOM tag structure.
   - 8 studies available covering CT, MR, PET/CT, and RTDOSE/RTSTRUCT modalities.
   - **Action:** use `https://orthanc.uclouvain.be/demo/dicom-web/` as the `orthanc-demo` server base URL in `src/config.ts`.

2. **CORS headers are NOT set by the upstream.**
   - `GET` with `Origin: https://claude.ai` returns 200 but no `Access-Control-Allow-Origin` header.
   - `OPTIONS` preflight returns 404 (nginx in front doesn't handle it).
   - **Confirms:** our MCP server must proxy DICOMweb requests and add CORS headers. Direct iframe fetches would be blocked by the browser. This was the design assumption; now verified.

3. **Available corpus (for curated list in U6):**

   | Modality | StudyInstanceUID | Date | Series | Instances |
   |---|---|---|---|---|
   | CT | `2.16.840.1.113669.632.20.1211.10000315526` | 20061005 | 1 | 250 |
   | CT/RTDOSE/RTSTRUCT | `1.3.6.1.4.1.14519.5.2.1.2193.7172.847236098565581057121195872945` | 20091022 | 3 | 200 |
   | MR | `2.16.840.1.113669.632.20.1211.10000357775` | 20061201 | 7 | 232 |
   | CT | `2.16.840.1.113669.632.20.1211.10000098591` | 20050927 | 3 | 723 |
   | CT/PT | `1.2.840.113745.101000.1008000.38179.6792.6324567` | 20040721 | 3 | 680 |
   | CT/PT | `1.2.840.113745.101000.1008000.38048.4626.5933732` | 20040304 | 2 | 166 |
   | MR | `1.2.840.113619.2.176.2025.1499492.7391.1171285944.390` | 20070101 | 6 | 135 |
   | CT | `2.16.840.1.113669.632.20.1211.10000231621` | 20060531 | 1 | 166 |

   No mammography, ultrasound, or plain film in this corpus. Plan's original 5-modality target (CT/MR/CR/MG/US) adjusted to what's actually available: CT/MR/PET/CT/RTDOSE.

---

## Probe A - threejs-server MCP App in Claude.ai (HANDOFF TO FRED)

**Date:** pending
**Status:** blocked - requires Fred's Claude.ai account

**What to test:**
Verify that an MCP App with a WebGL iframe widget renders successfully in Claude.ai. This proves our sandbox assumptions before we commit to OHIF.

**Steps for Fred (estimated 10 minutes):**

```bash
# 1. In a separate terminal, clone the ext-apps repo
cd /tmp
git clone https://github.com/modelcontextprotocol/ext-apps.git
cd ext-apps/examples/threejs-server

# 2. Install and run locally
npm install
npm run dev    # should start on a local port, likely 3000 or similar

# 3. In another terminal, expose via ngrok
ngrok http 3000    # note the https URL it generates

# 4. In Claude.ai, open Settings -> Apps / Connectors
# Add the ngrok HTTPS URL as a custom MCP server
# Install it when prompted

# 5. In a Claude.ai chat, invoke it (try something like "render a 3D scene")
# Verify: a WebGL canvas renders inline in chat.
```

**PASS criteria:** the Three.js scene renders inline in the Claude.ai chat UI and responds to mouse interaction (drag to rotate).

**FAIL criteria:** widget doesn't render, or shows a blank frame, or Claude.ai doesn't support installing custom MCP Apps on the plan tier.

Record outcome here with date, screenshot path, and any error messages.

**If FAIL:** major finding - the entire approach is at risk. We'd need to escalate with Anthropic or pivot to Claude Desktop only.

---

## Probe B - threejs-server in Claude Cowork (HANDOFF TO FRED)

**Date:** pending
**Status:** blocked - requires Fred's Claude Cowork account. Informational only.

**What to test:**
Whether MCP Apps work in Claude Cowork. The official `modelcontextprotocol.io/extensions/apps/overview` page does NOT list Cowork among supported clients; a third-party guide claimed it does. This probe settles it.

**Steps for Fred (estimated 5 minutes after Probe A is running):**

Using the same ngrok URL from Probe A:
1. Open Claude Cowork
2. Attempt to install the MCP App via the same "custom MCP server" flow (if available)
3. If installable, invoke it and see if the widget renders

**PASS criteria:** widget renders in Cowork the same way it does in Claude.ai.

**FAIL criteria:** either Cowork doesn't support custom MCP Apps at all, or the widget fails to render.

**If FAIL:** no code change needed. Positioning shifts to "install in Claude.ai / Claude Desktop" for the demo. The MVP itself is unaffected.

Record outcome here.
