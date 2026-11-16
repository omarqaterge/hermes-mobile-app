#!/bin/bash
# Tests the bridge's per-page-load key (android/.../BridgeKey.java) with a plain JDK: each key is handed out once, a
# key made while a handout runs is never also handed to that caller, and only the current key matches. The first check
# replays the old order (making a key outside the handout's lock) and shows the key reaching two callers. Needs javac 11+.
set -euo pipefail
cd "$(dirname "$0")/.."
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/src/com/omarqaterge/hermesmobile"
cp android/src/com/omarqaterge/hermesmobile/BridgeKey.java "$T/src/com/omarqaterge/hermesmobile/"
cat > "$T/src/com/omarqaterge/hermesmobile/BridgeKeyTest.java" <<'JAVA'
package com.omarqaterge.hermesmobile;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
public class BridgeKeyTest {
    static int fails = 0;
    static void check(boolean ok, String what) { System.out.println((ok ? "PASS  " : "FAIL  ") + what); if (!ok) fails++; }
    public static void main(String[] a) throws Exception {
        // The old order, step by step: the handout set its flag, then the next page's key was made (no shared lock),
        // then the handout returned the key field, now the new key; the new page's own handout also succeeded.
        String key = "k1"; boolean taken = false;
        taken = true;                    // old document's handshake: flag set
        key = "k2"; taken = false;       // UI thread: next page's key, made outside the handout's lock
        String oldCaller = key;          // the handshake returns the field
        String newPage = taken ? "" : key;
        check(oldCaller.equals("k2") && newPage.equals("k2"), "old order: one key reached two callers");

        BridgeKey k = new BridgeKey();
        check(k.take().isEmpty() && !k.matches("") && !k.matches(null), "before the first page: no key, nothing matches");
        k.next("k1");
        check(k.take().equals("k1"), "the first caller after a page load gets the key");
        check(k.take().isEmpty(), "a second caller gets nothing");
        check(k.matches("k1") && !k.matches("k0") && !k.matches("k1x"), "only the current key matches");
        k.next("k2");
        check(!k.matches("k1") && k.matches("k2"), "a new page load retires the old key");
        check(k.take().equals("k2") && k.take().isEmpty(), "and its key is handed out once");

        // Making a key waits while a handout holds the lock (the two never interleave).
        BridgeKey h = new BridgeKey();
        Thread maker = new Thread(() -> h.next("k9"));
        synchronized (h) {
            maker.start();
            long end = System.currentTimeMillis() + 5000;
            while (maker.getState() != Thread.State.BLOCKED && System.currentTimeMillis() < end) Thread.sleep(1);
            check(maker.getState() == Thread.State.BLOCKED, "making a key waits for a running handout");
        }
        maker.join();
        check(h.take().equals("k9"), "and goes ahead right after it");

        // Many page loads against two callers that keep asking: no key is ever handed out twice.
        BridgeKey s = new BridgeKey();
        Map<String, Integer> got = new ConcurrentHashMap<>();
        AtomicBoolean stop = new AtomicBoolean();
        Thread[] callers = new Thread[2];
        for (int t = 0; t < callers.length; t++) {
            callers[t] = new Thread(() -> { while (!stop.get()) { String x = s.take(); if (!x.isEmpty()) got.merge(x, 1, Integer::sum); } });
            callers[t].start();
        }
        int rounds = 300000;
        for (int i = 0; i < rounds; i++) {
            s.next("p" + i);
            while (!got.containsKey("p" + i)) Thread.onSpinWait();
        }
        stop.set(true);
        for (Thread t : callers) t.join();
        long twice = got.values().stream().filter(v -> v > 1).count();
        check(twice == 0 && got.size() == rounds, rounds + " page loads: every key handed out exactly once (" + twice + " twice)");
        System.out.println(fails == 0 ? "\nALL PASSED" : "\n" + fails + " FAILED");
        System.exit(fails == 0 ? 0 : 1);
    }
}
JAVA
javac -encoding UTF-8 -d "$T/out" "$T"/src/com/omarqaterge/hermesmobile/*.java
java -cp "$T/out" com.omarqaterge.hermesmobile.BridgeKeyTest
