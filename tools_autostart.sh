#!/bin/bash
# Keep DroneRadar running so any browser at home can open it.
#
# A LaunchAgent rather than a login item: launchd starts it at login, restarts
# it if it dies, and does so without a window or a Dock icon. The .app still
# works — it notices the server is already up and just opens the window.
#
#   ./tools_autostart.sh on    常時起動する（家庭内LANに公開）
#   ./tools_autostart.sh off   やめる
#   ./tools_autostart.sh       状態を見る
set -euo pipefail

LABEL="local.droneradar"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
APP="/Applications/DroneRadar.app"
PORT="${DRONERADAR_PORT:-8783}"

status() {
  local ip; ip=$(ipconfig getifaddr en0 2>/dev/null || echo "")
  if launchctl list 2>/dev/null | grep -q "$LABEL"; then
    echo "常時起動: 有効"
  else
    echo "常時起動: 無効"
  fi
  if /usr/bin/curl -sS -m 2 -o /dev/null "http://127.0.0.1:$PORT/api/status" 2>/dev/null; then
    echo "サーバ  : 動作中"
    [ -n "$ip" ] && echo "URL     : http://$ip:$PORT/"
  else
    echo "サーバ  : 停止"
  fi
}

case "${1:-status}" in
  on)
    [ -d "$APP" ] || { echo "先に ./tools_install.sh を実行してください" >&2; exit 1; }
    mkdir -p "$HOME/Library/LaunchAgents"
    cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/python3</string>
    <string>-m</string>
    <string>droneradar.server</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$APP/Contents/Resources</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>DRONERADAR_HOST</key><string>0.0.0.0</string>
    <key>DRONERADAR_NO_BROWSER</key><string>1</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key>
  <string>$HOME/Library/Application Support/DroneRadar/droneradar.log</string>
  <key>StandardErrorPath</key>
  <string>$HOME/Library/Application Support/DroneRadar/droneradar.log</string>
</dict>
</plist>
PLISTEOF
    pkill -f droneradar.server 2>/dev/null || true
    sleep 1
    launchctl unload "$PLIST" 2>/dev/null || true
    launchctl load "$PLIST"
    sleep 6
    echo
    status
    echo
    echo "閲覧は家庭内のどの端末からでも。設定変更はこのMac上からのみ受け付けます。"
    ;;
  off)
    launchctl unload "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    pkill -f droneradar.server 2>/dev/null || true
    echo "常時起動を解除しました。"
    ;;
  *)
    status
    ;;
esac
