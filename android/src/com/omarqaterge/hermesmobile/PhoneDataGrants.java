package com.omarqaterge.hermesmobile;

/**
 * What lets one phone-data read through: a one-use grant from a real tap on Allow in the app, or the app's own record
 * that the user put this chat in Full access. Nothing the agent writes can create either
 * (docs/decisions/phone-data-read-only.md). Until this is built it refuses everything.
 */
final class PhoneDataGrants {
    private PhoneDataGrants() {}

    /** The user tapped Allow on this approval (its description, in the contract's format). False if it isn't one. */
    static boolean issue(String description) {
        return false;
    }

    /** Uses up the grant for exactly this nonce, kind and args text; true when one was live. */
    static boolean consume(String nonce, String kind, String args) {
        return false;
    }

    /** The user moved this chat into or out of Full access in the app. Memory only: a restart forgets it. */
    static void fullAccess(String session, boolean on) {}

    static boolean hasFullAccess(String session) {
        return false;
    }
}
