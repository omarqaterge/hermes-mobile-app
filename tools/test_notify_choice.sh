#!/bin/bash
# Tests Settings → Notifications in the Android shell on a plain JDK: NotifyChoice.java (only the two names and the exact
# words "true" and "false" are stored, both choices default on, the JSON the page reads) with a fake SharedPreferences, and
# the sources: the three new bridge methods take the per-page key first and check it before anything else; the approval
# and question pop-ups, their re-alerts, the chip's approval and question states and the page's masked-prompt
# notification are gated by "When Hermux needs me", the Done chip, reply cards and scheduled-job cards by "When a task
# finishes"; the choice never reaches the code that answers (answerApproval, answerFromNotification), so turning it off
# answers and drops nothing. Robolectric's android-all jar (the one tools/java-check.sh checks and caches; ANDROID_ALL_JAR
# names another copy) is on the classpath for Context. Needs javac 11+. Run by tools/java-check.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
JAR="${ANDROID_ALL_JAR:-${XDG_CACHE_HOME:-$HOME/.cache}/hermes-mobile/android-all-16.jar}"
[ -s "$JAR" ] || { echo "test_notify_choice: $JAR is missing: run tools/java-check.sh first" >&2; exit 1; }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/src/com/omarqaterge/hermesmobile" "$T/classes"
cp android/src/com/omarqaterge/hermesmobile/NotifyChoice.java "$T/src/com/omarqaterge/hermesmobile/"
cat > "$T/src/com/omarqaterge/hermesmobile/NotifyChoiceTest.java" <<'JAVA'
package com.omarqaterge.hermesmobile;
import android.content.Context;
import android.content.ContextWrapper;
import android.content.SharedPreferences;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
public class NotifyChoiceTest {
    static int fails = 0;
    static void check(boolean ok, String what) { System.out.println((ok ? "PASS  " : "FAIL  ") + what); if (!ok) fails++; }
    /** Just enough SharedPreferences for NotifyChoice: booleans in a map, one file name recorded. */
    static final class Prefs implements SharedPreferences, SharedPreferences.Editor {
        final Map<String, Object> m = new HashMap<>();
        int writes = 0;
        public Map<String, ?> getAll() { return m; }
        public String getString(String k, String d) { return m.containsKey(k) ? (String) m.get(k) : d; }
        public Set<String> getStringSet(String k, Set<String> d) { return d; }
        public int getInt(String k, int d) { return d; }
        public long getLong(String k, long d) { return d; }
        public float getFloat(String k, float d) { return d; }
        public boolean getBoolean(String k, boolean d) { return m.containsKey(k) ? (Boolean) m.get(k) : d; }
        public boolean contains(String k) { return m.containsKey(k); }
        public Editor edit() { return this; }
        public void registerOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener l) {}
        public void unregisterOnSharedPreferenceChangeListener(OnSharedPreferenceChangeListener l) {}
        public Editor putString(String k, String v) { m.put(k, v); writes++; return this; }
        public Editor putStringSet(String k, Set<String> v) { writes++; return this; }
        public Editor putInt(String k, int v) { writes++; return this; }
        public Editor putLong(String k, long v) { writes++; return this; }
        public Editor putFloat(String k, float v) { writes++; return this; }
        public Editor putBoolean(String k, boolean v) { m.put(k, v); writes++; return this; }
        public Editor remove(String k) { m.remove(k); writes++; return this; }
        public Editor clear() { m.clear(); writes++; return this; }
        public boolean commit() { return true; }
        public void apply() {}
    }
    public static void main(String[] a) {
        Prefs p = new Prefs();
        String[] file = {null};
        Context c = new ContextWrapper(null) {
            @Override public SharedPreferences getSharedPreferences(String name, int mode) { file[0] = name; return p; }
        };
        check(NotifyChoice.finishes(c) && NotifyChoice.needsMe(c), "both choices are on until the person turns one off");
        check("hm".equals(file[0]), "they live in the shell's own preferences (hm)");
        check(NotifyChoice.set(c, "needsMe", "false") && !NotifyChoice.needsMe(c) && NotifyChoice.finishes(c), "needsMe false turns only that one off");
        check(NotifyChoice.set(c, "needsMe", "true") && NotifyChoice.needsMe(c), "needsMe true turns it back on");
        check(NotifyChoice.set(c, "finishes", "false") && !NotifyChoice.finishes(c) && NotifyChoice.needsMe(c), "finishes false turns only that one off");
        int before = p.writes;
        String[] bad = {null, "", "1", "0", "TRUE", "False", "on", "off", " true", "true ", "yes", "null", "undefined", "{}"};
        boolean refused = true;
        for (String v : bad) refused &= !NotifyChoice.set(c, "needsMe", v) && !NotifyChoice.set(c, "finishes", v);
        check(refused, "any value other than exactly true or false is refused");
        String[] names = {null, "", "needsme", "NeedsMe", "finish", "approvalLock", "notifyNeedsMe", "needsMe ", "unseen"};
        boolean unknown = true;
        for (String n : names) unknown &= !NotifyChoice.set(c, n, "true") && !NotifyChoice.set(c, n, "false");
        check(unknown, "any name other than finishes and needsMe is refused (no other preference can be written)");
        check(p.writes == before, "and a refused call writes nothing");
        check(NotifyChoice.needsMe(c) && !NotifyChoice.finishes(c), "the stored choices are unchanged after the refused calls");
        check(NotifyChoice.prefOf("finishes").equals(NotifyChoice.PREF_FINISHES) && NotifyChoice.prefOf("needsMe").equals(NotifyChoice.PREF_NEEDS_ME)
                && NotifyChoice.prefOf("x") == null, "each name has its own preference");
        check(NotifyChoice.json(false, true, true, false).equals("{\"finishes\":false,\"needsMe\":true,\"allowed\":true,\"canAsk\":false}"), "the state the page reads");
        System.out.println(fails == 0 ? "ALL PASSED" : fails + " FAILED");
        System.exit(fails == 0 ? 0 : 1);
    }
}
JAVA
javac -encoding UTF-8 -nowarn -proc:none -classpath "$JAR" -d "$T/classes" "$T"/src/com/omarqaterge/hermesmobile/*.java 2>&1 | grep -v '^Picked up JAVA_TOOL_OPTIONS' || true
set +e
java -cp "$T/classes:$JAR" com.omarqaterge.hermesmobile.NotifyChoiceTest 2>&1 | grep -v '^Picked up JAVA_TOOL_OPTIONS'
rc=${PIPESTATUS[0]}
set -e
# The sources (python3: one pass over each file).
python3 - "$rc" <<'PY'
import re, sys
rc = int(sys.argv[1])
fails = 0
def check(ok, what):
    global fails
    print(("PASS  " if ok else "FAIL  ") + what)
    if not ok: fails += 1
d = "android/src/com/omarqaterge/hermesmobile/"
main = open(d + "MainActivity.java", encoding="utf-8").read()
svc = open(d + "HermesService.java", encoding="utf-8").read()
def body(src, sig):
    i = src.find(sig)
    if i < 0: return ""
    j = src.find("{", i)
    depth, k = 0, j
    while k < len(src):
        depth += {"{": 1, "}": -1}.get(src[k], 0)
        if depth == 0: return src[j + 1:k]
        k += 1
    return ""
for name in ("notifyChoices", "setNotifyChoice", "phoneTextScale"):
    m = re.search(r"@JavascriptInterface\s+public \w+ " + name + r"\(String key[,)]", main)
    first = body(main, "public " + ("String " if name == "notifyChoices" else "boolean " if name == "setNotifyChoice" else "float ") + name + "(").strip().split("\n")[0].strip()
    check(bool(m) and first.startswith("if (!ok(key)) return"), name + ": a bridge method that takes the per-page key first and checks it before anything else")
setter = body(main, "public boolean setNotifyChoice(")
check("NotifyChoice.set(" in setter and "putBoolean" not in setter, "setNotifyChoice stores only through NotifyChoice.set (the two names, true or false)")
notify = body(main, "public void notify(String key")
check("NotifyChoice.needsMe(" in notify and notify.find("NotifyChoice.needsMe(") < notify.find(".notify("), "the page's masked-prompt notification is gated by needs me")
ev = body(svc, "synchronized void onEvent(JSONObject e)")
def case(kind):
    i = ev.find('case "' + kind + '"')
    j = ev.find("case \"", i + 10)
    return ev[i:j if j > 0 else len(ev)]
for kind in ("approval", "ask"):
    c = case(kind)
    check(c.find("pending.arrived(") < c.find("NotifyChoice.needsMe(") < c.find("postGrouped("), kind + ": still filed as waiting, then the pop-up only with needs me on")
fl = case("flash")
check(fl.count("NotifyChoice.finishes(") == 2 and fl.find("NotifyChoice.finishes(") < fl.find("unseen.put("), "flash: the Done chip (sticky and momentary) only with finishes on")
rp = case("error")  # "reply" falls through to "error"
check(rp.find("NotifyChoice.finishes(") < rp.find("postGrouped(") < rp.find("readAloud("), "reply and error cards only with finishes on; reading aloud stays its own setting")
check("NotifyChoice.finishes(" in case("cron"), "scheduled-job cards only with finishes on")
for k in ("learning", "clear", "status"):
    check("NotifyChoice" not in case(k), k + ": not a choice")
st = body(svc, "Notification statusNotification(")
check("NotifyChoice.needsMe(" in st and "if (approval) return approvalNotification" in st and "if (ask) return askNotification" in st, "the chip shows an approval or a question only with needs me on")
tick = body(svc, "void tickApproval()")
check("needs" in tick and "reAlertApproval()" in tick and "pending.expire(" in tick, "re-alerts only with needs me on; the countdown still expires the request")
for f in ("void answerApproval(", "void answerFromNotification(", "Notification approvalNotification(", "Notification askNotification("):
    check("NotifyChoice" not in body(svc, f), f.strip("( ") + " never reads the choice: nothing is answered or skipped because of it")
check("NotifyChoice" not in open(d + "ApprovalLock.java", encoding="utf-8").read(), "the fingerprint rule does not read the choice")
total_fail = fails + (0 if rc == 0 else 1)
print("ALL PASSED" if total_fail == 0 else f"{total_fail} FAILED")
sys.exit(0 if total_fail == 0 else 1)
PY
