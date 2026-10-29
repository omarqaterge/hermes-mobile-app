package com.omarqaterge.hermesmobile;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.RemoteInput;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.Log;

import org.json.JSONObject;

import java.net.InetAddress;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collections;

/** Pairing Termux's adb with Wireless debugging, done by the user (owner, 2026-10-29: nothing taps the screen for
 *  him). Start pairing (Setup, a tap) posts the Pairing notification with a text field and opens Settings at Wireless
 *  debugging; the user opens "Pair device with pairing code" and types the code into the notification (the dialog closes
 *  when Settings leaves the screen, so the code can't be typed in the app). NsdManager finds the pairing port
 *  (_adb-tls-pairing._tcp exists only while that dialog is open); Termux runs `hm-shizuku pair PORT CODE`; its
 *  shizuku-auto event says whether it worked. Bounded: discovery and the notification end 10 minutes after the tap,
 *  one 40 s timeout per code. No loop, no wake lock. All state lives on the main thread. */
final class AdbPairing {
    private AdbPairing() {
    }

    static final String TAG = "HermesPair", CH_PAIR = "pairing", ACTION_CODE = "com.omarqaterge.hermesmobile.PAIR_CODE";
    static final String SERVICE_TYPE = "_adb-tls-pairing._tcp", REMOTE = "code", NTAG = "pair";
    static final int NID = 1;
    static final long WINDOW_MS = 10 * 60 * 1000, ANSWER_MS = 40 * 1000;
    private static final Handler main = new Handler(Looper.getMainLooper());
    private static Context app;
    private static NsdManager.DiscoveryListener disc;
    private static int port;                 // latest pairing port that answered on 127.0.0.1 (0 = none yet)
    private static boolean waiting;          // a code went to Termux, its event hasn't come yet
    private static long windowEnd;           // uptime when this tap's window ends
    private static final ArrayDeque<NsdServiceInfo> queue = new ArrayDeque<>();
    private static final ArrayList<NsdServiceInfo> seen = new ArrayList<>(); // this discovery's services, by name
    private static boolean resolving;
    private static final Runnable endTask = AdbPairing::stopDiscovery;
    private static final Runnable noAnswer = () -> {
        if (!waiting) return;
        waiting = false;
        Log.i(TAG, "no answer from Termux after " + ANSWER_MS / 1000 + " s");
        ask("No answer from Termux", "Open Termux once, come back, then tap Start pairing again. If that doesn\u2019t help, run the installer again.", false);
    };

    // ── entry points ──

    /** Setup → "Shizuku starts by itself" → Start pairing (a user tap; main thread). */
    static void begin(Activity a) {
        app = a.getApplicationContext();
        HermesService.createChannels(app);
        NotificationManager nm = app.getSystemService(NotificationManager.class);
        NotificationChannel ch = nm.getNotificationChannel(CH_PAIR);
        if (!nm.areNotificationsEnabled() || (ch != null && ch.getImportance() == NotificationManager.IMPORTANCE_NONE)) {
            Log.i(TAG, "notifications off: opening the app's notification settings");
            android.widget.Toast.makeText(a, "Allow notifications for Hermes Mobile first: the pairing code is typed into one",
                    android.widget.Toast.LENGTH_LONG).show();
            try {
                a.startActivity(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                        .putExtra(Settings.EXTRA_APP_PACKAGE, app.getPackageName()));
            } catch (Exception e) {
                Log.w(TAG, "notification settings: " + e);
            }
            return;
        }
        if (Settings.Global.getInt(app.getContentResolver(), Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0) != 1) {
            // Settings closes its Developer options pages at once while they are off (seen on AOSP).
            Log.i(TAG, "developer options off: opening About phone");
            android.widget.Toast.makeText(a, "Turn on Developer options first (tap Build number 7 times)",
                    android.widget.Toast.LENGTH_LONG).show();
            try {
                a.startActivity(new Intent(Settings.ACTION_DEVICE_INFO_SETTINGS));
            } catch (Exception e) {
                Log.w(TAG, "about phone: " + e);
            }
            return;
        }
        port = 0;
        waiting = false;
        main.removeCallbacks(noAnswer);
        windowEnd = SystemClock.uptimeMillis() + WINDOW_MS;
        ask("Pair Termux: enter the code", "In Wireless debugging tap Pair device with pairing code, then type the 6-digit code here.", true);
        startDiscovery();
        main.removeCallbacks(endTask);
        main.postDelayed(endTask, WINDOW_MS);
        openWirelessDebugging(a);
    }

