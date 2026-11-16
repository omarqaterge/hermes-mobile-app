#!/bin/bash
# Every notification action with a text field (RemoteInput: a reply, an answer, the pairing code) must ask for the unlock
# first on Android 12+ (HermesService.unlockFirst), so nobody holding a locked phone can type into Hermes or pair adb from
# the lock screen (docs/decisions/no-actions-from-locked-phone.md). Reads the Java sources; no JDK needed.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 - android/src/com/omarqaterge/hermesmobile <<'PY'
import pathlib, re, sys

src = pathlib.Path(sys.argv[1])
bad, seen = [], 0
for f in sorted(src.glob("*.java")):
    text = f.read_text()
    for m in re.finditer(r"\.addRemoteInput\(", text):
        seen += 1
        start = text.rfind("Notification.Action.Builder(", 0, m.start())
        if start < 0:
            bad.append(f"{f.name}:{text.count(chr(10), 0, m.start()) + 1}: addRemoteInput with no Action.Builder before it")
            continue
        # the statement holding the builder: from the last ';', '{' or '}' before it
        stmt = max(text.rfind(c, 0, start) for c in ";{}")
        if "unlockFirst(" not in text[stmt:start]:
            line = text.count("\n", 0, start) + 1
            bad.append(f"{f.name}:{line}: a notification text field without unlockFirst(...)")

def check(ok, what):
    print(("PASS  " if ok else "FAIL  ") + what)
    return ok

ok = check(seen >= 2, f"found the notification text fields ({seen})")
ok &= check(not bad, "every notification text field asks for the unlock first" + ("".join("\n      " + b for b in bad)))
pairing = (src / "AdbPairing.java").read_text()
ok &= check("keyguardLocked(" in pairing[pairing.index("static void onReply"):], "the pairing code is refused on a locked phone (Android 11)")
sys.exit(0 if ok else 1)
PY
