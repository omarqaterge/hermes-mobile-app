#!/bin/bash
# Source check for native microphone release: MainActivity.onPause and Bridge.cancelListening (key-checked) call
# Voice.cancelListening, which cancels any pending LocalStt fallback, stops LocalStt immediately (stopNow), and
# cancels + destroys SpeechRecognizer without waiting for forceEnd; LocalStt.stopNow stops AudioRecord directly and
# skips fallback errors when stopped; secure-bridge.ts lists cancelListening. Run by tools/java-check.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 - <<'PY'
import re, sys

fails = 0
def check(ok, what):
    global fails
    print(("PASS  " if ok else "FAIL  ") + what)
    if not ok:
        fails += 1

def body(text, sig):
    i = text.find(sig)
    if i < 0:
        return ""
    j = text.find("{", i)
    depth, k = 0, j
    while k < len(text):
        depth += {"{": 1, "}": -1}.get(text[k], 0)
        if depth == 0:
            return text[j + 1:k]
        k += 1
    return ""

main_src = open("android/src/com/omarqaterge/hermesmobile/MainActivity.java", encoding="utf-8").read()
voice_src = open("android/src/com/omarqaterge/hermesmobile/Voice.java", encoding="utf-8").read()
stt_src = open("android/src/com/omarqaterge/hermesmobile/LocalStt.java", encoding="utf-8").read()
bridge_src = open("web/src/secure-bridge.ts", encoding="utf-8").read()

on_pause = body(main_src, "protected void onPause(")
check("voice.cancelListening();" in on_pause, "MainActivity.onPause calls voice.cancelListening() for immediate mic release")

bridge_cancel = body(main_src, "public void cancelListening(")
first_line = bridge_cancel.strip().split("\n")[0].strip() if bridge_cancel.strip() else ""
check(first_line.startswith("if (!ok(key)) return;"), "MainActivity.Bridge.cancelListening checks the per-page key first")
check("voice::cancelListening" in bridge_cancel, "MainActivity.Bridge.cancelListening dispatches voice::cancelListening on UI thread")
check("'cancelListening'" in bridge_src, "web/src/secure-bridge.ts lists cancelListening in METHODS")

v_cancel = body(voice_src, "void cancelListening(")
check("listeningActive = false;" in v_cancel and "removeCallbacks(fallbackRecognizer)" in v_cancel, "Voice.cancelListening clears listeningActive and removes pending LocalStt fallback")
check("a.stt.stopNow()" in v_cancel, "Voice.cancelListening stops LocalStt immediately (stopNow)")
check("sr.cancel()" in v_cancel and "sr.destroy()" in v_cancel and "sr = null;" in v_cancel, "Voice.cancelListening cancels and destroys SpeechRecognizer immediately")
check('js("end", "")' in v_cancel, "Voice.cancelListening reports end to the page")

v_stop = body(voice_src, "void stopListening(")
check("listeningActive = false;" in v_stop and "removeCallbacks(fallbackRecognizer)" in v_stop, "Voice.stopListening clears listeningActive and removes pending LocalStt fallback")
check("Voice.this::startRecognizer" not in voice_src, "Voice.localSink uses cancellable fallbackRecognizer instead of Voice.this::startRecognizer")
check("main.post(fallbackRecognizer)" in voice_src, "Voice.localSink posts fallbackRecognizer")

s_stop = body(stt_src, "private void stop(boolean discard)")
check("c.stop = true;" in s_stop and "c.discard = true;" in s_stop and "r.stop();" in s_stop, "LocalStt.stop(discard) sets stop/discard and stops AudioRecord immediately")
check("void stopNow()" in stt_src and "stop(true);" in body(stt_src, "void stopNow("), "LocalStt.stopNow() delegates to stop(true)")
s_listen = body(stt_src, "private void listen(")
check("run.rec = rec;" in s_listen and "run.rec = null;" in s_listen, "LocalStt.listen tracks active AudioRecord on Run and clears it in finally")
check('if (!run.stop) sink.failed("stt-model-load")' in s_listen, "LocalStt.listen skips stt-model-load fallback after stop")
check('if (!run.stop) sink.failed("stt-start")' in s_listen, "LocalStt.listen skips stt-start fallback after stop")
check("!run.discard" in s_listen, "LocalStt.listen skips decoding/finish when discarded")
check("stopNow();" in body(stt_src, "void release("), "LocalStt.release uses stopNow()")

voice_ts = open("web/src/voice.ts", encoding="utf-8").read()
live_ts = open("web/src/live.ts", encoding="utf-8").read()

check("getState().screen != null" in live_ts and "stopLive()" in live_ts, "web/src/live.ts stops Live mode when store.screen opens")
check("getState().screen != null" in voice_ts and "stopListening(true)" in voice_ts and "n.cancelListening()" in voice_ts, "web/src/voice.ts stops dictation immediately via cancelListening when store.screen opens")

print("ALL PASSED" if fails == 0 else f"{fails} FAILED")
sys.exit(0 if fails == 0 else 1)
PY