    /** Settings at Wireless debugging: AOSP's Quick Settings tile page first, then Developer options with the Wireless
     *  debugging row highlighted, then Settings itself. Each is a public intent; the first one Android takes wins. */
    static void openWirelessDebugging(Activity a) {
        Intent[] chain = {
                new Intent("android.service.quicksettings.action.QS_TILE_PREFERENCES")
                        .setPackage("com.android.settings")
                        .putExtra(Intent.EXTRA_COMPONENT_NAME, new ComponentName("com.android.settings",
                                "com.android.settings.development.qstile.DevelopmentTiles$WirelessDebugging")),
                new Intent(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS)
                        .putExtra(":settings:fragment_args_key", "toggle_adb_wireless"),
                new Intent(Settings.ACTION_SETTINGS),
        };
        String[] names = {"qs-tile-preferences", "development-settings", "settings"};
        for (int k = 0; k < chain.length; k++) {
            try {
                a.startActivity(chain[k]);
                Log.i(TAG, "opened Settings with intent " + (k + 1) + " (" + names[k] + ")");
                return;
            } catch (ActivityNotFoundException | SecurityException e) {
                Log.i(TAG, "intent " + (k + 1) + " (" + names[k] + ") refused: " + e.getClass().getSimpleName());
            }
        }
        Log.w(TAG, "no Settings page could be opened");
    }

    /** The user typed into the notification's Enter code field (HermesService.onStartCommand, main thread). */
    static void onReply(Context c, Intent i) {
        if (app == null) app = c.getApplicationContext();
        Bundle res = RemoteInput.getResultsFromIntent(i);
        CharSequence cs = res == null ? null : res.getCharSequence(REMOTE);
        final KeeperPlan.PairReply r = KeeperPlan.parsePairReply(cs == null ? null : cs.toString());
        if (r == null) {
            ask("That wasn\u2019t a 6-digit code", "Type the 6 digits shown under Pair with device.", true);
            return;
        }
        if (r.port > 0) {
            send(r.port, r.code);
            return;
        }
        // NsdManager's port: the dialog may have closed since (its port then no longer answers), and a reopened dialog
        // keeps the same service name, so discovery doesn't report it again: check, and resolve the services again.
        final int p = port;
        new Thread(() -> {
            boolean open = p > 0 && openOnLoopback(p);
            main.post(() -> {
                if (open) {
                    send(p, r.code);
                    return;
                }
                if (p > 0) Log.i(TAG, "pairing port " + p + " no longer open");
                if (port == p) port = 0;
                reresolve(q -> {
                    if (q > 0) send(q, r.code);
                    else notFound();
                });
            });
        }, "hermes-pair-check").start();
    }

    /** A shizuku-auto event from Termux (HermesService, after ShizukuKeeper.onEvent); any thread. */
    static void onEvent(Context c, JSONObject e) {
        final int k = KeeperPlan.pairResult(e.has("cmd") ? e.optString("cmd") : null, e.optString("result"), e.optBoolean("paired"));
        if (k == 0) return;
        final String detail = e.optString("detail", "");
        main.post(() -> {
            if (app == null) app = c.getApplicationContext();
            pageChanged();
            if (!waiting) return;
            waiting = false;
            main.removeCallbacks(noAnswer);
            if (k == 1) {
                Log.i(TAG, "paired");
                stopDiscovery();
                done("Termux is paired", "Shizuku now starts by itself after a restart, on Wi-Fi.");
            } else {
                String d = detail.length() > 120 ? detail.substring(0, 120) + "\u2026" : detail;
                Log.i(TAG, "pairing failed: " + d);
                ask("Pairing didn\u2019t work", "Open Pair device with pairing code again and enter the new code."
                        + (d.isEmpty() ? "" : " (" + d + ")"), true);
                port = 0;
                startDiscovery(); // only inside this tap's window
            }
        });
    }

    // ── steps ──

    private static void notFound() {
        ask("Pairing screen not found", "Keep Pair device with pairing code open in Settings, then enter the code again. "
                + "Or type the code and the port, e.g. 123456 37123 (the number after the colon).", true);
    }

    private static void send(int p, String code) {
        String script = KeeperPlan.pairScript(p, code);
        if (script == null) {
            notFound();
            return;
        }
        ask("Pairing\u2026", "Termux is pairing with Wireless debugging.", false);
        waiting = ShizukuKeeper.runInTermux(app, script, "hm-shizuku pair " + p);
        main.removeCallbacks(noAnswer);
        if (!waiting) {
            ask("Termux can\u2019t be asked yet", "Finish the install first, then tap Start pairing again.", false);
            return;
        }
        main.postDelayed(noAnswer, ANSWER_MS);
    }

    /** An open Setup screen re-reads setupState at once. */
    private static void pageChanged() {
        MainActivity m = MainActivity.current;
        if (m != null) m.runOnUiThread(m::setupChanged);
    }

    // ── the Pairing notification (tag "pair", id 1) ──

