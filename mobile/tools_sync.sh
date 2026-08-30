#!/bin/bash
# Assemble www/ from the shared parts. Nothing here is authored: the UI and the
# collector live one level up and are used verbatim, which is the whole point
# of the split.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$HERE")"

rm -rf "$HERE/www"
mkdir -p "$HERE/www"
cp -R "$ROOT/droneradar/web/." "$HERE/www/"
cp -R "$ROOT/core" "$HERE/www/core"
cp -R "$ROOT/droneradar/tables" "$HERE/www/tables"
find "$HERE/www" -name '.DS_Store' -delete 2>/dev/null || true

echo "www/ を組み立てました: $(du -sh "$HERE/www" | cut -f1)"
