package com.omarqaterge.hermesmobile;

import android.content.Context;

/**
 * Settings → Notifications: the two kinds of notification the person can turn off inside the app, kept in the shell's
 * preferences ("hm", both on by default). "When a task finishes" ({@link #FINISHES}, preference {@link #PREF_FINISHES})
 * covers the Done chip, reply and failed-turn cards and scheduled-job results; "When Hermux needs me" ({@link #NEEDS_ME},
 * {@link #PREF_NEEDS_ME}) covers the approval and question chips, their pop-ups and re-alerts, and the page's masked-prompt
 * notification. Off means HermesService does not post that kind; what is waiting still waits in the app (nothing is
 * answered or dropped). Everything else (the working chip that keeps the service alive, faults, updates, reading aloud,
 * pairing) is not a choice. The choices never touch Android's channels, so a channel tuned in Android stays as it is.
 * The page reads and sets them only through the keyed bridge (MainActivity.Bridge notifyChoices / setNotifyChoice), and
 * {@link #set} accepts only the two names and the exact words "true" and "false".
 */
final class NotifyChoice {
    private NotifyChoice() {}

    static final String FINISHES = "finishes";
    static final String NEEDS_ME = "needsMe";
    static final String PREF_FINISHES = "notifyFinishes";
    static final String PREF_NEEDS_ME = "notifyNeedsMe";

    /** The preference behind a choice the page names, or null for any other name. */
    static String prefOf(String which) {
        if (FINISHES.equals(which)) return PREF_FINISHES;
        if (NEEDS_ME.equals(which)) return PREF_NEEDS_ME;
        return null;
    }

    /** "true" or "false" exactly; anything else (null, "", "1", "TRUE", "on") is refused with null. */
    static Boolean parse(String value) {
        if ("true".equals(value)) return Boolean.TRUE;
        if ("false".equals(value)) return Boolean.FALSE;
        return null;
    }

    static boolean finishes(Context c) {
        return c.getSharedPreferences("hm", Context.MODE_PRIVATE).getBoolean(PREF_FINISHES, true);
    }

    static boolean needsMe(Context c) {
        return c.getSharedPreferences("hm", Context.MODE_PRIVATE).getBoolean(PREF_NEEDS_ME, true);
    }

    /** Stores one choice; false (nothing stored) for an unknown name or value. */
    static boolean set(Context c, String which, String value) {
        String pref = prefOf(which);
        Boolean on = parse(value);
        if (pref == null || on == null) return false;
        c.getSharedPreferences("hm", Context.MODE_PRIVATE).edit().putBoolean(pref, on).apply();
        return true;
    }

    /** {"finishes":bool,"needsMe":bool,"allowed":bool,"canAsk":bool} for Settings → Notifications. */
    static String json(boolean finishes, boolean needsMe, boolean allowed, boolean canAsk) {
        return "{\"finishes\":" + finishes + ",\"needsMe\":" + needsMe + ",\"allowed\":" + allowed + ",\"canAsk\":" + canAsk + "}";
    }
}
