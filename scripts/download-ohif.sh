#!/usr/bin/env bash
# Download a prebuilt OHIF v3 distribution into ohif-dist/.
#
# The Orthanc MCP app self-hosts OHIF (Path A from plan.md) to avoid a
# third-party CDN dependency. This script fetches the prebuilt bundle and
# stages it at ./ohif-dist/ so the Dockerfile can copy it into the image.
#
# OHIF v3 is a React/Webpack monorepo. Building it from source inside our
# Dockerfile would add ~5-10 minutes and ~3 GB to each build. Instead we
# fetch a prebuilt archive from a known, pinned release.
#
# Options for the OHIF source (choose ONE, edit below):
#   1. OHIF's own GitHub Releases - not currently published as static tarballs
#   2. A mirror you maintain (e.g. a tagged release in a sibling repo)
#   3. Build OHIF once locally with `yarn build` and commit the output
#
# For the first deploy, this script is left as a stub. Replace the TODO
# section below with the real download before Fred's first `fly deploy`.

set -euo pipefail

DEST="$(cd "$(dirname "$0")/.." && pwd)/ohif-dist"
mkdir -p "$DEST"

if [ -f "$DEST/index.html" ]; then
  echo "ohif-dist/ already populated; nothing to do"
  exit 0
fi

echo "[download-ohif] ohif-dist/ is empty"
echo ""
echo "  This script is a placeholder. Options for populating ohif-dist/:"
echo ""
echo "  Option A: Use the OHIF v3 demo viewer on their CDN temporarily"
echo "            Edit src/tools/open_study.ts:"
echo "              ohifBasePath: 'https://viewer.ohif.org/viewer'"
echo "            Then update src/ui/resource.ts to add the OHIF origin"
echo "            to _meta.ui.csp.frameDomains."
echo ""
echo "  Option B: Build OHIF from source"
echo "            git clone https://github.com/OHIF/Viewers.git /tmp/ohif"
echo "            cd /tmp/ohif && yarn install && yarn build"
echo "            cp -r /tmp/ohif/platform/app/dist/* $DEST/"
echo ""
echo "  Option C: Download a pre-built bundle you host yourself"
echo "            curl -L <your-url> | tar -xz -C $DEST"
echo ""
echo "  Until ohif-dist/index.html exists, /ohif/viewer serves a placeholder"
echo "  that echoes query params. The app still works end-to-end for"
echo "  demonstrating MCP + DICOMweb - just without OHIF pixel rendering."
echo ""

# Exit 0 so this does not fail `docker build`.
exit 0
