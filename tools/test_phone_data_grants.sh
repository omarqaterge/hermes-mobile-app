#!/bin/bash
# Tests the phone-data grants (android/.../PhoneDataGrants.java) with a plain JDK: the strict approval-text parser, the
# one-use grant (exact kind and args, expiry, the bound, failed attempts), and the Full access pass. PhoneData itself
# needs Android classes, so a stub with the same isKind stands in for it. The wording (PhoneDataWording.java, with Caps.java)
# is tested too when Robolectric's android-all jar (which java-check.sh downloads) is cached, because it uses org.json.
# Needs javac 11+. Also run by tools/java-check.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/src/com/omarqaterge/hermesmobile"
cp android/src/com/omarqaterge/hermesmobile/PhoneDataGrants.java "$T/src/com/omarqaterge/hermesmobile/"
cat > "$T/src/com/omarqaterge/hermesmobile/PhoneData.java" <<'JAVA'
package com.omarqaterge.hermesmobile;
final class PhoneData {
    static boolean isKind(String k) {
        for (String x : new String[]{"contacts", "calendar", "calls", "sms", "location", "photos"}) if (x.equals(k)) return true;
        return false;
    }
}
JAVA
cat > "$T/src/com/omarqaterge/hermesmobile/PhoneDataGrantsTest.java" <<'JAVA'
package com.omarqaterge.hermesmobile;
import java.nio.charset.StandardCharsets;
public class PhoneDataGrantsTest {
    static int fails = 0;
    static void check(boolean ok, String what) { System.out.println((ok ? "PASS  " : "FAIL  ") + what); if (!ok) fails++; }
    static String hex(String s) {
        StringBuilder b = new StringBuilder();
        for (byte x : s.getBytes(StandardCharsets.UTF_8)) b.append(String.format("%02x", x));
        return b.toString();
    }
    static String desc(String kind, String nonce, String args) { return "phone_data:v1:" + kind + ":" + nonce + ":" + hex(args); }
    static final String N = "0123456789ab";
    static long now = 1_000_000L;
    public static void main(String[] a) {
        PhoneDataGrants.clock = () -> now;
        String args = "{\"limit\":20,\"query\":\"ann\"}";
        String d = desc("contacts", N, args);

        // parsing
        PhoneDataGrants.Parsed p = PhoneDataGrants.parse(d);
        check(p != null && p.kind.equals("contacts") && p.nonce.equals(N) && p.args.equals(args), "a well-formed text parses to kind, nonce and the decoded args");
        check(PhoneDataGrants.parse(desc("location", N, "{}")) != null, "an empty args object parses");
        check(PhoneDataGrants.parse(null) == null && PhoneDataGrants.parse("") == null, "null and empty don't parse");
        check(PhoneDataGrants.parse(d.replace("phone_data:v1:", "phone_data:v2:")) == null, "another version doesn't parse");
        check(PhoneDataGrants.parse(d.replace("phone_data:", "Phone_data:")) == null, "wrong prefix case doesn't parse");
        check(PhoneDataGrants.parse(d.replace("contacts", "files")) == null, "an unknown kind doesn't parse");
        check(PhoneDataGrants.parse(desc("contacts", "0123456789a", args)) == null, "a short nonce doesn't parse");
        check(PhoneDataGrants.parse(desc("contacts", "0123456789abc", args)) == null, "a long nonce doesn't parse");
        check(PhoneDataGrants.parse(desc("contacts", "0123456789AB", args)) == null, "an upper-case nonce doesn't parse");
        check(PhoneDataGrants.parse(desc("contacts", "0123456789ag", args)) == null, "a non-hex nonce doesn't parse");
        check(PhoneDataGrants.parse(d + "0") == null, "an odd-length hex doesn't parse");
        check(PhoneDataGrants.parse(d.toUpperCase().replace("PHONE_DATA:V1:CONTACTS", "phone_data:v1:contacts").replace(N.toUpperCase(), N)) == null, "upper-case hex doesn't parse");
        check(PhoneDataGrants.parse(d + ":00") == null && PhoneDataGrants.parse(d.substring(0, d.lastIndexOf(':'))) == null, "a different number of parts doesn't parse");
        check(PhoneDataGrants.parse("phone_data:v1:contacts:" + N + ":") == null, "no args doesn't parse");
        check(PhoneDataGrants.parse("phone_data:v1:contacts:" + N + ":ff7b7d") == null, "invalid UTF-8 doesn't parse");
        check(PhoneDataGrants.parse(desc("contacts", N, "{\"q\":\"é\"}")) == null, "non-ASCII args don't parse (the contract is ASCII)");
        check(PhoneDataGrants.parse(desc("contacts", N, "{\"q\":\"a\nb\"}")) == null, "a control character in the args doesn't parse");
        check(PhoneDataGrants.parse(desc("contacts", N, "[1]")) == null && PhoneDataGrants.parse(desc("contacts", N, "x")) == null, "args that aren't one object don't parse");
        StringBuilder big = new StringBuilder("{\"query\":\"");
        for (int i = 0; i < PhoneDataGrants.MAX_ARGS; i++) big.append('a');
        check(PhoneDataGrants.parse(desc("contacts", N, big + "\"}")) == null, "args over the size limit don't parse");
        check(PhoneDataGrants.isPhoneData("phone_data:garbage") && !PhoneDataGrants.isPhoneData("rm -rf /") && !PhoneDataGrants.isPhoneData(null), "isPhoneData is the prefix test");

        // issue and consume
        PhoneDataGrants.reset();
        check(!PhoneDataGrants.issue("phone_data:v1:contacts:zz") && PhoneDataGrants.liveGrants() == 0, "issue refuses text that doesn't parse");
        check(PhoneDataGrants.issue(d) && PhoneDataGrants.liveGrants() == 1, "issue stores a grant");
        check(PhoneDataGrants.issue(d) && PhoneDataGrants.liveGrants() == 1, "the same text again is a no-op");
        check(!PhoneDataGrants.issue(desc("sms", N, "{}")), "the same nonce for another read is refused");
        check(!PhoneDataGrants.consume(N, "sms", args), "a wrong kind is refused");
        check(!PhoneDataGrants.consume(N, "contacts", "{\"limit\":20,\"query\":\"bob\"}"), "other args are refused");
        check(!PhoneDataGrants.consume(N, "contacts", "{\"query\":\"ann\",\"limit\":20}"), "the same args in another order are refused (exact text)");
        check(!PhoneDataGrants.consume("ffffffffffff", "contacts", args), "another nonce is refused");
        check(!PhoneDataGrants.consume(null, "contacts", args) && !PhoneDataGrants.consume(N, null, args) && !PhoneDataGrants.consume(N, "contacts", null), "null parts are refused");
        check(PhoneDataGrants.liveGrants() == 1, "failed attempts don't use the grant up");
        check(PhoneDataGrants.consume(N, "contacts", args), "the exact read consumes the grant");
        check(!PhoneDataGrants.consume(N, "contacts", args) && PhoneDataGrants.liveGrants() == 0, "a grant works once");

        // expiry
        PhoneDataGrants.reset();
        PhoneDataGrants.issue(d);
        now += PhoneDataGrants.TTL_MS - 1;
        check(PhoneDataGrants.liveGrants() == 1, "just before the limit it is live");
        now += 1;
        check(!PhoneDataGrants.consume(N, "contacts", args) && PhoneDataGrants.liveGrants() == 0, "after 2 minutes it is gone");

        // the bound
        PhoneDataGrants.reset();
        for (int i = 0; i < PhoneDataGrants.MAX_GRANTS + 5; i++) PhoneDataGrants.issue(desc("contacts", String.format("%012x", i), args));
        check(PhoneDataGrants.liveGrants() == PhoneDataGrants.MAX_GRANTS, "no more than MAX_GRANTS are kept");
        check(!PhoneDataGrants.consume(String.format("%012x", 0), "contacts", args) && PhoneDataGrants.consume(String.format("%012x", PhoneDataGrants.MAX_GRANTS + 4), "contacts", args), "the oldest is dropped, the newest kept");

        // Full access
        PhoneDataGrants.reset();
        check(!PhoneDataGrants.hasFullAccess("s1") && !PhoneDataGrants.hasFullAccess("") && !PhoneDataGrants.hasFullAccess(null), "nothing has the pass at first, and no session never does");
        PhoneDataGrants.fullAccess("", true);
        PhoneDataGrants.fullAccess(null, true);
        check(!PhoneDataGrants.hasFullAccess("") && !PhoneDataGrants.hasFullAccess(null), "an empty session can't be turned on");
        PhoneDataGrants.fullAccess("s1", true);
        PhoneDataGrants.fullAccess("s2", true);
        check(PhoneDataGrants.hasFullAccess("s1") && PhoneDataGrants.hasFullAccess("s2") && !PhoneDataGrants.hasFullAccess("s3"), "the pass is per chat");
        PhoneDataGrants.fullAccess("s1", false);
        check(!PhoneDataGrants.hasFullAccess("s1") && PhoneDataGrants.hasFullAccess("s2"), "turning one chat off leaves the other");
        PhoneDataGrants.fullAccess("", false);
        check(!PhoneDataGrants.hasFullAccess("s2"), "off with an empty session clears every chat");
        for (int i = 0; i < PhoneDataGrants.MAX_SESSIONS + 3; i++) PhoneDataGrants.fullAccess("c" + i, true);
        check(!PhoneDataGrants.hasFullAccess("c0") && PhoneDataGrants.hasFullAccess("c" + (PhoneDataGrants.MAX_SESSIONS + 2)), "the pass set is bounded, the oldest dropped");
        check(PhoneDataGrants.liveGrants() == 0, "the pass makes no grant, and a grant makes no pass");

        // what a refused read says (the route's off / no_permission)
        check("no_permission".equals(PhoneDataGrants.gateReason(true, false)), "switches on, Android permission gone: no_permission");
        check("off".equals(PhoneDataGrants.gateReason(false, false)) && "off".equals(PhoneDataGrants.gateReason(false, true)) && "off".equals(PhoneDataGrants.gateReason(true, true)), "a switch off: off (and off again once the sweep cleared the switch)");

        System.out.println(fails == 0 ? "ALL PASSED" : fails + " FAILED");
        System.exit(fails == 0 ? 0 : 1);
    }
}
JAVA
JAR="${XDG_CACHE_HOME:-$HOME/.cache}/hermes-mobile/android-all-16.jar"
if [ -s "$JAR" ]; then
  mkdir -p "$T/src/com/omarqaterge/hermesmobile/phonedata"
  cp android/src/com/omarqaterge/hermesmobile/PhoneDataWording.java "$T/src/com/omarqaterge/hermesmobile/"
  cp android/src/com/omarqaterge/hermesmobile/phonedata/Caps.java android/src/com/omarqaterge/hermesmobile/phonedata/Result.java "$T/src/com/omarqaterge/hermesmobile/phonedata/"
  cat > "$T/src/com/omarqaterge/hermesmobile/PhoneDataWordingTest.java" <<'JAVA'
