package com.omarqaterge.hermesmobile;

import com.omarqaterge.hermesmobile.phonedata.Caps;

import org.json.JSONObject;

import java.text.DateFormat;
import java.util.Date;
import java.util.Iterator;

/**
 * What the user is asked to allow when the agent wants to read the phone, written by the app from the decoded args and
 * never from the plugin's text (the page does the same in web/src/phone-data-request.ts; keep the two in step). Text that
 * came from the request is cleaned ({@link #clean}) and always sits in [square brackets], which cleaning makes impossible
 * to close from inside. No Android classes beyond org.json, so tools/test_phone_data_grants.sh tests it with a JDK.
 */
final class PhoneDataWording {
    private PhoneDataWording() {}

    /** What Hermes names the "command" of a plugin approval for the tool phone_data. Only a request with this command
     *  and a phone_data description is a phone-data request; a shell command that merely mentions it is not. */
    static final String COMMAND = "<phone_data> (plugin approval rule)";
    static final String WARNING = "Hermux got a phone data request it can't read, so it can't be allowed. Deny it.";
    static final int SHOWN_MAX = 40;

    /** The phone-data text of an approval event's description and command, or null for any other approval. */
    static String rawOf(String description, String command) {
        return description != null && PhoneDataGrants.isPhoneData(description) && COMMAND.equals(command) ? description : null;
    }

    /** Request text made safe to show: control, invisible and format characters (C1 included), every quote mark and
     *  bracket removed, spaces collapsed, cut to {@link #SHOWN_MAX} characters. */
    static String clean(String s) {
        String t = Caps.text(s, 400).replace("‍", "");
        StringBuilder b = new StringBuilder();
        for (int i = 0; i < t.length(); ) {
            int cp = t.codePointAt(i);
            i += Character.charCount(cp);
            if (isQuoteOrBracket(cp)) continue;
            b.appendCodePoint(cp);
        }
        t = b.toString().replaceAll("\\s+", " ").trim();
        if (t.codePointCount(0, t.length()) > SHOWN_MAX) t = t.substring(0, t.offsetByCodePoints(0, SHOWN_MAX)).trim() + "…";
        return t;
    }

    private static boolean isQuoteOrBracket(int c) {
        return c == '"' || c == '\'' || c == '`' || (c >= 0x2018 && c <= 0x201F) || c == 0x2039 || c == 0x203A || c == 0xAB || c == 0xBB
                || (c >= 0x300C && c <= 0x300F) || (c >= 0x301D && c <= 0x301F) || c == 0xFF02 || c == 0xFF07
                || c == '<' || c == '>' || c == '[' || c == ']' || c == '{' || c == '}';
    }

    private static String mark(String s) {
        return "[" + s + "]";
    }

    /** The sentence for a phone-data approval text, or null when it doesn't parse or its args are not exactly the
     *  contract's (then the app offers Deny only). */
    static String wording(String description) {
        PhoneDataGrants.Parsed p = PhoneDataGrants.parse(description);
        if (p == null) return null;
        try {
            JSONObject a = new JSONObject(p.args);
            String[] allowed = allowedKeys(p.kind);
            for (Iterator<String> it = a.keys(); it.hasNext(); ) {
                String key = it.next();
                boolean ok = false;
                for (String x : allowed) ok |= x.equals(key);
                if (!ok) return null;
            }
            int limit = 20;
            if (a.has("limit")) {
                Object l = a.get("limit");
                if (!(l instanceof Integer) || (Integer) l < 1 || (Integer) l > 50) return null;
                limit = (Integer) l;
            }
            String query = text(a, "query");
            String sender = text(a, "sender");
            if ((a.has("query") && query == null) || (a.has("sender") && sender == null)) return null;
            Long from = ms(a, "from_ms"), to = ms(a, "to_ms");
            if ((a.has("from_ms") && from == null) || (a.has("to_ms") && to == null)) return null;
            String box = "all";
            if (a.has("box")) {
                Object b = a.get("box");
                if (!(b instanceof String) || !("inbox".equals(b) || "sent".equals(b) || "all".equals(b))) return null;
                box = (String) b;
            }
            switch (p.kind) {
                case "contacts":
                    return "Read up to " + limit + (limit == 1 ? " contact" : " contacts")
                            + (!query.isEmpty() ? " whose name has " + mark(query) : "") + " from your address book";
                case "calendar":
                    return "Read up to " + limit + (limit == 1 ? " calendar event" : " calendar events")
                            + range(from, to, "now", "the end of the default range (7 days from the start)", "in the next 7 days");
                case "calls":
                    return "Read up to " + limit + (limit == 1 ? " call log entry" : " call log entries")
                            + range(from, to, "7 days before the end", "now", "from the last 7 days");
                case "sms":
                    return "Read up to " + limit + (limit == 1 ? " text message" : " text messages")
                            + ("inbox".equals(box) ? " you received" : "sent".equals(box) ? " you sent" : "")
                            + (!sender.isEmpty() ? " from or to " + mark(sender) : "");
                case "location":
                    return "Read your approximate location";
                case "photos":
                    return "Read the date, size and dimensions of your latest " + limit + (limit == 1 ? " photo" : " photos") + " (no pictures)";
                default:
                    return null;
            }
        } catch (Exception e) {
            return null;
        }
    }

    private static String[] allowedKeys(String kind) {
        switch (kind) {
            case "contacts": return new String[]{"limit", "query"};
            case "calendar":
            case "calls": return new String[]{"limit", "from_ms", "to_ms"};
            case "sms": return new String[]{"limit", "box", "sender"};
            case "photos": return new String[]{"limit"};
            default: return new String[0];
        }
    }

    /** A string arg of at most 64 characters, cleaned; "" if absent; null if present but not that. */
    private static String text(JSONObject a, String key) {
        if (!a.has(key)) return "";
        Object v = a.opt(key);
        if (!(v instanceof String) || ((String) v).length() > Caps.MAX_QUERY) return null;
        return clean((String) v);
    }

    private static Long ms(JSONObject a, String key) {
        if (!a.has(key)) return null;
        Object v = a.opt(key);
        if (v instanceof Integer) return ((Integer) v).longValue();
        if (v instanceof Long) return (Long) v;
        return null;
    }

    private static String range(Long from, Long to, String fromDefault, String toDefault, String dflt) {
        if (from == null && to == null) return " " + dflt;
        DateFormat f = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT);
        return " between " + (from == null ? fromDefault : f.format(new Date(from))) + " and " + (to == null ? toDefault : f.format(new Date(to)));
    }

    /** The text of a phone-data approval notification: the wording, or a warning when the request can't be read. */
    static String notificationText(String description) {
        String w = wording(description);
        return w != null ? w + "?" : WARNING;
    }
}
