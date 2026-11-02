#!/usr/bin/env bash
set -euo pipefail

# Build the extension and copy the unpacked Chrome/Brave build to a stable
# folder. Load that folder once in brave://extensions; after rebuilds, copy it
# again and click Reload on the extension card.
#
# Usage: ./scripts/prepare-brave.sh [target-folder]
# Default: $HOME/DeckCart

cd "$(dirname "$0")/.."
target="${1:-$HOME/DeckCart}"

npm run zip
mkdir -p "$target"
cp -a .output/chrome-mv3/. "$target"/

cat <<EOF
DeckCart unpacked build is ready at:
  $target

Open Brave and go to:
  brave://extensions

Turn on Developer mode, click Load unpacked, and select that folder.
After a rebuild, run this script again and click Reload on the DeckCart card.
EOF
