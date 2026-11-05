package com.omarqaterge.hermesmobile;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.function.LongSupplier;

/**
 * The app's own record of which chats have asked to read phone data (docs/decisions/phone-data-read-only.md, "Chats that
 * have read phone data"). {@code POST /phonedata} adds the chat id of every read request, whatever its outcome (and the
 * plugin's {@code taint} op adds ids alone), and the page asks {@code phoneDataTainted(id)} before it draws a chat, so a
 * chat whose {@code phone_data} call is not among the items on screen (a long chat, a cached preview, a parent of a
 * subagent that read, a chat compressed while the app was away) is still known. The agent cannot edit it: it lives in the
 * app's private preferences. Ids only, never data and never a time.
 *
 * <p>Flooding: the key holder can send reads with made-up chat ids. An id is NEVER evicted. The record starts with room for
 * {@link #START_CAP} ids; the first new id past the cap sets the {@code overflow} flag instead of costing an old chat its
 * protection, and from then on {@link #contains} answers true for every chat (fail closed). Ids that still arrive are kept
 * (up to {@link #MAX_CAP}) so that nothing real is lost. The user clears the flag in Settings with {@link #allowMore}
 * (raises the cap by {@link #STEP}, keeps every id, and clears the flag once the record fits) or {@link #forgetAll}
 * (forgets every id: chats that read lose their protection). When even {@link #MAX_CAP} is full, an id that has no room is
 * dropped and a SEPARATE {@code lost} flag is set: {@link #allowMore} never clears it, every chat counts as having read while
 * it is set, and only {@link #forgetAll} clears it. Saves are batched (at most one per {@link #SAVE_EVERY_MS}, and
 * {@link #flush} when the app pauses or the page reads the record), always the whole text at once. One request adds at most {@link #MAX_NEW} new ids. Plain Java
 * (the persistence is a {@link Store}) so tools/test_phone_data_chats.sh tests it on a JDK.
 */
final class PhoneDataChats {
    /** The cap a fresh record starts with: more ids than this set the overflow flag. */
    static final int START_CAP = 2000;
    /** "Allow more chats" raises the cap by this many. */
    static final int STEP = 2000;
    /** The highest cap, and the most ids ever kept (a record is ids only: a few hundred KB at most). */
    static final int MAX_CAP = 20000;
    static final int MAX_ID = 128;
    /** The most ids one read request may add besides its own session (the chat and its ancestors, compression chain included). */
    static final int MAX_LIST = 16;
    /** The most NEW ids one request may add (its session and its list). */
    static final int MAX_NEW = MAX_LIST + 1;
    private static final String HEADER = "v3 ";
    private static final String HEADER_OLD = "v2 ";

    /** Where the record is kept: one text. */
    interface Store {
        String load();
        void save(String text);
    }

    private final Store store;
    private final LinkedHashSet<String> ids = new LinkedHashSet<>();
    private int cap = START_CAP;
    private boolean overflow;
    /** Some id was dropped for lack of room: it may be a real chat, so every chat counts as having read. Only Forget clears it. */
    private boolean lost;
    private boolean loaded;
    /** The most often the record is written: a flood would otherwise rewrite up to about 2.6 MB per change. */
    static final long SAVE_EVERY_MS = 1000;
    private final LongSupplier clock;
    private boolean dirty;
    private long lastSave = Long.MIN_VALUE / 2;

    PhoneDataChats(Store store) {
        this(store, () -> System.nanoTime() / 1_000_000L);
    }

    /** The clock (milliseconds, any origin) is a parameter so a test can move time. */
    PhoneDataChats(Store store, LongSupplier clock) {
        this.store = store;
        this.clock = clock;
    }

