package com.omarqaterge.hermesmobile;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * The building blocks of local authentication ({@code hermux-local-v1}): before a client sends anything private to a
 * server on this phone's loopback address, the server proves it holds the shared key, over the client's fresh nonce and
 * the address the client dialled; the client then signs its one request with the same key. {@link LocalClient} is the
 * client half; the server halves come later. The Python twin is {@code hermes-plugin/hermes-mobile/local_auth.py}; both
 * are checked against {@code tools/local-auth-vectors.json}.
 *
 * <p>A proof or MAC is lowercase hex HMAC-SHA256 under the key over eight fields joined by {@code \n} (no trailing
 * newline): {@code hermux-local-v1}, {@code dir}, {@code role}, {@code addr}, {@code nc}, {@code ns}, {@code what},
 * {@code hash}. Every field has a fixed alphabet with no control characters, and {@link #mac} refuses any field outside
 * it (a newline above all), so one field can never spill into the next and two different field lists can never give the
 * same message. Plain Java (no Android classes) so {@code tools/test_local_auth.sh} tests it with a JDK. Nothing here logs.
 */
final class LocalAuth {
    private LocalAuth() {}

    /** The first field of every MAC message: the protocol and its version. */
    static final String VERSION = "hermux-local-v1";
    /** {@code sha256hex} of nothing: the {@code hash} field of a message without a body. */
    static final String EMPTY_HASH = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    /** Which side made a MAC: a server's hello proof, a client's request, a proof over an answer. */
    static final List<String> DIRS = Collections.unmodifiableList(Arrays.asList("server", "client", "answer"));
    /** One label per local server, so a proof for one is never valid for another. */
    static final List<String> ROLES = Collections.unmodifiableList(Arrays.asList("dashboard", "events", "ticker", "bghost"));
    /** {@code ns} of a message that has no server nonce. */
    static final String NO_NONCE = "-";
    /** Shortest key accepted (after trimming), so a mistaken empty or tiny key is refused instead of used. */
    static final int MIN_KEY = 16;
    /** Longest {@code what} field. */
    static final int MAX_WHAT = 2048;

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final char[] HEX = "0123456789abcdef".toCharArray();

    /** A fresh nonce: 16 random bytes as 32 lowercase hex characters. */
    static String nonce() {
        byte[] b = new byte[16];
        RANDOM.nextBytes(b);
        return hex(b);
    }

    /** The key id: the first 8 hex characters of SHA-256 over {@code hermux-kid-v1\n} and the trimmed key text. */
    static String kid(String key) {
        return sha256hex(("hermux-kid-v1\n" + keyText(key)).getBytes(StandardCharsets.UTF_8)).substring(0, 8);
    }

    /**
     * The MAC of one message. Throws {@link IllegalArgumentException} (naming the field, never its value) when a field is
     * missing or outside its alphabet: {@code dir} and {@code role} from their lists, {@code addr} {@code 127.0.0.1:<port>},
     * {@code nc} a nonce, {@code ns} a nonce or {@code -}, {@code what} printable ASCII (spaces allowed), {@code hash} 64
     * lowercase hex characters.
     */
    static String mac(String key, String dir, String role, String addr, String nc, String ns, String what, String hash) {
        byte[] k = keyText(key).getBytes(StandardCharsets.UTF_8);
        if (!DIRS.contains(dir)) throw new IllegalArgumentException("dir");
        if (!ROLES.contains(role)) throw new IllegalArgumentException("role");
        if (!isAddr(addr)) throw new IllegalArgumentException("addr");
        if (!isNonce(nc)) throw new IllegalArgumentException("nc");
        if (!NO_NONCE.equals(ns) && !isNonce(ns)) throw new IllegalArgumentException("ns");
        if (!isWhat(what)) throw new IllegalArgumentException("what");
        if (!isHash(hash)) throw new IllegalArgumentException("hash");
        String msg = VERSION + "\n" + dir + "\n" + role + "\n" + addr + "\n" + nc + "\n" + ns + "\n" + what + "\n" + hash;
        try {
            Mac m = Mac.getInstance("HmacSHA256");
            m.init(new SecretKeySpec(k, "HmacSHA256"));
            return hex(m.doFinal(msg.getBytes(StandardCharsets.UTF_8)));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("HmacSHA256 unavailable");
        }
    }

    /** Lowercase hex SHA-256 of some bytes ({@code null} counts as none). */
    static String sha256hex(byte[] b) {
        try {
            return hex(MessageDigest.getInstance("SHA-256").digest(b == null ? new byte[0] : b));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("SHA-256 unavailable");
        }
    }

    /**
     * Constant-time equality for MACs, proofs and nonces: false when either is null or the lengths differ, otherwise every
     * character is compared whatever the first difference (an XOR loop; {@code MessageDigest.isEqual} is not relied on
     * because its timing has varied between builds).
     */
    static boolean same(String a, String b) {
        if (a == null || b == null || a.length() != b.length()) return false;
        int d = 0;
        for (int i = 0; i < a.length(); i++) d |= a.charAt(i) ^ b.charAt(i);
        return d == 0;
    }

    /** True for exactly 32 lowercase hex characters; anything else is never "close enough". */
    static boolean isNonce(String s) { return isHex(s, 32); }

    /** True for a key id: exactly 8 lowercase hex characters. */
    static boolean isKid(String s) { return isHex(s, 8); }

    /** True for a {@code hash} field: exactly 64 lowercase hex characters. */
    static boolean isHash(String s) { return isHex(s, 64); }

    /** True for {@code 127.0.0.1:<port>} with a port from 1 to 65535 written without leading zeros. */
    static boolean isAddr(String s) {
        String p = "127.0.0.1:";
        if (s == null || !s.startsWith(p)) return false;
        String n = s.substring(p.length());
        if (n.isEmpty() || n.length() > 5 || n.charAt(0) == '0') return false;
        for (int i = 0; i < n.length(); i++) if (n.charAt(i) < '0' || n.charAt(i) > '9') return false;
        int port = Integer.parseInt(n);
        return port >= 1 && port <= 65535;
    }

    /** The address a client dials and a server names for a port. */
    static String addr(int port) { return "127.0.0.1:" + port; }

    private static boolean isWhat(String s) {
        if (s == null || s.isEmpty() || s.length() > MAX_WHAT) return false;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c < 0x20 || c > 0x7e) return false;
        }
        return true;
    }

    private static boolean isHex(String s, int n) {
        if (s == null || s.length() != n) return false;
        for (int i = 0; i < n; i++) {
            char c = s.charAt(i);
            if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
        }
        return true;
    }

    /**
     * The key text as used: surrounding ASCII whitespace (space, tab, CR, LF, VT, FF) removed, as Python's
     * {@code strip(" \t\r\n\x0b\x0c")} does, then refused unless it is at least {@link #MIN_KEY} printable ASCII
     * characters. The same rule on both sides means a key is either used identically or refused by both.
     */
    static String keyText(String key) {
        if (key == null) throw new IllegalArgumentException("key");
        int a = 0, z = key.length();
        while (a < z && isSpace(key.charAt(a))) a++;
        while (z > a && isSpace(key.charAt(z - 1))) z--;
        String k = key.substring(a, z);
        if (k.length() < MIN_KEY) throw new IllegalArgumentException("key");
        for (int i = 0; i < k.length(); i++) {
            char c = k.charAt(i);
            if (c < 0x21 || c > 0x7e) throw new IllegalArgumentException("key");
        }
        return k;
    }

    private static boolean isSpace(char c) {
        return c == ' ' || c == '\t' || c == '\r' || c == '\n' || c == 0x0b || c == '\f';
    }

    private static String hex(byte[] b) {
        char[] out = new char[b.length * 2];
        for (int i = 0; i < b.length; i++) {
            out[2 * i] = HEX[(b[i] >> 4) & 0xf];
            out[2 * i + 1] = HEX[b[i] & 0xf];
        }
        return new String(out);
    }
}
