#!/bin/bash
# Tests the phone-data grants (android/.../PhoneDataGrants.java) with a plain JDK: the strict approval-text parser, the
# one-use grant (exact kind and args, expiry, the bound, failed attempts), and the Full access pass. PhoneData itself
# needs Android classes, so a stub with the same isKind stands in for it. Needs javac 11+. Not part of
# tools/java-check.sh yet: run it by hand (tools/test_phone_data_grants.sh).
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

        System.out.println(fails == 0 ? "ALL PASSED" : fails + " FAILED");
        System.exit(fails == 0 ? 0 : 1);
    }
}
JAVA
javac -encoding UTF-8 -d "$T/out" "$T/src/com/omarqaterge/hermesmobile/"*.java
java -cp "$T/out" com.omarqaterge.hermesmobile.PhoneDataGrantsTest
