package com.omarqaterge.hermesmobile;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.CancellationSignal;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.Consumer;

/**
 * Settings → Permissions → "Confirm approvals with fingerprint" (preference "approvalLock", default on). With it on,
 * the first Allow in a chat session needs the phone's biometric or screen lock; after one success the chat's later
 * approvals go through until the session ends: this process ends (app or phone restart, Android stopping the app) or
 * the chat's live Hermes session closes. A confirmation is filed under the live session it was made in (Hermes's
 * runtime id, which the page passes), never under the stored chat: a new live session has nothing on file, so its first
 * Allow always asks, and a closed one's id never comes back, so nothing has to be forgotten for the rule to hold
 * ({@link #forget} only tidies). Deny never asks. The notification's Allow (HermesService) never knows the live session,
 * so while this is {@link #needed} it never answers by itself: it opens the island panel, which asks every time
 * ({@link #askOnce}) and hands the service a one-use grant for that one request ({@link #takeGrant}).
 */
final class ApprovalLock {
    private ApprovalLock() {}

    static final String PREF = "approvalLock";
    /** At most this many confirmed live sessions are kept; past it the oldest asks again (the page keeps as many). */
    static final int MAX = 64;
    /** Live sessions (runtime ids) whose Allow was confirmed while this process runs, the oldest first. */
    private static final Map<String, Boolean> confirmed = new LinkedHashMap<String, Boolean>(16, 0.75f, false) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Boolean> eldest) {
            return size() > MAX;
        }
    };

    static boolean on(Context c) {
        return c.getSharedPreferences("hm", Context.MODE_PRIVATE).getBoolean(PREF, true);
    }

    static void setOn(Context c, boolean on) {
        c.getSharedPreferences("hm", Context.MODE_PRIVATE).edit().putBoolean(PREF, on).apply();
        synchronized (confirmed) {
            confirmed.clear(); // turned off and on again: every chat asks again
        }
    }

    /** The phone has a PIN, pattern, password or biometric lock (nothing to confirm with otherwise). */
    static boolean secure(Context c) {
        KeyguardManager km = c.getSystemService(KeyguardManager.class);
        return km != null && km.isDeviceSecure();
    }

    /** This live session's Allow was confirmed ('' or null never is). */
    static boolean isConfirmed(String runtime) {
        if (runtime == null || runtime.isEmpty()) return false;
        synchronized (confirmed) {
            return confirmed.containsKey(runtime);
        }
    }

    /** Files a success under this live session only (package-private for tools/test_approval_lock.sh). */
    static void confirm(String runtime) {
        if (runtime == null || runtime.isEmpty()) return;
        synchronized (confirmed) {
            confirmed.remove(runtime); // the newest last
            confirmed.put(runtime, Boolean.TRUE);
        }
    }

    /** The live session closed (tidying: its id never comes back). A prompt still open for it may still answer "ok";
     *  that files only this closed id, which no later approval carries. */
    static void forget(String runtime) {
        if (runtime == null) return;
        synchronized (confirmed) {
            confirmed.remove(runtime);
        }
    }

    /** A notification's Allow must open the app first (setting on, a screen lock to confirm with). The notification only
     *  names the stored chat, never the live session a confirmation is filed under, so it can't tell a confirmed one. */
    static boolean needed(Context c) {
        return on(c) && secure(c);
    }

    static String stateJson(Context c) {
        return "{\"on\":" + on(c) + ",\"secure\":" + secure(c) + "}";
    }

    // ---- the island panel's one-use grants ----
    /** A grant lives this long after its prompt said "ok"; the panel sends at once, so this only bounds a stray one. */
    static final long GRANT_MS = 30_000;
    /** At most this many grants are kept (one per prompt that said "ok"); past it the oldest goes. */
    static final int MAX_GRANTS = 8;
    /** Grant id → {what it allows (chat, request, choice), when it was filed}, the oldest first. */
    private static final Map<String, Object[]> grants = new LinkedHashMap<String, Object[]>(8, 0.75f, false) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Object[]> eldest) {
            return size() > MAX_GRANTS;
        }
    };

    /** What a grant allows: one choice for one request of one chat. */
    static String grantFor(String session, String request, String choice) {
        return (session == null ? "" : session) + "\n" + (request == null ? "" : request) + "\n" + (choice == null ? "" : choice);
    }

    /** Files a grant (package-private for tools/test_approval_lock.sh; otherwise only {@link #askOnce}'s "ok"). */
    static void fileGrant(String id, String what, long now) {
        if (id == null || id.isEmpty() || what == null) return;
        synchronized (grants) {
            grants.put(id, new Object[]{what, now});
        }
    }

    /** Takes the grant {@code id} if it allows exactly {@code what} and is fresh: it is gone afterwards either way, so
     *  one fingerprint sends one answer to one request. */
    static boolean takeGrant(String id, String what, long now) {
        if (id == null || id.isEmpty() || what == null) return false;
        Object[] g;
        synchronized (grants) {
            g = grants.remove(id);
        }
        return g != null && what.equals(g[0]) && now - (Long) g[1] >= 0 && now - (Long) g[1] <= GRANT_MS;
    }

    /**
     * The island panel's Allow: always asks (the panel never knows the live session a confirmation is filed under, so
     * nothing on file covers it and nothing is filed there), then reports as {@link #ask} does. On "ok" it files the
     * one-use grant {@code id} for {@code what} ({@link #grantFor}), which HermesService takes before it sends.
     */
    static void askOnce(Activity a, String id, String what, String shown, Consumer<String> done) {
        prompt(a, "", "Allow Hermux to run this?", shown, "Confirm it is you.", r -> {
            if ("ok".equals(r)) fileGrant(id, what, System.currentTimeMillis());
            done.accept(r);
        });
    }

    // ---- the prompt (main thread, one at a time) ----
    private static Consumer<String> pending;
    private static String pendingSession;
    private static Activity pendingActivity;
    /** Each prompt's number: a late answer from an older prompt is ignored. */
    private static int gen;
    private static CancellationSignal cancel;

    /**
     * Ask for the biometric or screen lock, then report "ok", "cancel" or "nolock" (no screen lock: approved as before).
     * BiometricPrompt on API 28+ (biometric or the screen lock; on API 28 the button "Use screen lock" and phones
     * without a biometric fall back to the screen-lock screen); API 26–27 use the screen-lock screen
     * (createConfirmDeviceCredentialIntent, answered in {@link #onResult}).
     */
    static void ask(Activity a, String runtime, String what, Consumer<String> done) {
        if (!on(a) || isConfirmed(runtime)) {
            done.accept("ok");
            return;
        }
        prompt(a, runtime, "Allow Hermux to run this?", what,
                "Confirm it is you. Other approvals in this chat won't ask again until the app restarts or the chat closes.", done);
    }

    /** The same prompt for a setting that must ask on every change: ignores the approvals setting and confirmed chats. */
    static void askAlways(Activity a, String what, Consumer<String> done) {
        if (pending != null && pendingActivity != a) finish("cancel"); // its activity is gone: that prompt never answers
        if (pending != null) {
            done.accept("cancel"); // answers are never shared: a confirmation covers only the wording it was shown with
            return;
        }
        prompt(a, "", "Confirm it is you", what, "Hermux asks every time this setting changes.", done);
    }

    private static void prompt(Activity a, String session, String title, String what, String description, Consumer<String> done) {
        if (!secure(a)) {
            done.accept("nolock");
            return;
        }
        if (pending != null && pendingActivity != a) finish("cancel"); // its activity is gone: that prompt never answers
        if (pending != null) {
            if (session == null || session.isEmpty() || !session.equals(pendingSession)) {
                // another live session's prompt is up, or one with no live session (a setting): one confirmation never
                // covers two of them
                done.accept("cancel");
                return;
            }
            // a prompt is already up (two quick taps): the new caller gets the same answer as the first
            Consumer<String> first = pending;
            pending = r -> { first.accept(r); done.accept(r); };
            return;
        }
        pending = done;
        pendingSession = session;
        pendingActivity = a;
        int g = ++gen;
        if (Build.VERSION.SDK_INT >= 28) biometric(a, title, what, description, g);
        else credential(a, title, what, g);
    }

    /** MainActivity.onDestroy and IslandPanel.onDestroy: a prompt it started can't answer any more. */
    static void activityGone(Activity a) {
        if (pending != null && pendingActivity == a) finish("cancel");
    }

    private static void finish(int g, String result) {
        if (g == gen) finish(result);
    }

    private static void finish(String result) {
        if (cancel != null) {
            try {
                cancel.cancel();
            } catch (Exception ignored) {
                // already done
            }
        }
        credentialUp = false;
        pendingActivity = null;
        gen++;
        Consumer<String> d = pending;
        String s = pendingSession;
        pending = null;
        pendingSession = null;
        cancel = null;
        if ("ok".equals(result)) confirm(s); // only the live session this prompt was opened for
        if (d != null) d.accept(result);
    }

    @android.annotation.TargetApi(28) // called only on API 28+; newer calls below have their own checks
    private static void biometric(Activity a, String title, String what, String description, int g) {
        try {
            android.hardware.biometrics.BiometricPrompt.Builder b = new android.hardware.biometrics.BiometricPrompt.Builder(a)
                    .setTitle(title)
                    .setSubtitle(what)
                    .setDescription(description);
            if (Build.VERSION.SDK_INT >= 30) {
                b.setAllowedAuthenticators(android.hardware.biometrics.BiometricManager.Authenticators.BIOMETRIC_WEAK
                        | android.hardware.biometrics.BiometricManager.Authenticators.DEVICE_CREDENTIAL);
            } else if (Build.VERSION.SDK_INT >= 29) {
                b.setDeviceCredentialAllowed(true);
            } else {
                b.setNegativeButton("Use screen lock", a.getMainExecutor(), (d, w) -> credential(a, title, what, g));
            }
            cancel = new CancellationSignal();
            b.build().authenticate(cancel, a.getMainExecutor(), new android.hardware.biometrics.BiometricPrompt.AuthenticationCallback() {
                @Override
                public void onAuthenticationSucceeded(android.hardware.biometrics.BiometricPrompt.AuthenticationResult r) {
                    finish(g, "ok");
                }

                @Override
                public void onAuthenticationError(int code, CharSequence msg) {
                    if (g != gen) return; // an older prompt
                    // API 28 without an enrolled or working biometric, or locked out of it: the screen-lock screen instead.
                    if (Build.VERSION.SDK_INT < 29 && (code == android.hardware.biometrics.BiometricPrompt.BIOMETRIC_ERROR_HW_NOT_PRESENT
                            || code == android.hardware.biometrics.BiometricPrompt.BIOMETRIC_ERROR_HW_UNAVAILABLE
                            || code == android.hardware.biometrics.BiometricPrompt.BIOMETRIC_ERROR_NO_BIOMETRICS
                            || code == android.hardware.biometrics.BiometricPrompt.BIOMETRIC_ERROR_LOCKOUT
                            || code == android.hardware.biometrics.BiometricPrompt.BIOMETRIC_ERROR_LOCKOUT_PERMANENT)) {
                        credential(a, title, what, g);
                        return;
                    }
                    // the API 28 "Use screen lock" button reports a cancel after starting the screen-lock screen
                    if (credentialUp) return;
                    finish(g, "cancel");
                }
            });
        } catch (Exception e) {
            credential(a, title, what, g);
        }
    }

    static final int REQ = 45;
    private static boolean credentialUp;

    private static void credential(Activity a, String title, String what, int g) {
        if (g != gen || credentialUp) return;
        try {
            KeyguardManager km = a.getSystemService(KeyguardManager.class);
            Intent i = km == null ? null : km.createConfirmDeviceCredentialIntent(title, what);
            if (i == null) {
                finish(g, "nolock");
                return;
            }
            credentialUp = true;
            a.startActivityForResult(i, REQ);
        } catch (Exception e) {
            credentialUp = false;
            finish(g, "cancel");
        }
    }

    /** MainActivity.onActivityResult and IslandPanel.onActivityResult for {@link #REQ}. */
    static void onResult(int result) {
        boolean asked = credentialUp;
        credentialUp = false;
        if (asked && pending != null) finish(result == Activity.RESULT_OK ? "ok" : "cancel");
    }
}
