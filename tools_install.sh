#!/bin/bash
# Build a self-contained DroneRadar.app and install it to /Applications.
#
# The development bundle is only a launcher that reaches out to the sibling
# droneradar/ folder; that cannot work once the app is moved elsewhere. This
# copies the code inside Contents/Resources so the bundle stands alone, and
# points its data at ~/Library/Application Support/DroneRadar because an app in
# /Applications should not be writing inside itself.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD="$SRC/build/DroneRadar.app"
SUPPORT="$HOME/Library/Application Support/DroneRadar"

echo "==> ビルド中"
# Only this script's own staging folder. Clearing the whole of build/ took the
# distribution zip with it every time the app was reinstalled.
rm -rf "$BUILD"
mkdir -p "$BUILD/Contents/MacOS" "$BUILD/Contents/Resources"

# The template lives in assets/, not in a .app: a second bundle on disk is a
# second DroneRadar in Spotlight and the Launchpad, and it holds no code.
cp "$SRC/assets/Info.plist" "$BUILD/Contents/Info.plist"
cp "$SRC/assets/AppIcon.icns" "$BUILD/Contents/Resources/"
cp -R "$SRC/droneradar" "$BUILD/Contents/Resources/droneradar"
find "$BUILD/Contents/Resources/droneradar" -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null || true

# One launcher, kept in assets/ and copied into both builds. It used to be
# inlined in each script, which meant every change had to be made twice.
cp "$SRC/assets/launcher.sh" "$BUILD/Contents/MacOS/DroneRadar"
chmod +x "$BUILD/Contents/MacOS/DroneRadar"

# Carry the collected articles and caches over on a first install.
if [ ! -f "$SUPPORT/items.json" ] && [ -f "$SRC/data/items.json" ]; then
  echo "==> 既存のデータを引き継ぎます"
  mkdir -p "$SUPPORT"
  cp -R "$SRC/data/." "$SUPPORT/" 2>/dev/null || true
fi

TARGET="/Applications/DroneRadar.app"
if [ ! -w /Applications ]; then
  TARGET="$HOME/Applications/DroneRadar.app"
  mkdir -p "$HOME/Applications"
  echo "==> /Applications に書き込めないため $HOME/Applications に入れます"
fi

rm -rf "$TARGET"
cp -R "$BUILD" "$TARGET"
# Drop the quarantine flag so Gatekeeper does not block a locally built app.
xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null || true
touch "$TARGET"

# Leave nothing behind that Spotlight will index as a second DroneRadar.
rm -rf "$SRC/build/DroneRadar.app"

echo "==> 完了: $TARGET"
echo "    データ: $SUPPORT"
echo "    コードを変更したら、このスクリプトを実行し直してください。"