    /** A usable id: a non-empty string of at most 128 characters with no control characters or spaces (it is stored one per line). */
    static boolean validId(Object o) {
        if (!(o instanceof String)) return false;
        String s = (String) o;
        if (s.isEmpty() || s.length() > MAX_ID) return false;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (Character.isISOControl(c) || Character.isWhitespace(c) || Character.isSpaceChar(c)) return false;
        }
        return true;
    }

    private void load() {
        if (loaded) return;
        loaded = true;
        String t = null;
        try {
            t = store.load();
        } catch (Throwable ignored) {
            // nothing stored, or unreadable: start empty
        }
        if (t == null) return;
        for (String line : t.split("\n")) {
            if (line.startsWith(HEADER) || line.startsWith(HEADER_OLD)) {
                String[] p = line.substring(3).trim().split(" ");
                if (p.length > 0 && p[0].equals("overflow")) overflow = true;
                if (line.startsWith(HEADER) && p.length > 2 && p[2].equals("lost")) lost = true;
                if (line.startsWith(HEADER) && p.length > 1) {
                    try {
                        cap = Math.max(START_CAP, Math.min(MAX_CAP, Integer.parseInt(p[1])));
                    } catch (NumberFormatException ignored) {
                        // keep the start cap
                    }
                }
                continue;
            }
            int tab = line.indexOf('\t'); // an older record held "id<TAB>time"
            String id = tab < 0 ? line : line.substring(0, tab);
            if (!validId(id)) continue;
            if (ids.size() < MAX_CAP) ids.add(id);
            else if (!ids.contains(id)) lost = true; // a stored record with more ids than the bound: the extra ones have no room
        }
        if (ids.size() > cap) overflow = true; // more than the cap allows: fail closed, keep every id
    }

    /** Write the whole record now (one text, so a crash leaves the old text or the new one, never half). */
    private void save() {
        dirty = false;
        lastSave = clock.getAsLong();
        StringBuilder b = new StringBuilder(HEADER).append(overflow ? "overflow " : "ok ").append(cap);
        if (lost) b.append(" lost");
        for (String id : ids) b.append('\n').append(id);
        try {
            store.save(b.toString());
        } catch (Throwable ignored) {
            // best effort: the in-memory record stays
        }
    }

    /** A change from a read or a taint: write now unless one was written less than a second ago, else leave it for {@link #flush}. */
    private void saveSoon() {
        if (clock.getAsLong() - lastSave >= SAVE_EVERY_MS) save();
        else dirty = true;
    }

    /** Write what is waiting (the app pauses, or the page reads the record). A crash can lose only the last second of ids; the plugin re-reports them at its next tool call. */
    synchronized void flush() {
        if (dirty) save();
    }

    /**
     * Remember these chats: the session, and the extra list when it is a list (each valid entry; up to {@link #MAX_LIST}).
     * At most {@link #MAX_NEW} new ids per call. Nothing is ever removed. Never throws.
     */
    synchronized void record(Object session, Object chats) {
        try {
            load();
            List<String> add = new ArrayList<>();
            if (validId(session)) add.add((String) session);
            if (chats instanceof List) {
                int n = 0;
                for (Object o : (List<?>) chats) {
                    if (n++ >= MAX_LIST) break;
                    if (validId(o)) add.add((String) o);
                }
            }
            boolean changed = false;
            int fresh = 0;
            for (String id : add) {
                if (ids.contains(id)) continue;
                if (fresh >= MAX_NEW) continue;
                fresh++;
                if (ids.size() >= cap && !overflow) {
                    overflow = true; // the record is full: every chat now counts as having read
                    changed = true;
                }
                if (ids.size() >= MAX_CAP) { // the hard bound: this id has no room; it may be a real chat, so remember that
                    if (!lost) { lost = true; changed = true; }
                    continue;
                }
                ids.add(id);
                changed = true;
            }
            if (changed) saveSoon();
        } catch (Throwable ignored) {
            // the record is best effort; a failed save leaves the in-memory set
        }
    }

    /**
     * The plugin's {@code taint} op: these chats have read (a chat it already knows got a new id). Adds ids only. False when
     * {@code chats} is not a list with at least one valid id among its first {@link #MAX_LIST} entries (a bad body).
     */
    synchronized boolean taint(Object chats) {
        if (!(chats instanceof List)) return false;
        int n = 0;
        boolean any = false;
        for (Object o : (List<?>) chats) {
            if (n++ >= MAX_LIST) break;
            if (validId(o)) any = true;
        }
        if (!any) return false;
        record(null, chats);
        return true;
    }

    /** Has this chat id asked to read phone data? True for every valid id while the overflow flag is set. */
    synchronized boolean contains(String id) {
        if (!validId(id)) return false;
        load();
        flush();
        return overflow || lost || ids.contains(id);
    }

    /** Has any read ever been recorded (or lost to overflow)? For documents whose chat is unknown. */
    synchronized boolean any() {
        load();
        flush();
        return overflow || lost || !ids.isEmpty();
    }

    synchronized boolean overflowed() {
        load();
        flush();
        return overflow;
    }

    /** Was an id ever dropped for lack of room? Then every chat counts as having read until Forget. */
    synchronized boolean lost() {
        load();
        flush();
        return lost;
    }

    synchronized int cap() {
        load();
        return cap;
    }

    /**
     * The user chose "Allow more chats" (Settings): the cap grows by {@link #STEP} up to {@link #MAX_CAP}, every id stays, and
     * the overflow flag clears when the record fits under the new cap (never the {@code lost} flag). False when the cap was
     * already at the maximum.
     */
    synchronized boolean allowMore() {
        load();
        if (cap >= MAX_CAP) return false;
        cap = Math.min(MAX_CAP, cap + STEP);
        if (overflow && ids.size() <= cap) overflow = false;
        save();
        return true;
    }

    /** The user chose to forget the record (Settings): every id, the overflow flag and the lost flag go; chats that read lose their protection. */
    synchronized void forgetAll() {
        load();
        ids.clear();
        overflow = false;
        lost = false;
        save();
    }

    synchronized int size() {
        load();
        return ids.size();
    }
}
