#!/system/bin/sh
# Network bytes per UID so far (all interfaces, NetworkStats "UID stats" section): prints "uid rx tx".
#   sh hmnet.sh 10471 10472
dumpsys netstats --poll >/dev/null 2>&1
dumpsys netstats detail 2>/dev/null | awk -v uids=" $* " '
  /^UID stats:/ { sec = 1; next }
  /^[A-Z]/ { sec = 0 }
  sec && /ident=/ { cur = ""; if (match($0, /uid=[0-9]+ set=[A-Z_]+ tag=0x0$/)) { split(substr($0, RSTART + 4), a, " "); if (index(uids, " " a[1] " ")) cur = a[1] } next }
  sec && cur != "" && /rb=/ { for (i = 1; i <= NF; i++) { split($i, kv, "="); if (kv[1] == "rb") rx[cur] += kv[2]; if (kv[1] == "tb") tx[cur] += kv[2] } }
  END { n = split(uids, us, " "); for (i = 1; i <= n; i++) printf "%s %d %d\n", us[i], rx[us[i]], tx[us[i]] }'
