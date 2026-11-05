package com.omarqaterge.hermesmobile;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.LongSupplier;

/**
 * The app's own record of which chats have asked to read phone data (docs/decisions/phone-data-read-only.md, "Chats that
 * have read phone data"). {@code POST /phonedata} adds the chat id of every read request, whatever its outcome, and the
 * page asks {@code phoneDataTainted(id)} before it draws a chat, so a chat whose {@code phone_data} call is not among the
 * items on screen (a long chat, a cached preview, a parent of a subagent that read) is still known. The agent cannot edit
 * it: it lives in the app's private preferences. Ids and the time each was last seen, never data.
 *
 * <p>Flooding: the key holder can send reads with made-up chat ids. So an id seen within {@link #KEEP_MS} is never
 * evicted. When the record is full of such ids the new one is not stored; the record sets an {@code overflow} flag instead,
 * and from then on {@link #contains} answers true for every chat (fail closed) until the user clears it in Settings
 * ({@link #forgetAll}) or clears the app's data. An id's age is refreshed whenever the page asks about it or a read names
 * it. One request adds at most {@link #MAX_NEW} new ids. Plain Java (the persistence is a {@link Store}) so
 * tools/test_phone_data_chats.sh tests it on a JDK.
 */
final class PhoneDataChats {
    static final int MAX = 2000;
    static final int MAX_ID = 128;
    /** The most ids one read request may add besides its own session (the chat and its ancestors, compression chain included). */
    static final int MAX_LIST = 16;
    /** The most NEW ids one request may add (its session and its list). */
    static final int MAX_NEW = MAX_LIST + 1;
    /** An id seen within this long is never evicted: 30 days. */
    static final long KEEP_MS = 30L * 24 * 60 * 60 * 1000;
    /** A refresh from the page is written to the store at most this often per id: one day. */
    private static final long TOUCH_SAVE_MS = 24L * 60 * 60 * 1000;
    private static final String HEADER = "v2 ";

    /** Where the record is kept: one text. */
    interface Store {
        String load();
        void save(String text);
    }

    private final Store store;
    private final LongSupplier clock;
    private final LinkedHashMap<String, Long> ids = new LinkedHashMap<>(); // least recently seen first -> last seen (ms)
    private boolean overflow;
    private boolean loaded;

    PhoneDataChats(Store store) {
        this(store, System::currentTimeMillis);
    }

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
        long now = clock.getAsLong();
        for (String line : t.split("\n")) {
            if (line.startsWith(HEADER)) {
                if (line.equals(HEADER + "overflow")) overflow = true;
                continue;
            }
            int tab = line.indexOf('\t');
            String id = tab < 0 ? line : line.substring(0, tab);
            if (!validId(id)) continue;
            long seen = now; // an older record without times: counted as seen now
            if (tab >= 0) {
                try {
                    seen = Math.min(now, Long.parseLong(line.substring(tab + 1)));
                } catch (NumberFormatException ignored) {
                    // keep now
                }
            }
            ids.put(id, seen);
        }
        if (ids.size() > MAX) overflow = true; // a record from a build with another bound: fail closed
    }

    private void save() {
        StringBuilder b = new StringBuilder(HEADER).append(overflow ? "overflow" : "ok");
        for (Map.Entry<String, Long> e : ids.entrySet()) b.append('\n').append(e.getKey()).append('\t').append(e.getValue());
        try {
            store.save(b.toString());
        } catch (Throwable ignored) {
            // best effort: the in-memory record stays
        }
    }

    /** Make room for one new id: drop ids not seen for {@link #KEEP_MS}, oldest first. False when every id is younger. */
    private boolean makeRoom(long now) {
        Iterator<Map.Entry<String, Long>> it = ids.entrySet().iterator();
        while (ids.size() >= MAX && it.hasNext()) {
            if (now - it.next().getValue() < KEEP_MS) break; // the rest are younger
            it.remove();
        }
        return ids.size() < MAX;
    }

    /**
     * Remember these chats: the session, and the extra list when it is a list (each valid entry; up to {@link #MAX_LIST}).
     * At most {@link #MAX_NEW} new ids per call. Never throws.
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
            long now = clock.getAsLong();
            boolean changed = false;
            int fresh = 0;
            for (String id : add) {
                if (ids.containsKey(id)) {
                    long seen = ids.remove(id); // seen again: the newest
                    ids.put(id, now);
                    if (now - seen >= TOUCH_SAVE_MS) changed = true; // the stored time is refreshed at most daily
                    continue;
                }
                if (fresh >= MAX_NEW) continue;
                fresh++;
                if (!makeRoom(now)) {
                    overflow = true; // full of recent ids: remember that something was lost, never drop a real chat
                    changed = true;
                    continue;
                }
                ids.put(id, now);
                changed = true;
            }
            if (changed) save();
        } catch (Throwable ignored) {
            // the record is best effort; a failed save leaves the in-memory set
        }
    }

    /** Has this chat id asked to read phone data? True for every valid id while the overflow flag is set. Refreshes the id's age. */
    synchronized boolean contains(String id) {
        if (!validId(id)) return false;
        load();
        if (overflow) return true;
        Long seen = ids.get(id);
        if (seen == null) return false;
        long now = clock.getAsLong();
        ids.remove(id);
        ids.put(id, now);
        if (now - seen >= TOUCH_SAVE_MS) save();
        return true;
    }

    /** Has any read ever been recorded (or lost to overflow)? For documents whose chat is unknown. */
    synchronized boolean any() {
        load();
        return overflow || !ids.isEmpty();
    }

    synchronized boolean overflowed() {
        load();
        return overflow;
    }

    /** The user chose to clear the record (Settings): the overflow flag and every id go. */
    synchronized void forgetAll() {
        load();
        ids.clear();
        overflow = false;
        save();
    }

    synchronized int size() {
        load();
        return ids.size();
    }
}
