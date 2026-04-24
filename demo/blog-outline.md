---
title: Blog post outline - DICOM in Claude
audience: medtech operators, imaging AI product people, radiology IT
goal: credibility + distribution for SuperSwift, attributed to Fred
length_target: 800-1200 words
---

# Blog post outline

Working title: **"A DICOM viewer that lives inside the chat"**

Alt: **"What agent-native medical imaging looks like"**

## Hook (100 words)

- Lead with the demo: a Claude chat where you paste a study link and the
  OHIF viewer renders inline. Not a link out. Not a screenshot. A real
  viewer, inside the conversation, driven by chat.
- "If you've spent time in medical imaging, you know the feeling of the
  viewer being a separate universe from everything else. That's the thing
  this fixes."

## Why this matters (200 words)

- Medtech teams have struggled to bring radiology into modern SaaS-era
  tooling. Viewers are heavy, DICOM is finicky, clinical-grade UX is a wall.
- Agents change the question: what if the viewer is just another tool the
  agent can summon?
- MCP Apps (January 2026 spec) makes this concrete. Tools can ship
  interactive UIs that render inline in chat. Autodesk did it for 3D CAD.
  Nobody had done it for medical imaging yet.
- What it unlocks for medtech GTM teams:
  - Sales demos without screen-sharing gymnastics
  - Product walkthroughs where the AI narrates the finding
  - Triage workflows where the LLM pulls prior imaging alongside the text
  - Teaching: a DICOM viewer is a click away in any tutoring conversation

## What I built (300 words)

- One-week MVP. MIT licensed. Public repo: github.com/fredericlambrechts/orthanc-mcp-app.
- Architecture sketch (drop the mermaid diagram from README):
  - Claude.ai or Claude Desktop talks to our MCP server on Fly.io
  - Server ships an interactive widget as `ui://viewer`
  - Widget embeds OHIF in an iframe
  - DICOMweb traffic is proxied by the server (CORS is otherwise a dealbreaker)
  - State flows back to the server via postMessage + an internal tool so
    Claude can answer "what am I looking at?"
- Six MCP tools, covering: list servers, list curated datasets, QIDO search,
  open a study, describe the current view, set view (series/slice/window).
- Self-contained deployment: OHIF self-hosted, no third-party CDN, one
  Fly.io box. Total spend: ~$0 for a demo.
- Works with the Orthanc public demo server by default. Accepts any
  DICOMweb-compliant URL via paste-a-link.

## The Osimis / Orthanc angle (200 words)

- Brief personal note: I co-founded Osimis, the company behind the Orthanc
  open-source DICOM server. Spent 8 years shipping medical imaging tools.
- Coming back to this with an agent lens changes what feels possible.
  Things that used to need a PACS vendor relationship, a BAA, six months
  of integration: now they're 250 lines of TypeScript.
- Not everything scales that way - compliance, real diagnostic use, deep
  integrations with clinical systems all still need the old craft. But
  the *demo surface* just collapsed by an order of magnitude.

## What's next (150 words)

- Not a medical device. Not CE-marked. Demo, education, non-diagnostic use
  only. Say this twice.
- Things I'm watching:
  - Claude Cowork MCP Apps support (unverified at time of writing)
  - WebGL memory ceiling for very large volumes inside the sandbox iframe
  - Authenticated PACS support - separate release with compliance review
- What I'd love to see: someone from the radiology AI side picking this up
  as a demo harness for their models. Drop in an AI-generated overlay,
  let Claude narrate the finding, see what that workflow feels like.
- Contact: github.com/fredericlambrechts (open to contributions), fred@beswift.ai.

## Closing (50 words)

- "The viewer living inside the chat is a small thing. The pattern it
  unlocks - every specialized tool in medtech becoming a surface the agent
  can summon - is the interesting thing."
- One-line CTA back to the repo.

## SEO / social

- Twitter/LinkedIn hook: screenshot of the viewer inline in Claude chat,
  caption: "DICOM in Claude. Paste a link, see the study. No screenshots,
  no screen-share. Non-diagnostic demo. Repo in replies."
- Hashtags: #medtech #radiology #DICOM #MCP #AgentNative
- Cross-post: LinkedIn (primary), Hacker News (Show HN), /r/medicalimaging,
  AuntMinnie community, RSNA informatics groups

## Not to include

- No claim that this is a medical device or ready for diagnosis.
- No comparison to commercial PACS vendors (stay positive, avoid
  picking fights).
- No deep MCP internals - save those for a follow-up technical post if
  the demo post lands.
