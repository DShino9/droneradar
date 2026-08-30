#!/bin/bash
# Build the Windows distribution: the app plus a Python to run it with.
#
# Windows has no Python, so one travels with the app — the official embeddable
# build, which is a folder of files rather than an installer and can therefore
# be assembled from here. Nothing is compiled, so this runs on macOS; what it
# cannot do is test the result, and it has never been run on Windows.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYVER="3.12.7"
PYZIP="python-$PYVER-embed-amd64.zip"
CACHE="$SRC/build/cache"
STAMP="$(date +%Y%m%d)"
STAGE="$SRC/build/DroneRadar-win-$STAMP"
ZIP="$SRC/build/DroneRadar-win-$STAMP.zip"

echo "==> 埋め込み版 Python $PYVER を用意"
mkdir -p "$CACHE"
if [ ! -f "$CACHE/$PYZIP" ]; then
  curl -sSL -o "$CACHE/$PYZIP" \
    "https://www.python.org/ftp/python/$PYVER/$PYZIP"
fi

echo "==> 構成中"
rm -rf "$STAGE" "$ZIP"
mkdir -p "$STAGE/python"
unzip -q "$CACHE/$PYZIP" -d "$STAGE/python"

# The embeddable build locks sys.path down to the stdlib zip and its own
# folder. The app sits one level up, so that has to be added or the import
# fails with nothing on screen to say why.
PTH="$STAGE/python/python${PYVER%.*}"
PTH="${PTH//./}._pth"
PTH="$STAGE/python/$(basename "$PTH")"
if [ ! -f "$PTH" ]; then
  PTH="$(find "$STAGE/python" -name '*._pth' | head -1)"
fi
printf '..\n' >> "$PTH"
echo "    sys.path に .. を追加: $(basename "$PTH")"

cp -R "$SRC/droneradar" "$STAGE/droneradar"
find "$STAGE/droneradar" -name '__pycache__' -type d -exec rm -rf {} + 2>/dev/null || true
find "$STAGE" -name '.DS_Store' -delete 2>/dev/null || true
cp "$SRC/assets/AppIcon.ico" "$STAGE/AppIcon.ico"

# The batch file does the work; the .vbs exists only to run it without a
# console window flashing up.
cat > "$STAGE/DroneRadar.bat" <<'BAT'
@echo off
setlocal
set "ROOT=%~dp0"
set "PORT=8783"
set "URL=http://127.0.0.1:%PORT%/"
rem The server opens a browser itself if allowed, which would put a plain tab
rem behind the app window.
set "DRONERADAR_NO_BROWSER=1"

rem Already running? Just open a window against it.
curl -s -m 2 -o nul "%URL%api/status" 2>nul && goto :open

start "" /B "%ROOT%python\pythonw.exe" -m droneradar.server

rem Wait for the port rather than sleeping a fixed amount.
for /L %%i in (1,1,60) do (
  curl -s -m 1 -o nul "%URL%api/status" 2>nul && goto :open
  ping -n 2 127.0.0.1 >nul
)
echo サーバを起動できませんでした。
echo ログ: %%APPDATA%%\DroneRadar\droneradar.log
pause
exit /b 1

:open
rem A Chromium browser in --app mode: no tabs, no address bar. Edge is on every
rem Windows 10 and 11, so this path is reliable even with nothing else present.
set "APPARGS=--app=%URL% --start-maximized --user-data-dir=%APPDATA%\DroneRadar\window --no-first-run --no-default-browser-check"
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" %APPARGS%
) else if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
  start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" %APPARGS%
) else if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
  start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" %APPARGS%
) else if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
  start "" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" %APPARGS%
) else (
  start "" "%URL%"
)
exit /b 0
BAT

cat > "$STAGE/DroneRadar.vbs" <<'VBS'
' Runs DroneRadar.bat with its console hidden. Double-click this, not the .bat,
' unless something has gone wrong and you want to see the messages.
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = CreateObject("Scripting.FileSystemObject") _
  .GetParentFolderName(WScript.ScriptFullName)
sh.Run """" & sh.CurrentDirectory & "\DroneRadar.bat""", 0, False
VBS

cat > "$STAGE/はじめにお読みください.txt" <<'NOTE'
DroneRadar (Windows 版) — ドローン関連情報のダッシュボード

■ 動作確認について
  この Windows 版は macOS 上で組み立てたもので、Windows での動作確認が
  取れていません。うまく動かない場合は DroneRadar.bat を直接ダブル
  クリックしてください。黒い画面にエラーが表示されます。

■ 使い方
  1. このフォルダを好きな場所に置いてください（Program Files 以外を推奨）。
  2. DroneRadar.vbs をダブルクリックすると起動します。
  3. ショートカットを作り、プロパティの「アイコンの変更」で同梱の
     AppIcon.ico を指定すると、デスクトップから起動できます。

■ 必要なもの
  Windows 10 / 11（64bit）だけです。Python のインストールは不要で、
  python フォルダに実行に必要なものが入っています。

■ 起動すると
  タブもアドレスバーもないウィンドウが最大化で開きます。
  初回は記事の収集に 1〜2 分かかります。以後 15 分ごとに自動更新されます。
  Chrome も Edge も無い場合は通常のブラウザのタブで開きます。

■ データの保存先
  %APPDATA%\DroneRadar
  （収集した記事、翻訳キャッシュ、ログ）
  削除するときはこのフォルダも一緒に消してください。

■ 終了
  ウィンドウを閉じても収集は続きます。完全に止めるには、タスク
  マネージャーで pythonw.exe を終了してください。

■ ファイアウォール
  初回起動時に Windows Defender の確認が出ることがあります。
  127.0.0.1（自分のPCの中）だけで通信するので、許可して問題ありません。
NOTE

# Windows line endings, and a BOM on the note. A .bat written with bare LF
# breaks on the goto labels and the bracketed blocks — cmd.exe reads the label
# and the following line as one — and Notepad has been known to render a
# UTF-8 Japanese file as mojibake without the mark.
echo "==> 改行コードを CRLF に"
for f in "$STAGE/DroneRadar.bat" "$STAGE/DroneRadar.vbs" "$STAGE/はじめにお読みください.txt"; do
  /usr/bin/python3 - "$f" <<'CONV'
import sys, pathlib
p = pathlib.Path(sys.argv[1])
data = p.read_bytes().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n")
if p.suffix == ".txt" and not data.startswith(b"\xef\xbb\xbf"):
    data = b"\xef\xbb\xbf" + data
p.write_bytes(data)
CONV
done

# The exported tables are what the mobile build reads. A stale export is a
# silent divergence between the two implementations, so fail the build.
/usr/bin/python3 "$SRC/tools_export_tables.py" --check >/dev/null || {
  echo "データ表が古い。tools_export_tables.py を実行してください" >&2; exit 1;
}

echo "==> 圧縮"
# Python's zipfile rather than the zip command: zip stores a non-ASCII name
# without setting the UTF-8 flag, and Windows Explorer then shows the Japanese
# filename as mojibake.
/usr/bin/python3 - "$STAGE" "$ZIP" <<'ZIPPY'
import os, sys, zipfile
stage, out = sys.argv[1], sys.argv[2]
root = os.path.dirname(stage)
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for base, _dirs, files in os.walk(stage):
        for f in sorted(files):
            full = os.path.join(base, f)
            z.write(full, os.path.relpath(full, root))
ZIPPY
rm -rf "$STAGE"

echo "==> 完了: $ZIP ($(du -h "$ZIP" | cut -f1))"
shasum -a 256 "$ZIP"
