#!/bin/bash
# Build a zip of DroneRadar.app that can be handed to someone else.
#
# Distinct from tools_install.sh, which installs to this Mac: this makes a
# clean, empty-of-data copy, writes the recipient a note about Gatekeeper —
# the app is unsigned, so it will be blocked on first launch unless they know
# the trick — and packs it with ditto so the bundle survives the round trip.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAMP="$(date +%Y%m%d)"
STAGE="$SRC/build/DroneRadar-$STAMP"
APP="$STAGE/DroneRadar.app"
ZIP="$SRC/build/DroneRadar-$STAMP.zip"

echo "==> 配布用バンドルを作成"
rm -rf "$STAGE" "$ZIP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# The template lives in assets/, not in a .app: a second bundle on disk is a
# second DroneRadar in Spotlight and the Launchpad, and it holds no code.
cp "$SRC/assets/Info.plist" "$APP/Contents/Info.plist"
cp "$SRC/assets/AppIcon.icns" "$APP/Contents/Resources/"
cp -R "$SRC/droneradar" "$APP/Contents/Resources/droneradar"

# Nothing from this machine travels with the app: no caches, no collected
# articles, no bookmarks.
find "$APP" -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null || true
find "$APP" -name '.DS_Store' -delete 2>/dev/null || true
rm -rf "$APP/Contents/Resources/droneradar/data" 2>/dev/null || true

# One launcher, kept in assets/ and copied into both builds. It used to be
# inlined in each script, which meant every change had to be made twice.
cp "$SRC/assets/launcher.sh" "$APP/Contents/MacOS/DroneRadar"
chmod +x "$APP/Contents/MacOS/DroneRadar"

# An ad-hoc signature does not get past Gatekeeper — only a Developer ID and
# notarisation do that — but it does stop macOS treating the bundle as damaged
# after it has been unpacked from a zip.
codesign --force --deep --sign - "$APP" >/dev/null 2>&1 \
  && echo "==> アドホック署名 済み" \
  || echo "==> アドホック署名 できず（配布は可能）"

cat > "$STAGE/はじめにお読みください.txt" <<'NOTE'
DroneRadar — ドローン関連情報のダッシュボード

■ インストール
  DroneRadar.app を「アプリケーション」フォルダにドラッグしてください。

■ 初回起動（重要）
  このアプリは Apple の開発者署名を付けていないため、そのままダブルクリック
  すると「開発元を確認できないため開けません」と表示されます。

  初回だけ、次のどちらかで起動してください。

    ・アイコンを右クリック →「開く」→ ダイアログの「開く」を押す
    ・またはターミナルで
        xattr -dr com.apple.quarantine /Applications/DroneRadar.app

  2回目以降は普通にダブルクリックで起動します。

■ 必要なもの
  macOS 12 以降と、macOS 標準の python3 です。
  未導入の場合は起動時に案内が出るので、ターミナルで
      xcode-select --install
  を実行してください。それ以外に入れるものはありません。

■ 起動すると
  ブラウザで http://127.0.0.1:8783/ が開きます。初回は記事の収集に
  1〜2分かかります。以後15分ごとに自動で更新されます。

■ データの保存先
  ~/Library/Application Support/DroneRadar
  （収集した記事、翻訳キャッシュ、ログ）
  アプリを捨てるときは、このフォルダも一緒に削除してください。

■ 終了
  ブラウザを閉じても収集は続きます。完全に止めるには
      pkill -f droneradar.server
NOTE

# The exported tables are what the mobile build reads. A stale export is a
# silent divergence between the two implementations, so fail the build.
/usr/bin/python3 "$SRC/tools_export_tables.py" --check >/dev/null || {
  echo "データ表が古い。tools_export_tables.py を実行してください" >&2; exit 1;
}

echo "==> 圧縮"
# ditto, not zip: it keeps the bundle's structure and extended attributes.
# Zip the stage folder itself, so unpacking gives one tidy folder rather
# than loose files in whatever directory the recipient double-clicked in.
(cd "$(dirname "$STAGE")" && ditto -c -k --sequesterRsrc --keepParent "$(basename "$STAGE")" "$ZIP")

# The staging copy has served its purpose; keeping it would leave a second
# DroneRadar on disk for Spotlight and the Launchpad to find.
rm -rf "$STAGE"

SIZE=$(du -h "$ZIP" | cut -f1)
echo "==> 完了: $ZIP ($SIZE)"
shasum -a 256 "$ZIP"
