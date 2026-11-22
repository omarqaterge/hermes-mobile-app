package com.omarqaterge.hermesmobile;

import java.util.ArrayList;
import java.util.List;

/**
 * Which approvals and questions the status chip is waiting on, kept per chat and request. Pure bookkeeping (no Android
 * imports) so a plain JDK can test it: it never answers, confirms or authorises anything; HermesService still sends
 * answers through the same paths and only asks this class which request the chip shows.
 *
 * Entries are kept in arrival order; the chip shows the oldest of a kind (it is also the one that expires first).
 * A "clear" from the plugin names its chat but not a request: it drops that chat's entries of that kind only, and
 * falls back to the old rule (every entry of the kind) when it names no chat, as an older plugin's event would.
 */
final class PendingAsk<T> {
    static final String APPROVAL = "approval";
    static final String ASK = "ask";

    /** One waiting request: the payload is whatever the caller shows (HermesService keeps the plugin's event). */
    static final class Entry<T> {
        final String kind, session, id;
        final T payload;
        final long deadline; // epoch ms after which the request no longer waits
        Entry(String kind, String session, String id, T payload, long deadline) {
            this.kind = kind; this.session = session; this.id = id; this.payload = payload; this.deadline = deadline;
        }
    }

    private final List<Entry<T>> list = new ArrayList<>();

    private static String s(String v) { return v == null ? "" : v; }

    /** A request arrived. The same chat and request id again (a repeat) replaces its entry in place; a question
     *  replaces its chat's earlier question (a chat asks one at a time); a different approval is added after the others. */
    void arrived(String kind, String session, String id, T payload, long deadline) {
        Entry<T> n = new Entry<>(kind, s(session), s(id), payload, deadline);
        for (int i = 0; i < list.size(); i++) {
            Entry<T> o = list.get(i);
            if (o.kind.equals(n.kind) && o.session.equals(n.session) && (ASK.equals(kind) || o.id.equals(n.id))) {
                list.set(i, n);
                return;
            }
        }
        list.add(n);
    }

    /** The plugin's clear for a kind: drops that chat's entries of the kind, or all of the kind when no chat is named.
     *  Returns whether anything was dropped. */
    boolean cleared(String kind, String session) {
        return remove(kind, session, null);
    }

    /** An answer was sent for this chat's request (id empty: every one of the chat's kind, as for a clear). */
    boolean answered(String kind, String session, String id) {
        return remove(kind, session, s(id).isEmpty() ? null : id);
    }

    private boolean remove(String kind, String session, String id) {
        boolean any = false;
        for (int i = list.size() - 1; i >= 0; i--) {
            Entry<T> o = list.get(i);
            if (!o.kind.equals(kind)) continue;
            if (!s(session).isEmpty() && !o.session.equals(session)) continue;
            if (id != null && !o.id.equals(id)) continue;
            list.remove(i);
            any = true;
        }
        return any;
    }

    /** Drops what ran past its deadline plus {@code graceMs}; returns whether anything was dropped. */
    boolean expire(long now, long graceMs) {
        return !expired(now, graceMs).isEmpty();
    }

    /** The same as {@link #expire}, returning the entries it dropped (oldest first), so the caller can tell which
     *  question ran out of time. */
    List<Entry<T>> expired(long now, long graceMs) {
        List<Entry<T>> gone = new ArrayList<>();
        for (int i = list.size() - 1; i >= 0; i--) {
            if (now > list.get(i).deadline + graceMs) gone.add(0, list.remove(i));
        }
        return gone;
    }

    /** The entry of this kind the chip shows now (the oldest), or null. */
    Entry<T> shown(String kind) {
        for (Entry<T> o : list) if (o.kind.equals(kind)) return o;
        return null;
    }

    /** How many of this kind are waiting. */
    int count(String kind) {
        int n = 0;
        for (Entry<T> o : list) if (o.kind.equals(kind)) n++;
        return n;
    }
}
