package com.omarqaterge.hermesmobile;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** The JavaScript bridge's per-page-load key. A main-frame load makes the next one ({@link #next}); the first
 *  {@link #take} after it hands it out, later ones get "". Making a key and handing one out run under this object's
 *  lock, so a key is never handed to two callers. Plain Java, so tools/test_bridge_key.sh runs it on a JDK. */
final class BridgeKey {
    private String key = "";
    private boolean taken = true;

    /** A new page is loading: from now on only {@code fresh} is valid, and it is not yet handed out. */
    synchronized void next(String fresh) {
        key = fresh == null ? "" : fresh;
        taken = false;
    }

    /** The key, to the first caller since {@link #next}; "" to everyone else. */
    synchronized String take() {
        if (taken) return "";
        taken = true;
        return key;
    }

    /** Is {@code k} the current key? Never true before the first key. Constant-time comparison. */
    synchronized boolean matches(String k) {
        return k != null && !key.isEmpty()
                && MessageDigest.isEqual(key.getBytes(StandardCharsets.UTF_8), k.getBytes(StandardCharsets.UTF_8));
    }
}
