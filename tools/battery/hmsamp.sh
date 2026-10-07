#!/system/bin/sh
# Battery sampler, run on the phone as the adb shell user (its own CPU is not counted against Termux or the app).
# Every INTERVAL s until STOPFILE exists: uptime, the hermes:working wake lock, and /proc ticks of every process
# (and Python thread) of Termux's UID, the app's UID and the app's WebView renderer.
#   sh hmsamp.sh <out> <stopfile> [interval=1] [termux_uid=10471] [app_uid=10472]
OUT=$1; STOP=$2; IV=${3:-1}; TU=${4:-10471}; AU=${5:-10472}
APPU="u0a$((AU % 100000 - 10000))"
REND=$(dumpsys activity processes | grep -o "[0-9]*:com.google.android.webview:sandboxed_process[^ ]*/${APPU}i[0-9]*" | head -1 | cut -d: -f1)
echo "R $REND" > "$OUT"
while [ ! -f "$STOP" ]; do
  echo "T $(cut -d' ' -f1 /proc/uptime) $(date +%s.%N) W$(dumpsys power | grep -c "'hermes:working'")" >> "$OUT"
  for pid in $(ps -A -o PID=,UID= | awk -v t=$TU -v a=$AU '$2==t||$2==a{print $1}') $REND; do
    s=$(cat /proc/$pid/stat 2>/dev/null) || continue
    echo "P $s" >> "$OUT"
    case "$s" in *"(bash)"*|*"(sleep)"*|*"(com."*|*"(sshd)"*|*"(adb)"*) ;;
      *) for t in /proc/$pid/task/*; do echo "H $pid $(cat $t/stat 2>/dev/null)"; done >> "$OUT";;
    esac
  done
  sleep "$IV"
done
