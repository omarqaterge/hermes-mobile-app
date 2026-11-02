package com.omarqaterge.hermesmobile;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.CancellationSignal;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;

/**
 * Settings → Permissions → "Confirm approvals with fingerprint" (preference "approvalLock", default on). With it on,
 * the first Allow in a chat session needs the phone's biometric or screen lock; after one success the chat's later
 * approvals go through until the session ends. A session ends when this process ends (app or phone restart, Android
 * stopping the app) or when the page says the chat's live Hermes session closed ({@link #forget}). Deny never asks.
 * Kept here, not in the page, so the notification's Allow (HermesService) follows the same rule.
 */
final class ApprovalLock {
    private ApprovalLock() {}

    static final String PREF = "approvalLock";
    /** Stored chat ids whose Allow was confirmed while this process runs. */
    private static final Set<String> confirmed = ConcurrentHashMap.newKeySet();

    static boolean on(Context c) {
        return c.getSharedPreferences("hm", Context.MODE_PRIVATE).getBoolean(PREF, true);
    }

    static void setOn(Context c, boolean on) {
        c.getSharedPreferences("hm", Context.MODE_PRIVATE).edit().putBoolean(PREF, on).apply();
        confirmed.clear(); // turned off and on again: every chat asks again
    }

    /** The phone has a PIN, pattern, password or biometric lock (nothing to confirm with otherwise). */
    static boolean secure(Context c) {
        KeyguardManager km = c.getSystemService(KeyguardManager.class);
        return km != null && km.isDeviceSecure();
    }

    static boolean isConfirmed(String session) {
        return session != null && !session.isEmpty() && confirmed.contains(session);
    }

    static void forget(String session) {
        if (session != null) confirmed.remove(session);
    }

    /** An Allow for this chat must be confirmed first (setting on, a screen lock to confirm with, not yet confirmed). */
    static boolean needed(Context c, String session) {
        return on(c) && secure(c) && !isConfirmed(session);
    }

    static String stateJson(Context c) {
        return "{\"on\":" + on(c) + ",\"secure\":" + secure(c) + "}";
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
    static void ask(Activity a, String session, String what, Consumer<String> done) {
        if (!on(a) || isConfirmed(session)) {
            done.accept("ok");
            return;
        }
        if (!secure(a)) {
            done.accept("nolock");
            return;
        }
        if (pending != null && pendingActivity != a) finish("cancel"); // its activity is gone: that prompt never answers
        if (pending != null) {
            if (!java.util.Objects.equals(session, pendingSession)) {
                done.accept("cancel"); // another chat's prompt is up: one confirmation never covers two chats
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
        if (Build.VERSION.SDK_INT >= 28) biometric(a, what, g);
        else credential(a, what, g);
    }

    /** MainActivity.onDestroy: a prompt it started can't answer any more. */
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
        if ("ok".equals(result) && s != null && !s.isEmpty()) confirmed.add(s);
        if (d != null) d.accept(result);
    }

    @android.annotation.TargetApi(28) // called only on API 28+; newer calls below have their own checks
    private static void biometric(Activity a, String what, int g) {
        try {
            android.hardware.biometrics.BiometricPrompt.Builder b = new android.hardware.biometrics.BiometricPrompt.Builder(a)
                    .setTitle("Allow Hermes to run this?")
                    .setSubtitle(what)
                    .setDescription("Confirm it is you. Other approvals in this chat won't ask again until the app restarts or the chat closes.");
            if (Build.VERSION.SDK_INT >= 30) {
                b.setAllowedAuthenticators(android.hardware.biometrics.BiometricManager.Authenticators.BIOMETRIC_WEAK
                        | android.hardware.biometrics.BiometricManager.Authenticators.DEVICE_CREDENTIAL);
            } else if (Build.VERSION.SDK_INT >= 29) {
                b.setDeviceCredentialAllowed(true);
            } else {
                b.setNegativeButton("Use screen lock", a.getMainExecutor(), (d, w) -> credential(a, what, g));
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
                        credential(a, what, g);
                        return;
                    }
                    // the API 28 "Use screen lock" button reports a cancel after starting the screen-lock screen
                    if (credentialUp) return;
                    finish(g, "cancel");
                }
            });
        } catch (Exception e) {
            credential(a, what, g);
        }
    }

    static final int REQ = 45;
    private static boolean credentialUp;

    private static void credential(Activity a, String what, int g) {
        if (g != gen || credentialUp) return;
        try {
            KeyguardManager km = a.getSystemService(KeyguardManager.class);
            Intent i = km == null ? null : km.createConfirmDeviceCredentialIntent("Allow Hermes to run this?", what);
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

    /** MainActivity.onActivityResult for {@link #REQ}. */
    static void onResult(int result) {
        boolean asked = credentialUp;
        credentialUp = false;
        if (asked && pending != null) finish(result == Activity.RESULT_OK ? "ok" : "cancel");
    }
}
