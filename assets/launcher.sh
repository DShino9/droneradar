#!/bin/bash
# DroneRadar launcher. Starts the local server if it is not already up, then
# opens the dashboard in a window of its own.
#
# "A window of its own" means a Chromium browser in --app mode: no tabs, no
# address bar, no bookmarks bar, and its own entry in the window list. A real
# native window would need a WKWebView, and that needs PyObjC, which macOS no
# longer ships with python3 — installing it would break the one rule this app
# has, that it runs on a stock Mac with nothing added.
#
# Without a Chromium browser the dashboard still works; it just opens as an
# ordinary tab in the default browser.
set -u
RES="$(cd "$(dirname "${BASH_SOURCE[0]}")/../Resources" && pwd)"
SUPPORT="$HOME/Library/Application Support/DroneRadar"
mkdir -p "$SUPPORT"
PORT="${DRONERADAR_PORT:-8783}"
URL="http://127.0.0.1:$PORT/"

open_window() {
  # The desktop's own bounds, so the window fills the screen the user is on
  # rather than a size guessed here. Falls back to a common laptop size.
  local bounds w h
  # Finder gives the desktop as left, top, right, bottom — and on a multi-screen
  # setup the left and top can be negative, so the last two fields are edges,
  # not a size.
  bounds=$(osascript -e 'tell application "Finder" to get bounds of window of desktop' 2>/dev/null)
  w=$(echo "$bounds" | awk -F', *' '{print $3 - $1}')
  h=$(echo "$bounds" | awk -F', *' '{print $4 - $2}')
  [ -n "${w:-}" ] && [ "$w" -gt 400 ] 2>/dev/null || w=1680
  [ -n "${h:-}" ] && [ "$h" -gt 300 ] 2>/dev/null || h=1050

  # The dedicated profile keeps this window out of the way of ordinary
  # browsing, but left to itself Chrome syncs the extensions in and fills it:
  # ours reached 1.1GB, 770MB of that extensions the dashboard never uses.
  # A dashboard needs none of it, and the cache is capped at 32MB.
  local app
  for app in "Google Chrome" "Microsoft Edge" "Brave Browser" "Vivaldi" "Chromium"; do
    if [ -d "/Applications/$app.app" ]; then
      open -na "$app" --args \
        --app="$URL" \
        --window-position=0,0 \
        --window-size="$w,$h" \
        --user-data-dir="$SUPPORT/window" \
        --no-first-run --no-default-browser-check \
        --disable-extensions --disable-sync --disable-background-networking \
        --disk-cache-size=33554432
      return 0
    fi
  done
  # No Chromium browser on this Mac: an ordinary tab is better than nothing.
  open "$URL"
}

# Already running? Just bring the dashboard back up.
if /usr/bin/curl -sS -m 2 -o /dev/null "http://127.0.0.1:$PORT/api/status" 2>/dev/null; then
  open_window
  exit 0
fi

if [ ! -x /usr/bin/python3 ]; then
  osascript -e 'display alert "Python が必要です" message "ターミナルで xcode-select --install を実行してください。"'
  exit 1
fi

cd "$RES"
# The server opens a browser itself when left to its own devices, which would
# put a plain tab behind the app window.
export DRONERADAR_NO_BROWSER=1
# Set DRONERADAR_LAN=1 to also serve the dashboard to the local network, so a
# tablet or a TV on the same Wi-Fi can display it. Off by default: it would
# otherwise expose the endpoints that add sources and change settings.
[ "${DRONERADAR_LAN:-0}" = "1" ] && export DRONERADAR_HOST=0.0.0.0
/usr/bin/python3 -m droneradar.server >>"$SUPPORT/droneradar.log" 2>&1 &
SERVER_PID=$!

# Wait for the port rather than sleeping a fixed amount: collection on a cold
# start can take a while, but the server answers long before it finishes.
for _ in $(seq 1 40); do
  if /usr/bin/curl -sS -m 1 -o /dev/null "http://127.0.0.1:$PORT/api/status" 2>/dev/null; then
    break
  fi
  sleep 0.25
done

open_window
wait "$SERVER_PID"