    private static Notification.Builder base(String title, String text) {
        PendingIntent open = PendingIntent.getActivity(app, 7,
                new Intent(app, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(app, CH_PAIR)
                .setSmallIcon(R.drawable.ic_stat_hermes)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setOnlyAlertOnce(false)
                .setGroup(NTAG) // its own group: not folded into the app's other notifications, so Enter code shows at once
                .setContentIntent(open);
    }

    /** Post (or replace) the Pairing notification; withField adds the Enter code text field. */
    static void ask(String title, String text, boolean withField) {
        if (app == null) return;
        long left = Math.max(30_000, windowEnd - SystemClock.uptimeMillis());
        Notification.Builder b = base(title, text).setTimeoutAfter(Math.min(left, WINDOW_MS));
        if (withField) {
            PendingIntent pi = PendingIntent.getService(app, NTAG.hashCode(),
                    new Intent(app, HermesService.class).setAction(ACTION_CODE),
                    PendingIntent.FLAG_MUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
            b.addAction(new Notification.Action.Builder(null, "Enter code", pi)
                    .addRemoteInput(new RemoteInput.Builder(REMOTE).setLabel("6-digit code").build())
                    .setAllowGeneratedReplies(false).build());
        }
        notify(b.build());
    }

    /** The final word: no field, gone after 15 s or a tap. */
    static void done(String title, String text) {
        if (app == null) return;
        notify(base(title, text).setAutoCancel(true).setTimeoutAfter(15_000).build());
    }

    private static void cancelNotice() {
        try {
            app.getSystemService(NotificationManager.class).cancel(NTAG, NID);
        } catch (Exception e) {
            Log.w(TAG, "cancel: " + e);
        }
    }

    private static void notify(Notification n) {
        try {
            app.getSystemService(NotificationManager.class).notify(NTAG, NID, n);
        } catch (Exception e) {
            Log.w(TAG, "notify: " + e);
        }
    }

    // ── NsdManager: the pairing dialog's port (bounded by this tap's window) ──

    private static void startDiscovery() {
        stopNsd();
        if (SystemClock.uptimeMillis() >= windowEnd) return;
        final NsdManager nsd = app.getSystemService(NsdManager.class);
        queue.clear();
        resolving = false;
        final NsdManager.DiscoveryListener l = new NsdManager.DiscoveryListener() {
            @Override
            public void onStartDiscoveryFailed(String type, int err) {
                Log.w(TAG, "discovery failed to start: " + err);
                main.post(() -> {
                    if (disc == this) disc = null;
                });
            }

            @Override
            public void onStopDiscoveryFailed(String type, int err) {
            }

            @Override
            public void onDiscoveryStarted(String type) {
                Log.i(TAG, "looking for " + type);
            }

            @Override
            public void onDiscoveryStopped(String type) {
            }

            @Override
            public void onServiceFound(NsdServiceInfo s) {
                main.post(() -> {
                    if (disc != this) return;
                    for (int k = seen.size() - 1; k >= 0; k--)
                        if (seen.get(k).getServiceName().equals(s.getServiceName())) seen.remove(k);
                    seen.add(s);
                    queue.add(s);
                    resolveNext(nsd, this);
                });
            }

            @Override
            public void onServiceLost(NsdServiceInfo s) {
            }
        };
        disc = l;
        try {
            nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, l);
        } catch (Exception e) {
            Log.w(TAG, "discoverServices: " + e);
            disc = null;
        }
    }

    /** One resolve at a time (NsdManager refuses parallel ones); FAILURE_ALREADY_ACTIVE retries once after 500 ms. */
    private static void resolveNext(final NsdManager nsd, final NsdManager.DiscoveryListener owner) {
        if (resolving || queue.isEmpty() || disc != owner) return;
        resolving = true;
        final NsdServiceInfo s = queue.poll();
        resolve(nsd, owner, s, true);
    }

    @SuppressWarnings("deprecation") // resolveService: the API 26-33 way; still works on 34+
    private static void resolve(final NsdManager nsd, final NsdManager.DiscoveryListener owner, final NsdServiceInfo s, final boolean retry) {
        try {
            nsd.resolveService(s, new NsdManager.ResolveListener() {
                @Override
                public void onResolveFailed(NsdServiceInfo si, int err) {
                    main.post(() -> {
                        if (retry && err == NsdManager.FAILURE_ALREADY_ACTIVE && disc == owner) {
                            main.postDelayed(() -> resolve(nsd, owner, s, false), 500);
                            return;
                        }
                        resolving = false;
                        resolveNext(nsd, owner);
                    });
                }

                @Override
                public void onServiceResolved(NsdServiceInfo si) {
                    InetAddress h = si.getHost();
                    final String host = h == null ? null : h.getHostAddress();
                    final int p = si.getPort();
                    main.post(() -> {
                        resolving = false;
                        checkCandidate(host, p, owner);
                        resolveNext(nsd, owner);
                    });
                }
            });
        } catch (Exception e) {
            Log.w(TAG, "resolveService: " + e);
            resolving = false;
        }
    }

    /** A resolved service counts only if it is this phone's (another phone on the Wi-Fi advertises the same type) and its
     *  port answers on 127.0.0.1 (NsdManager can still hold a closed dialog's port). */
    private static void checkCandidate(String host, final int p, final NsdManager.DiscoveryListener owner) {
        ArrayList<String[]> one = new ArrayList<>(Collections.singletonList(new String[]{host, String.valueOf(p)}));
        if (KeeperPlan.localPorts(one, ShizukuKeeper.localHosts()).isEmpty()) {
            Log.i(TAG, "pairing service on " + host + " is another device's");
            return;
        }
        new Thread(() -> {
            boolean open = openOnLoopback(p);
            main.post(() -> {
                if (disc != owner) return;
                if (open) {
                    boolean fresh = p != port;
                    port = p;
                    Log.i(TAG, "pairing port " + p + " found, open on 127.0.0.1");
                    // The pairing dialog is open now: post again so the notification alerts (a heads-up over Settings with
                    // its Enter code field where the phone shows them). The first post came while Settings was opening and
                    // can sit collapsed lower in the shade, where its field is hidden (seen on HyperOS).
                    if (fresh && !waiting) {
                        // A NEW post (cancel first): an update of the same notification doesn't pop up again on every phone.
                        cancelNotice();
                        ask("Enter the pairing code", "Type the 6-digit code shown in Settings here.", true);
                    }
                } else {
                    Log.i(TAG, "pairing port " + p + " not open (an earlier dialog)");
                }
            });
        }, "hermes-pair-port").start();
    }

    /** One more pass over the services this discovery saw (the user typed a code but no open port is known): resolve
     *  each again, keep this phone's, take the newest that answers on 127.0.0.1. Bounded: one pass, 5 s at most. */
    @SuppressWarnings("deprecation")
    private static void reresolve(final java.util.function.IntConsumer then) {
        final ArrayList<NsdServiceInfo> list = new ArrayList<>(seen);
        if (list.isEmpty() || app == null) {
            then.accept(0);
            return;
        }
        final NsdManager nsd = app.getSystemService(NsdManager.class);
        final ArrayList<String[]> found = new ArrayList<>();
        final boolean[] over = {false};
        final Runnable[] next = new Runnable[1];
        final Runnable finish = () -> {
            if (over[0]) return;
            over[0] = true;
            final java.util.List<Integer> ports = KeeperPlan.localPorts(found, ShizukuKeeper.localHosts());
            new Thread(() -> {
                int open = 0;
                for (int q : ports) if (openOnLoopback(q)) { open = q; break; }
                final int o = open;
                main.post(() -> {
                    Log.i(TAG, "resolved again: " + found.size() + " service(s), open port " + (o > 0 ? o : "none"));
                    if (o > 0) port = o;
                    then.accept(o);
                });
            }, "hermes-pair-port").start();
        };
        final int[] i = {0};
        next[0] = () -> {
            if (over[0]) return;
            if (i[0] >= list.size()) {
                main.removeCallbacks(finish);
                finish.run();
                return;
            }
            NsdServiceInfo s = list.get(i[0]++);
            try {
                nsd.resolveService(s, new NsdManager.ResolveListener() {
                    @Override
                    public void onResolveFailed(NsdServiceInfo si, int err) {
                        main.post(next[0]);
                    }

                    @Override
                    public void onServiceResolved(NsdServiceInfo si) {
                        InetAddress h = si.getHost();
                        final String[] hp = {h == null ? null : h.getHostAddress(), String.valueOf(si.getPort())};
                        main.post(() -> {
                            found.add(hp);
                            next[0].run();
                        });
                    }
                });
            } catch (Exception e) {
                main.post(next[0]);
            }
        };
        main.postDelayed(finish, 5000);
        next[0].run();
    }

    private static boolean openOnLoopback(int p) {
        try (java.net.Socket so = new java.net.Socket()) {
            so.connect(new java.net.InetSocketAddress("127.0.0.1", p), 300);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private static void stopNsd() {
        NsdManager.DiscoveryListener l = disc;
        disc = null;
        queue.clear();
        seen.clear();
        resolving = false;
        if (l == null || app == null) return;
        try {
            app.getSystemService(NsdManager.class).stopServiceDiscovery(l);
        } catch (IllegalArgumentException ignored) {
            // never started or already stopped
        } catch (Exception e) {
            Log.w(TAG, "stopServiceDiscovery: " + e);
        }
    }

    /** End of the window or paired: no more discovery for this tap. */
    static void stopDiscovery() {
        main.removeCallbacks(endTask);
        if (disc != null) Log.i(TAG, "discovery stopped");
        stopNsd();
    }
}
