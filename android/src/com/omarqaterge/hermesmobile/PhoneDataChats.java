package com.omarqaterge.hermesmobile;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;

/**
 * The app's own record of which chats have asked to read phone data (docs/decisions/phone-data-read-only.md, "Chats that
 * have read phone data"). {@code POST /phonedata} adds the chat id of every read request, whatever its outcome, and the
 * page asks {@code phoneDataTainted(id)} before it draws a chat, so a chat whose {@code phone_data} call is not among the
 * items on screen (a long chat, a cached preview, a parent of a subagent that read) is still known. The agent cannot edit
 * it: it lives in the app's private preferences. Ids only, never data; at most {@link #MAX} (the oldest is dropped), and it
 * survives a restart. Plain Java (the persistence is a {@link Store}) so tools/test_phone_data_chats.sh tests it on a JDK.
 */
final class PhoneDataChats {
    static final int MAX = 2000;
    static final int MAX_ID = 128;
    /** The most ids one read request may add besides its own session (the chat and its ancestors). */
    static final int MAX_LIST = 8;

    /** Where the ids are kept: one text, one id per line. */
    interface Store {
        String load();
        void save(String text);
    }

    private final Store store;
    private final LinkedHashSet<String> ids = new LinkedHashSet<>(); // oldest first
    private boolean loaded;

    PhoneDataChats(Store store) {
        this.store = store;
    }

    /** A usable id: a non-empty string of at most 128 characters with no control characters (it is stored one per line). */
    static boolean validId(Object o) {
        if (!(o instanceof String)) return false;
        String s = (String) o;
        if (s.isEmpty() || s.length() > MAX_ID) return false;
        for (int i = 0; i < s.length(); i++) if (Character.isISOControl(s.charAt(i)) || s.charAt(i) == ' ' || s.charAt(i) == ' ') return false;
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
        for (String line : t.split("\n")) if (validId(line)) ids.add(line);
        while (ids.size() > MAX) ids.remove(ids.iterator().next());
    }

    /** Remember these chats: the session, and the extra list when it is a list (each valid entry; up to {@link #MAX_LIST}). Never throws. */
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
            for (String id : add) {
                if (ids.contains(id)) {
                    String last = null;
                    for (String x : ids) last = x;
                    if (id.equals(last)) continue;
                    ids.remove(id); // move to the end: it counts as the newest
                }
                ids.add(id);
                changed = true;
            }
            while (ids.size() > MAX) ids.remove(ids.iterator().next());
            if (changed) store.save(String.join("\n", ids));
        } catch (Throwable ignored) {
            // the record is best effort; a failed save leaves the in-memory set
        }
    }

    /** Has this chat id asked to read phone data? Answered from memory. */
    synchronized boolean contains(String id) {
        if (!validId(id)) return false;
        load();
        return ids.contains(id);
    }

    synchronized int size() {
        load();
        return ids.size();
    }
}
