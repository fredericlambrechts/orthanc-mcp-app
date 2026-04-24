#!/usr/bin/env bash
# Build an OHIF v3 static bundle configured for this MCP server and drop it
# into ./ohif-dist/ so that `fly deploy` (or a local run) serves a real DICOM
# viewer at /ohif/*.
#
# Usage:
#   scripts/ohif/build-ohif-dist.sh            # builds v3.12.0 (pinned)
#   OHIF_VERSION=v3.13.0-beta.6 scripts/ohif/build-ohif-dist.sh
#
# Prereqs: node >= 18, yarn >= 1.20, git, ~1 GB free disk for the clone.
# Runtime: ~60-90s for build after yarn install (first-time install is slow).
#
# Source maps are stripped from the output to keep ohif-dist/ closer to 125 MB
# instead of ~210 MB.
set -euo pipefail

VERSION="${OHIF_VERSION:-v3.12.0}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUILD_DIR="$(mktemp -d -t ohif-build-XXXXXX)"
DEST="$REPO_ROOT/ohif-dist"
CONFIG="$REPO_ROOT/scripts/ohif/orthanc-mcp-app.config.js"

echo "==> Cloning OHIF $VERSION into $BUILD_DIR"
git clone --depth 1 --branch "$VERSION" https://github.com/OHIF/Viewers.git "$BUILD_DIR"

echo "==> Installing dependencies (this can take several minutes)"
cd "$BUILD_DIR"
yarn install --frozen-lockfile --network-timeout 300000

echo "==> Dropping orthanc-mcp-app config into OHIF app"
cp "$CONFIG" "$BUILD_DIR/platform/app/public/config/orthanc-mcp-app.js"

echo "==> Building"
APP_CONFIG=config/orthanc-mcp-app.js PUBLIC_URL=/ohif/ yarn build

echo "==> Copying dist to $DEST (stripping source maps)"
rm -rf "$DEST"
mkdir -p "$DEST"
rsync -a --exclude='*.map' "$BUILD_DIR/platform/app/dist/" "$DEST/"

echo "==> Cleaning up $BUILD_DIR"
rm -rf "$BUILD_DIR"

du -sh "$DEST"
echo "==> Done. ohif-dist/ is ready. Run 'fly deploy' to push it."
