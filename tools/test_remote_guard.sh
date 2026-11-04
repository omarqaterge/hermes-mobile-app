#!/bin/bash
# Tests the remote-request filter (android/.../RemoteGuard.java) with a plain JDK: it starts blocked, local and non-network
# addresses pass, every other address is refused while blocked, the one-use allowance for a tapped address (exact match,
# expiry, the bound), and the lookalike hosts that must not pass. Needs javac 11+. Also run by tools/java-check.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/src/com/omarqaterge/hermesmobile"
cp android/src/com/omarqaterge/hermesmobile/RemoteGuard.java "$T/src/com/omarqaterge/hermesmobile/"
cat > "$T/src/com/omarqaterge/hermesmobile/RemoteGuardTest.java" <<'JAVA'
package com.omarqaterge.hermesmobile;
public class RemoteGuardTest {
    static int fails = 0;
    static void check(boolean ok, String what) { System.out.println((ok ? "PASS  " : "FAIL  ") + what); if (!ok) fails++; }
    static long now = 1_000_000L;
    public static void main(String[] a) {
        RemoteGuard.clock = () -> now;
        // starts closed
        RemoteGuard.reset();
        check(RemoteGuard.isBlocked(), "a fresh page starts blocked");
        check(RemoteGuard.blocks("https://evil.example/x.png?d=1"), "blocked: an https image");
        check(!RemoteGuard.blocks("http://localhost:9119/api/x") && !RemoteGuard.blocks("http://127.0.0.1:9119/api/x") && !RemoteGuard.blocks("http://[::1]:9119/api/x"), "blocked state still passes localhost, 127.0.0.1 and [::1]");
        check(!RemoteGuard.blocks("file:///android_asset/www/index.html") && !RemoteGuard.blocks("data:image/png;base64,AAAA") && !RemoteGuard.blocks("blob:null/1234") && !RemoteGuard.blocks("about:blank"), "file, data, blob and about pass");
        check(RemoteGuard.blocks("http://localhost.evil.example/x") && RemoteGuard.blocks("https://127.0.0.1.evil.example/") && RemoteGuard.blocks("http://evil.example/?u=http://localhost/"), "lookalike hosts are refused");
        check(RemoteGuard.blocks("http://localhost@evil.example/x") && RemoteGuard.blocks("http://evil.example\\@localhost/x"), "user-info and backslash tricks are refused");
        check(!RemoteGuard.blocks("http://LOCALHOST:1/x"), "host case is ignored");
        check(RemoteGuard.blocks("//evil.example/x") && RemoteGuard.blocks("ftp://evil.example/x") && RemoteGuard.blocks("wss://evil.example/x") && RemoteGuard.blocks("javascript:void(0)") && RemoteGuard.blocks(null) && RemoteGuard.blocks(""), "scheme-less, other schemes and unreadable are refused (closed)");
        check(RemoteGuard.blocks("https://hm-media.invalid/m?k=1"), "any other host is refused here (MainActivity answers its own hosts before asking)");
        check(RemoteGuard.blocks("FILE2://x") && RemoteGuard.blocks("filex:///a"), "a scheme only starting like file is refused");
        // open
        RemoteGuard.setBlocked(false);
        check(!RemoteGuard.blocks("https://evil.example/x.png") && !RemoteGuard.blocks(null), "not blocked: everything passes, as today");
        RemoteGuard.setBlocked(true);
        check(RemoteGuard.blocks("https://evil.example/x.png"), "blocked again");
        RemoteGuard.reset();
        RemoteGuard.setBlocked(false);
        RemoteGuard.reset();
        check(RemoteGuard.blocks("https://evil.example/x.png"), "a new page resets to blocked");
        // allow once
        String u = "https://img.example/p.png?q=1";
        check(RemoteGuard.allowOnce(u) && RemoteGuard.liveAllowances() == 1, "the tapped address is allowed");
        check(RemoteGuard.blocks("https://img.example/p.png?q=2") && RemoteGuard.blocks("https://img.example/p.png") && RemoteGuard.blocks("http://img.example/p.png?q=1"), "only the exact address: another query, none, or another scheme are refused");
        check(!RemoteGuard.blocks(u) && RemoteGuard.liveAllowances() == 0, "the exact address passes once");
        check(RemoteGuard.blocks(u), "and not twice");
        RemoteGuard.allowOnce(u + "#frag");
        check(!RemoteGuard.blocks(u), "a fragment is ignored in the match");
        RemoteGuard.allowOnce(u);
        now += RemoteGuard.TTL_MS - 1;
        check(RemoteGuard.liveAllowances() == 1, "just before the limit it is live");
        now += 1;
        check(RemoteGuard.blocks(u), "after 60 seconds it is gone");
        check(!RemoteGuard.allowOnce("file:///x") && !RemoteGuard.allowOnce(null) && !RemoteGuard.allowOnce("") && !RemoteGuard.allowOnce("javascript:1") && !RemoteGuard.allowOnce("//x.example/a"), "only a full http or https address can be allowed");
        StringBuilder big = new StringBuilder("https://x.example/");
        for (int i = 0; i < RemoteGuard.MAX_URL; i++) big.append('a');
        check(!RemoteGuard.allowOnce(big.toString()), "an address over the limit can't be allowed");
        RemoteGuard.reset();
        for (int i = 0; i < RemoteGuard.MAX_ALLOWED + 5; i++) RemoteGuard.allowOnce("https://x.example/" + i);
        check(RemoteGuard.liveAllowances() == RemoteGuard.MAX_ALLOWED, "no more than MAX_ALLOWED are kept");
        check(RemoteGuard.blocks("https://x.example/0") && !RemoteGuard.blocks("https://x.example/" + (RemoteGuard.MAX_ALLOWED + 4)), "the oldest is dropped, the newest kept");
        RemoteGuard.reset();
        RemoteGuard.allowOnce(u);
        RemoteGuard.reset();
        check(RemoteGuard.blocks(u), "a page reload drops allowances");
        RemoteGuard.allowOnce(u);
        RemoteGuard.setBlocked(false);
        RemoteGuard.setBlocked(true);
        check(RemoteGuard.blocks(u), "a new block drops allowances");
        System.out.println(fails == 0 ? "ALL PASSED" : fails + " FAILED");
        System.exit(fails == 0 ? 0 : 1);
    }
}
JAVA
javac -encoding UTF-8 -d "$T/out" "$T/src/com/omarqaterge/hermesmobile/"*.java
java -cp "$T/out" com.omarqaterge.hermesmobile.RemoteGuardTest