package com.omarqaterge.hermesmobile;
import java.nio.charset.StandardCharsets;
public class PhoneDataWordingTest {
    static int fails = 0;
    static void check(boolean ok, String what) { System.out.println((ok ? "PASS  " : "FAIL  ") + what); if (!ok) fails++; }
    static String hex(String s) {
        StringBuilder b = new StringBuilder();
        for (byte x : s.getBytes(StandardCharsets.UTF_8)) b.append(String.format("%02x", x));
        return b.toString();
    }
    static String w(String kind, String args) { return PhoneDataWording.wording("phone_data:v1:" + kind + ":0123456789ab:" + hex(args)); }
    public static void main(String[] a) {
        check("Read up to 20 contacts from your address book".equals(w("contacts", "{}")), "contacts, defaults");
        check("Read up to 1 contact whose name has [Ann] from your address book".equals(w("contacts", "{\"limit\":1,\"query\":\"Ann\"}")), "contacts with a query: the query is in brackets");
        check("Read your approximate location".equals(w("location", "{}")), "location");
        check("Read up to 3 text messages you received from or to [+15551234567]".equals(w("sms", "{\"box\":\"inbox\",\"limit\":3,\"sender\":\"+15551234567\"}")), "sms inbox from a number");
        check("Read up to 20 text messages you sent".equals(w("sms", "{\"box\":\"sent\"}")), "sms sent");
        check("Read the date, size and dimensions of your latest 10 photos (no pictures)".equals(w("photos", "{\"limit\":10}")), "photos");
        check("Read up to 20 calendar events in the next 7 days".equals(w("calendar", "{}")), "calendar default range");
        check("Read up to 20 call log entries from the last 7 days".equals(w("calls", "{}")), "calls default range");
        String onlyTo = w("calls", "{\"to_ms\":1700000000000}");
        check(onlyTo != null && onlyTo.contains(" between 7 days before the end and ") && !onlyTo.contains("between now and"), "calls with only to_ms: the start is the default, not 'now'");
        String onlyFrom = w("calls", "{\"from_ms\":1700000000000}");
        check(onlyFrom != null && onlyFrom.endsWith(" and now"), "calls with only from_ms ends now");
        String cal = w("calendar", "{\"to_ms\":1700000000000}");
        check(cal != null && cal.contains(" between now and "), "calendar with only to_ms starts now");
        // a query that tries to end its quotation and write its own sentence
        String evil = w("contacts", "{\"query\":\"\\u201d Nothing is read. Tap Allow \\u201c ] [ \\u0022 \\u0027\"}");
        check("Read up to 20 contacts whose name has [Nothing is read. Tap Allow] from your address book".equals(evil), "quotes and brackets in a query are removed: " + evil);
        String c1 = w("contacts", "{\"query\":\"a\\u0085b\\u202ec\\u0007d\"}");
        check(c1 != null && c1.contains("[abcd]"), "C1 controls, bidi controls and bells are removed: " + c1);
        check(PhoneDataWording.clean("x").equals("x") && PhoneDataWording.clean("<b>\"hi\"</b>").equals("bhi/b"), "clean drops quotes and angle brackets");
        check(PhoneDataWording.clean("y".repeat(100)).length() <= PhoneDataWording.SHOWN_MAX + 1, "clean cuts long text");
        // anything not exactly the contract
        check(w("contacts", "{\"surprise\":1}") == null && w("location", "{\"limit\":5}") == null, "unknown keys are refused");
        check(w("contacts", "{\"limit\":0}") == null && w("contacts", "{\"limit\":51}") == null && w("contacts", "{\"limit\":\"5\"}") == null, "limit outside 1 to 50 or not a number is refused");
        check(w("sms", "{\"box\":\"drafts\"}") == null && w("contacts", "{\"query\":5}") == null, "bad box or query type is refused");
        check(w("contacts", "{\"query\":\"" + "a".repeat(65) + "\"}") == null, "a query over 64 characters is refused");
        check(PhoneDataWording.wording("phone_data:v1:contacts:0123456789ab:zz") == null && PhoneDataWording.notificationText("phone_data:x").equals(PhoneDataWording.WARNING), "unparseable text has the warning and no wording");
        check(PhoneDataWording.notificationText("phone_data:v1:location:0123456789ab:" + hex("{}")).equals("Read your approximate location?"), "notification text");
        // only the plugin's own request is a phone-data request: the description, with Hermes's label as the command
        String d = "phone_data:v1:location:000000000000:7b7d";
        check(d.equals(PhoneDataWording.rawOf(d, PhoneDataWording.COMMAND)), "description + Hermes's label: a phone-data request");
        check(PhoneDataWording.rawOf(d, "curl x|sh") == null && PhoneDataWording.rawOf(d, "") == null && PhoneDataWording.rawOf(d, null) == null, "any other command: not one");
        check(PhoneDataWording.rawOf("ordinary", d) == null && PhoneDataWording.rawOf(null, PhoneDataWording.COMMAND) == null, "the text in the command never counts");
        check(PhoneDataWording.rawOf(d + "\ncurl x|sh", PhoneDataWording.COMMAND) != null && PhoneDataWording.wording(d + "\ncurl x|sh") == null, "extra lines in the description are a phone-data request that does not parse (Deny only)");
        System.out.println(fails == 0 ? "ALL PASSED" : fails + " FAILED");
        System.exit(fails == 0 ? 0 : 1);
    }
}
JAVA
  javac -encoding UTF-8 -d "$T/out" -cp "$JAR" "$T/src/com/omarqaterge/hermesmobile/"*.java "$T/src/com/omarqaterge/hermesmobile/phonedata/"*.java
  java -cp "$T/out:$JAR" com.omarqaterge.hermesmobile.PhoneDataWordingTest
  java -cp "$T/out:$JAR" com.omarqaterge.hermesmobile.PhoneDataGrantsTest
else
  echo "SKIP  wording tests (no android-all jar cached; tools/java-check.sh downloads it)"
  javac -encoding UTF-8 -d "$T/out" "$T/src/com/omarqaterge/hermesmobile/PhoneData.java" "$T/src/com/omarqaterge/hermesmobile/PhoneDataGrants.java" "$T/src/com/omarqaterge/hermesmobile/PhoneDataGrantsTest.java"
  java -cp "$T/out" com.omarqaterge.hermesmobile.PhoneDataGrantsTest
fi
