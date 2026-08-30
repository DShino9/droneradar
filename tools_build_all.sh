#!/bin/bash
# Build every platform from one command, and print the sizes.
#
# macOS and Windows ship the Python collector; Android and iOS ship the
# JavaScript one. Both read the same UI and the same data tables, so the only
# thing that differs between them is which engine is in the box.
set -euo pipefail
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAMP="$(date +%Y%m%d)"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"

echo "==> データ表を書き出し"
/usr/bin/python3 "$SRC/tools_export_tables.py" >/dev/null

echo "==> macOS"
"$SRC/tools_package.sh" >/dev/null

echo "==> Windows"
"$SRC/tools_package_win.sh" >/dev/null

echo "==> 共通部品を www/ へ"
"$SRC/mobile/tools_sync.sh" >/dev/null

echo "==> Android"
(cd "$SRC/mobile" && npx cap sync android >/dev/null 2>&1)
(cd "$SRC/mobile/android" && ./gradlew assembleRelease -q >/dev/null 2>&1)
BT="$ANDROID_HOME/build-tools/35.0.0"
"$BT/zipalign" -f 4 \
  "$SRC/mobile/android/app/build/outputs/apk/release/app-release-unsigned.apk" \
  /tmp/dr-aligned.apk
"$BT/apksigner" sign --ks "$SRC/mobile/keys/droneradar.jks" \
  --ks-pass pass:droneradar --key-pass pass:droneradar \
  --out "$SRC/build/DroneRadar-android-$STAMP.apk" /tmp/dr-aligned.apk

echo "==> iOS"
(cd "$SRC/mobile" && npx cap sync ios >/dev/null 2>&1)
DD=$(mktemp -d)
(cd "$SRC/mobile/ios/App" && xcodebuild -scheme App -configuration Release \
   -sdk iphoneos -derivedDataPath "$DD" CODE_SIGNING_ALLOWED=NO build >/dev/null 2>&1)
rm -rf /tmp/dr-payload && mkdir -p /tmp/dr-payload/Payload
cp -R "$DD/Build/Products/Release-iphoneos/App.app" /tmp/dr-payload/Payload/DroneRadar.app
(cd /tmp/dr-payload && zip -qr "$SRC/build/DroneRadar-ios-$STAMP-unsigned.ipa" Payload)
rm -rf "$DD"

echo
printf "%-30s %10s\n" "配布物" "サイズ"
printf "%-30s %10s\n" "------------------------------" "----------"
for f in "$SRC/build"/*-"$STAMP"*; do
  case "$f" in *.idsig) continue;; esac
  printf "%-30s %9.2f MB\n" "$(basename "$f")" "$(stat -f%z "$f" | awk '{print $1/1048576}')"
done
