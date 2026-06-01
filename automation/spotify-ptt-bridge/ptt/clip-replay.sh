#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
STATE_DIR="$ROOT/state"
LOG_FILE="$STATE_DIR/clip-replay.log"
GSR_CONFIG_UI="${GSR_CONFIG_UI:-${XDG_CONFIG_HOME:-$HOME/.config}/gpu-screen-recorder/config_ui}"
mkdir -p "$STATE_DIR"

cfg_val() {
  local key="$1" fallback="${2:-}"
  if [[ -f "$GSR_CONFIG_UI" ]]; then
    awk -v key="$key" '$1 == key { $1=""; sub(/^ /, ""); print; found=1; exit } END { exit found ? 0 : 1 }' "$GSR_CONFIG_UI" 2>/dev/null || printf '%s\n' "$fallback"
  else
    printf '%s\n' "$fallback"
  fi
}

cfg_bool_yesno() {
  case "$(cfg_val "$1" "$2")" in
    true|yes|1) printf 'yes\n' ;;
    *) printf 'no\n' ;;
  esac
}

app_save_dir() {
  cfg_val 'replay.save_directory' "$HOME/Videos"
}

app_replay_time() {
  cfg_val 'replay.time' '180'
}

app_window() {
  cfg_val 'replay.record_options.record_area_option' 'screen'
}

app_container() {
  cfg_val 'replay.container' 'mp4'
}

app_codec() {
  cfg_val 'replay.record_options.codec' 'auto'
}

app_audio_codec() {
  cfg_val 'replay.record_options.audio_codec' 'opus'
}

app_fps() {
  cfg_val 'replay.record_options.fps' '60'
}

app_color_range() {
  cfg_val 'replay.record_options.color_range' 'limited'
}

app_replay_storage() {
  cfg_val 'replay.replay_storage' 'ram'
}

app_restart_on_save() {
  cfg_bool_yesno 'replay.restart_replay_on_save' 'false'
}

app_restore_portal_session() {
  cfg_bool_yesno 'replay.record_options.restore_portal_session' 'true'
}

app_cursor() {
  cfg_bool_yesno 'replay.record_options.record_cursor' 'true'
}

app_low_power() {
  cfg_bool_yesno 'replay.record_options.low_power_mode' 'false'
}

app_quality_args() {
  local bitrate quality
  bitrate="$(cfg_val 'replay.record_options.video_bitrate' '')"
  quality="$(cfg_val 'replay.record_options.video_quality' 'very_high')"
  if [[ -n "$bitrate" && "$bitrate" != "0" ]]; then
    printf '%s\n' '-bm' 'cbr' '-q' "$bitrate"
  else
    printf '%s\n' '-bm' 'auto' '-q' "$quality"
  fi
}

app_audio_args() {
  [[ -f "$GSR_CONFIG_UI" ]] || return 0
  awk '$1 == "replay.record_options.audio_track_item" && $2 == "true" {
    $1=""; $2=""; sub(/^  */, "");
    if ($0 != "" && $0 != "[add_audio_track]") print $0
  }' "$GSR_CONFIG_UI" | while IFS= read -r source; do
    printf '%s\n' '-a' "$source"
  done
}

recorder_pids() {
  # Linux comm names are capped at 15 chars, so pgrep -x misses
  # gpu-screen-recorder when it appears as gpu-screen-reco.
  pgrep -f '^gpu-screen-recorder( |$)' 2>/dev/null | awk '!seen[$0]++'
}

is_running() {
  [[ -n "$(recorder_pids)" ]]
}

latest_clip() {
  local dir
  dir="$(app_save_dir)"
  find "$dir" -maxdepth 4 -type f \( -iname '*.mp4' -o -iname '*.mkv' -o -iname '*.mov' -o -iname '*.webm' \) -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -1 | cut -d' ' -f2-
}

save() {
  local dir pids before after
  dir="$(app_save_dir)"
  mkdir -p "$dir"

  if ! is_running; then
    echo "GSR replay is not active. Start replay in the GPU Screen Recorder app first, then say 'clip that'. App save folder: $dir"
    exit 0
  fi

  pids="$(recorder_pids)"
  before="$(latest_clip || true)"
  echo "[$(date -Is)] saving GSR app replay via SIGUSR1 pid(s)=$(echo "$pids" | paste -sd, -) dir=$dir replay_time=$(app_replay_time)" >> "$LOG_FILE"
  while read -r pid; do
    [[ -n "$pid" ]] && kill -s USR1 "$pid"
  done <<< "$pids"
  sleep 1.5
  after="$(latest_clip || true)"
  if [[ -n "$after" && "$after" != "$before" ]]; then
    echo "Saved clip: $after"
  else
    echo "Clip save signal sent. GSR app save folder: $dir"
  fi
}

start() {
  if is_running; then
    echo "Already running: pid(s) $(recorder_pids | paste -sd, -)"
    exit 0
  fi

  local dir args
  dir="$(app_save_dir)"
  mkdir -p "$dir"
  mapfile -t args < <(
    printf '%s\n' \
      -w "$(app_window)" \
      -f "$(app_fps)" \
      -c "$(app_container)" \
      -k "$(app_codec)" \
      -ac "$(app_audio_codec)"
    app_quality_args
    app_audio_args
    printf '%s\n' \
      -r "$(app_replay_time)" \
      -replay-storage "$(app_replay_storage)" \
      -restart-replay-on-save "$(app_restart_on_save)" \
      -cr "$(app_color_range)" \
      -cursor "$(app_cursor)" \
      -restore-portal-session "$(app_restore_portal_session)" \
      -low-power "$(app_low_power)" \
      -o "$dir"
  )

  echo "[$(date -Is)] starting GSR replay using app config window=$(app_window) dir=$dir replay_time=$(app_replay_time)" >> "$LOG_FILE"
  nohup gpu-screen-recorder "${args[@]}" >> "$LOG_FILE" 2>&1 &
  sleep 0.7
  if ! is_running; then
    echo "Failed to start gpu-screen-recorder with mirrored app settings. See $LOG_FILE" >&2
    tail -20 "$LOG_FILE" >&2 || true
    exit 1
  fi
  echo "Started GSR replay with mirrored app settings: pid(s) $(recorder_pids | paste -sd, -)"
}

stop() {
  if ! is_running; then
    echo "Not running."
    exit 0
  fi
  local pids
  pids="$(recorder_pids)"
  echo "[$(date -Is)] stopping GSR replay pid(s)=$(echo "$pids" | paste -sd, -)" >> "$LOG_FILE"
  while read -r pid; do
    [[ -n "$pid" ]] && kill -INT "$pid" 2>/dev/null || true
  done <<< "$pids"
  echo "Stopped GSR replay."
}

status() {
  local running='stopped'
  is_running && running="running pid(s)=$(recorder_pids | paste -sd, -)"
  cat <<EOF
$running
config=$GSR_CONFIG_UI
window=$(app_window)
save_dir=$(app_save_dir)
replay_time=$(app_replay_time)
container=$(app_container)
codec=$(app_codec)
fps=$(app_fps)
audio_codec=$(app_audio_codec)
replay_storage=$(app_replay_storage)
restart_on_save=$(app_restart_on_save)
EOF
}

case "${1:-status}" in
  start) start ;;
  save|clip) save ;;
  stop) stop ;;
  restart) stop >/dev/null || true; start ;;
  status) status ;;
  *) echo "Usage: $0 {start|save|stop|restart|status}" >&2; exit 2 ;;
esac
