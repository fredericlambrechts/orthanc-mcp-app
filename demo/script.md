---
title: 60-second demo script
audience: medtech founders, radiology product people, PACS vendors
tone: founder-operator demonstrating a technical capability, not selling
---

# 60-second Loom script

## Setup (not recorded)

- Claude.ai open in a browser, fresh chat
- `orthanc-mcp-app` installed as an MCP App connector
- Screen at 16:9, readable font

## Script

**0:00 - 0:10 - cold open**

> "This is Claude talking to a medical imaging viewer."

*Show empty chat. Cursor in input box.*

**0:10 - 0:25 - paste a link**

*Paste this into the chat:*

```
Open this: https://orthanc.uclouvain.be/demo/ui/app/#/studies/4d52b9c7-ff3aa9c0-e9ffef79-5ef2ec49-7a72eefc
```

*Press enter. The OHIF viewer mounts inline in the chat within ~5 seconds. CT chest study renders.*

> "The viewer runs inside the chat. It's a real MCP App - the server at
> orthanc-mcp-app.fly.dev parsed the Orthanc URL, resolved the study,
> and told Claude to render the OHIF viewer right here."

**0:25 - 0:40 - drive it with chat**

*Type:*

```
Switch to the lung window.
```

*Viewer updates. Hounsfield range changes.*

```
Scroll to the middle slice.
```

*Viewer jumps.*

> "Claude isn't just rendering the image - it can drive the viewer. Window
> presets, series navigation, slice position. All through natural language."

**0:40 - 0:50 - read back**

*Type:*

```
What modality am I looking at, and how many slices?
```

*Claude reads the live viewer state via `describe_current_view` and replies.*

> "And because the viewer reports its state back to the server in real time,
> Claude can answer questions about what's on screen."

**0:50 - 1:00 - close**

> "This is a demo. Not a medical device. No FDA clearance, no CE mark.
> The goal was to show what agent-native medical imaging can look like -
> built on MCP Apps, OHIF, and the Orthanc public demo server.
> Source is MIT on GitHub."

*Cut to logo / URL card: github.com/fredericlambrechts/orthanc-mcp-app*

## Post-production notes

- Add a non-diagnostic disclaimer banner at the bottom throughout
- Add a subtle "Built by Frederic Lambrechts - ex-founder, Osimis" lower-third in the last 5 seconds
- No background music - let the viewer + chat speak for itself

## Backup scenarios if the live demo breaks

1. **Orthanc demo server is down**: fall back to `list_public_datasets` approach - Claude picks a study from our curated list. Same flow, no link paste.
2. **OHIF pixel rendering fails**: the placeholder still echoes query params - narrate "here's the URL routing, imagine OHIF in its place."
3. **Claude is slow**: cut and re-record the tool-call segments.
