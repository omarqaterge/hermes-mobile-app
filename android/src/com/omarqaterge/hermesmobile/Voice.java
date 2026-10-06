package com.omarqaterge.hermesmobile;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Locale;

/**
 * Read-aloud (TextToSpeech) and dictation (SpeechRecognizer) for the web UI. Results go back to the page
 * as window.__hmVoice(kind, text): tts-start | tts-done | ready | partial | final | error | end.
 * All methods must be called on the main thread.
 */
final class Voice {
    static final int REQ_MIC = 9;
    // Short utterances: onStart/onDone follow the audio, so the page times the player's position from them
    // (onRangeStart fires while the engine synthesizes, far ahead of what is heard). Also under the ~4000 char limit.
    private static final int CHUNK = 250;

    private final android.content.Context ctx;
    private final MainActivity a; // null when used by the background service (read-aloud only)
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private String ttsEngine = null; // package the current instance was created with (null = system default)
    private String pendingSpeech = null;
    private final java.util.Map<String, Integer> chunkBase = new java.util.HashMap<>(); // utterance id → offset of its text in the whole
    private final java.util.Map<String, Integer> chunkLen = new java.util.HashMap<>(); // utterance id → its length
    private Runnable afterReady = null;
    // last config from the page: engine package, voice name, speech rate, pitch
    private String cfgEngine = null, cfgVoice = null;
    private float cfgRate = 1f, cfgPitch = 1f;
    private SpeechRecognizer sr;
    private boolean listenAfterPermission = false;

    Voice(MainActivity a) {
        this.a = a;
        this.ctx = a;
    }

    /** Read-aloud only, for the background service (no page, no microphone). */
    Voice(android.content.Context ctx) {
        this.a = null;
        this.ctx = ctx;
    }

    private void js(String kind, String text) {
        if (a == null) return;
        final String code = "window.__hmVoice&&window.__hmVoice(" + JSONObject.quote(kind) + "," + JSONObject.quote(text == null ? "" : text) + ")";
        a.runOnUiThread(() -> a.web.evaluateJavascript(code, null));
    }

    // ── read aloud ──────────────────────────────────────────
    /** Applies the page's voice settings: {"engine":pkg|"","voice":name|"","rate":1.0,"pitch":1.0}. */
    private void applyConfig(String cfg) {
        try {
            JSONObject o = new JSONObject(cfg == null || cfg.isEmpty() ? "{}" : cfg);
            String eng = o.optString("engine", "");
            cfgEngine = eng.isEmpty() ? null : eng;
            cfgVoice = o.optString("voice", "");
            cfgRate = (float) Math.max(0.3, Math.min(3.0, o.optDouble("rate", 1.0)));
            cfgPitch = (float) Math.max(0.3, Math.min(2.5, o.optDouble("pitch", 1.0)));
        } catch (Exception ignored) {
        }
    }

    /** (Re)creates TextToSpeech when needed, then runs `then` once it is ready. */
    private void withTts(Runnable then) {
        boolean sameEngine = java.util.Objects.equals(ttsEngine, cfgEngine);
        if (tts != null && ttsReady && sameEngine) {
            then.run();
            return;
        }
        afterReady = then;
        if (tts != null && sameEngine) return; // still initialising
        if (tts != null) {
            tts.shutdown();
            tts = null;
            ttsReady = false;
        }
        ttsEngine = cfgEngine;
        final TextToSpeech[] holder = new TextToSpeech[1];
        TextToSpeech.OnInitListener init = status -> {
            TextToSpeech me = holder[0] != null ? holder[0] : tts;
            ttsReady = status == TextToSpeech.SUCCESS;
            if (!ttsReady) {
                js("error", "tts-unavailable");
                return;
            }
            me.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                @Override public void onStart(String id) { Integer base = chunkBase.get(id);
                    Integer len = chunkLen.get(id);
                    if (base != null && len != null) js("tts-seg", base + "," + len);
                    js("tts-start", id); }
                @Override public void onDone(String id) { if (id.endsWith("-last")) js("tts-done", ""); }
                @Override public void onError(String id) { js("tts-done", ""); }
            });
            Runnable r = afterReady;
            afterReady = null;
            if (r != null) r.run();
        };
        tts = cfgEngine == null ? new TextToSpeech(ctx, init) : new TextToSpeech(ctx, init, cfgEngine);
        holder[0] = tts;
    }

    private void configureTts() {
        tts.setSpeechRate(cfgRate);
        tts.setPitch(cfgPitch);
        boolean set = false;
        if (cfgVoice != null && !cfgVoice.isEmpty()) {
            try {
                for (android.speech.tts.Voice v : tts.getVoices()) {
                    if (v.getName().equals(cfgVoice)) {
                        set = tts.setVoice(v) == TextToSpeech.SUCCESS;
                        break;
                    }
                }
            } catch (Exception ignored) {
            }
        }
        if (!set) tts.setLanguage(Locale.getDefault());
    }

    void speak(String text, String cfg) {
        if (text == null || text.trim().isEmpty()) return;
        if (text.length() > 40000) text = text.substring(0, 40000);
        applyConfig(cfg);
        final String t = text;
        withTts(() -> {
            configureTts();
            speakNow(t);
        });
    }

    /** Sends the installed engines and voices of `engine` to the page as JSON via 'voices'. */
    void listVoices(String cfg) {
        applyConfig(cfg);
        withTts(() -> {
            try {
                JSONObject out = new JSONObject();
                org.json.JSONArray engines = new org.json.JSONArray();
                for (TextToSpeech.EngineInfo e : tts.getEngines())
                    engines.put(new JSONObject().put("name", e.name).put("label", e.label));
                out.put("engines", engines);
                out.put("defaultEngine", tts.getDefaultEngine());
                out.put("engine", ttsEngine == null ? tts.getDefaultEngine() : ttsEngine);
                java.util.ArrayList<android.speech.tts.Voice> vs = new java.util.ArrayList<>();
                java.util.Set<android.speech.tts.Voice> all = tts.getVoices();
                if (all != null) vs.addAll(all);
                java.util.Collections.sort(vs, (x, y) -> {
                    int c = x.getLocale().getDisplayName().compareTo(y.getLocale().getDisplayName());
                    return c != 0 ? c : x.getName().compareTo(y.getName());
                });
                org.json.JSONArray arr = new org.json.JSONArray();
                for (android.speech.tts.Voice v : vs) {
                    if (v.getFeatures() != null && v.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)) continue;
                    arr.put(new JSONObject()
                            .put("name", v.getName())
                            .put("locale", v.getLocale().toLanguageTag())
                            .put("label", v.getLocale().getDisplayName())
                            .put("quality", v.getQuality())
                            .put("online", v.isNetworkConnectionRequired()));
                }
                out.put("voices", arr);
                js("voices", out.toString());
            } catch (Exception e) {
                js("error", "voices-failed");
            }
        });
    }

    private void speakNow(String text) {
        ArrayList<String> parts = new ArrayList<>();
        String rest = text.trim();
        while (rest.length() > CHUNK) {
            int cut = Math.max(rest.lastIndexOf(". ", CHUNK), Math.max(rest.lastIndexOf("\n", CHUNK), rest.lastIndexOf(" ", CHUNK)));
            if (cut < CHUNK / 2) cut = CHUNK;
            parts.add(rest.substring(0, cut + 1).trim());
            rest = rest.substring(cut + 1).trim();
        }
        if (!rest.isEmpty()) parts.add(rest);
        chunkBase.clear();
        chunkLen.clear();
        int from = 0;
        for (int i = 0; i < parts.size(); i++) {
            String id = "hm" + System.nanoTime() + (i == parts.size() - 1 ? "-last" : "");
            int at = text.indexOf(parts.get(i), from);
            if (at >= 0) {
                chunkBase.put(id, at);
                chunkLen.put(id, parts.get(i).length());
                from = at + parts.get(i).length();
            }
            tts.speak(parts.get(i), i == 0 ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD, null, id);
        }
    }

    void stopSpeaking() {
        pendingSpeech = null;
        if (tts != null) tts.stop();
        js("tts-done", "");
    }

    /** Markdown → text a voice can read (port of speakable() in voice.ts). */
    static String speakable(String md) {
        if (md == null) return "";
        String t = md;
        t = t.replaceAll("(?s)```.*?```", " (code omitted). ");
        t = t.replaceAll("(?m)^\\s*MEDIA:.*$", "");
        t = t.replaceAll("!\\[[^\\]]*\\]\\([^)]*\\)", "");
        t = t.replaceAll("\\[([^\\]]+)\\]\\([^)]*\\)", "$1");
        t = t.replaceAll("`([^`]+)`", "$1");
        t = t.replaceAll("(?m)^\\s{0,3}#{1,6}\\s+", "");
        t = t.replaceAll("(?m)^\\s*[-*+]\\s+", "");
        t = t.replaceAll("(?m)^\\s*\\d+\\.\\s+", "");
        t = t.replaceAll("(?m)^\\s*>\\s?", "");
        t = t.replaceAll("(?m)^\\s*\\|.*\\|\\s*$", "");
        t = t.replaceAll("(?m)^[-=*_]{3,}\\s*$", "");
        t = t.replaceAll("[*_~]{1,3}([^*_~\\n]+)[*_~]{1,3}", "$1");
        t = t.replaceAll("https?://\\S+", "link");
        t = t.replaceAll("[\\x{1F000}-\\x{1FFFF}\\x{2600}-\\x{27BF}\\x{FE0F}]", "");
        t = t.replaceAll("\\n{2,}", ".\n");
        t = t.replaceAll("[ \\t]+", " ");
        return t.trim();
    }

    // ── dictation ───────────────────────────────────────────
    private boolean continuous = false; // keep listening (restart after each pause) until stopListening()
    private int failures = 0; // consecutive real errors, to avoid a tight failure loop
    private final android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable restart = this::beginRecognition;
    private final Runnable forceEnd = () -> finishListening();

    // Which recogniser to use: null = the phone's default (Settings → voice input). A missing or broken default made every
    // dictation fail at once ("stt-5" on older Android, "stt-10" on newer), even with a working recogniser installed, so
    // when the current one fails before it ever listened we try the others (Google's first) and remember the one that works.
    private android.content.ComponentName recognizer = null;
    private final ArrayList<android.content.ComponentName> tried = new ArrayList<>();
    private boolean triedDefault = false;
    private boolean recognizerWorked = false; // the current recogniser got as far as listening this session
    private static final String PREF_RECOGNIZER = "recognizer";

    void startListening() {
        if (a.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            listenAfterPermission = true;
            a.requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_MIC);
            return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(a) && installedRecognizers().isEmpty()) {
            js("error", "stt-unavailable");
            js("end", "");
            return;
        }
        stopSpeaking(); // don't listen to ourselves
        continuous = true;
        failures = 0;
        main.removeCallbacks(forceEnd);
        main.removeCallbacks(restart);
        tried.clear();
        recognizer = savedRecognizer(); // one that worked before, when the default didn't
        triedDefault = recognizer == null;
        if (recognizer != null) tried.add(recognizer);
        newRecognizer();
        beginRecognition();
    }

    private void newRecognizer() {
        if (sr != null) sr.destroy();
        recognizerWorked = false;
        sr = recognizer == null ? SpeechRecognizer.createSpeechRecognizer(a) : SpeechRecognizer.createSpeechRecognizer(a, recognizer);
        sr.setRecognitionListener(listener);
    }

    /** Installed speech recognition services, Google's first. */
    private ArrayList<android.content.ComponentName> installedRecognizers() {
        ArrayList<android.content.ComponentName> out = new ArrayList<>();
        try {
            for (android.content.pm.ResolveInfo r : a.getPackageManager().queryIntentServices(
                    new Intent(android.speech.RecognitionService.SERVICE_INTERFACE), 0)) {
                if (r.serviceInfo != null) out.add(new android.content.ComponentName(r.serviceInfo.packageName, r.serviceInfo.name));
            }
        } catch (Exception ignored) { }
        out.sort((x, y) -> rank(x) - rank(y));
        return out;
    }

    private static int rank(android.content.ComponentName c) {
        String p = c.getPackageName();
        return p.equals("com.google.android.googlequicksearchbox") ? 0 : p.equals("com.google.android.tts") ? 1 : p.startsWith("com.google.") ? 2 : 3;
    }

    private android.content.ComponentName defaultRecognizer() {
        try {
            String v = android.provider.Settings.Secure.getString(a.getContentResolver(), "voice_recognition_service");
            return v == null || v.isEmpty() ? null : android.content.ComponentName.unflattenFromString(v);
        } catch (Exception e) {
            return null;
        }
    }

    private android.content.ComponentName savedRecognizer() {
        String v = a.getSharedPreferences("voice", 0).getString(PREF_RECOGNIZER, null);
        android.content.ComponentName c = v == null ? null : android.content.ComponentName.unflattenFromString(v);
        return c != null && installedRecognizers().contains(c) ? c : null;
    }

    /** The current recogniser can't be used: switch to the next one not tried yet. False when none is left. */
    private boolean tryNextRecognizer() {
        android.content.ComponentName next = null;
        if (!triedDefault) {
            triedDefault = true;
            next = null; // the phone's default
        } else {
            android.content.ComponentName def = defaultRecognizer();
            for (android.content.ComponentName c : installedRecognizers()) {
                if (!tried.contains(c) && !c.equals(def)) { next = c; break; }
            }
            if (next == null) return false;
            tried.add(next);
        }
        recognizer = next;
        failures = 0;
        newRecognizer();
        main.postDelayed(restart, 200);
        return true;
    }

    private final RecognitionListener listener = new RecognitionListener() {
        @Override public void onReadyForSpeech(Bundle b) {
            if (!recognizerWorked) {
                recognizerWorked = true;
                // remember a fallback that works; forget it again once the default is the one working
                a.getSharedPreferences("voice", 0).edit()
                        .putString(PREF_RECOGNIZER, recognizer == null ? null : recognizer.flattenToString()).apply();
            }
            js("ready", "");
        }
        @Override public void onBeginningOfSpeech() {}
        @Override public void onRmsChanged(float v) {}
        @Override public void onBufferReceived(byte[] b) {}
        @Override public void onEndOfSpeech() {}
        @Override public void onEvent(int t, Bundle b) {}
        @Override public void onError(int code) {
            if (!continuous) {
                finishListening(); // the user stopped it
                return;
            }
            // 7 = nothing recognised, 6 = silence: normal while waiting for you to speak, just listen again
            if (code == SpeechRecognizer.ERROR_NO_MATCH || code == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                main.postDelayed(restart, 200);
                return;
            }
            // 4 server, 5 client, 9 the recogniser lacks permissions, 10+ can't bind / language missing: this
            // recogniser is unusable here. If it never listened, move on to another one straight away.
            boolean unusable = code == SpeechRecognizer.ERROR_CLIENT || code == SpeechRecognizer.ERROR_SERVER
                    || code == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS || code >= 10;
            if (unusable && !recognizerWorked && tryNextRecognizer()) return;
            // busy / client hiccups of a recogniser that did work: retry a few times on a fresh instance
            if ((code == SpeechRecognizer.ERROR_RECOGNIZER_BUSY || code == SpeechRecognizer.ERROR_CLIENT) && ++failures <= 4) {
                main.postDelayed(() -> {
                    if (!continuous) return;
                    newRecognizer();
                    beginRecognition();
                }, 600);
                return;
            }
            if (unusable && tryNextRecognizer()) return;
            js("error", "stt-" + code);
            finishListening();
        }
        @Override public void onPartialResults(Bundle b) {
            String t = first(b);
            if (t != null) js("partial", t);
        }
        @Override public void onResults(Bundle b) {
            failures = 0;
            String t = first(b);
            if (t != null) js("final", t);
            if (continuous) main.postDelayed(restart, 150); // more to come: stay on until the user stops
            else finishListening();
        }
    };

    private void beginRecognition() {
        if (!continuous || sr == null) return;
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, a.getPackageName())
                // ask the recogniser to wait through long pauses (some engines ignore these; we restart anyway)
                .putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 30000L)
                .putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 30000L);
        try {
            sr.startListening(i);
        } catch (Exception e) {
            if (!recognizerWorked && tryNextRecognizer()) return;
            js("error", "stt-start");
            finishListening();
        }
    }

    private void finishListening() {
        continuous = false;
        main.removeCallbacks(restart);
        main.removeCallbacks(forceEnd);
        if (sr != null) {
            sr.destroy();
            sr = null;
        }
        js("end", "");
    }

    private static String first(Bundle b) {
        ArrayList<String> l = b == null ? null : b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return l == null || l.isEmpty() ? null : l.get(0);
    }

    /** The user pressed stop (or left the app): finish the current phrase, then end. */
    void stopListening() {
        if (!continuous && sr == null) return;
        continuous = false;
        main.removeCallbacks(restart);
        if (sr != null) sr.stopListening(); // delivers the last words via onResults / onError, which then end the session
        main.postDelayed(forceEnd, 2000); // in case the engine never calls back
    }

    void onPermission(int[] results) {
        boolean ok = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        if (listenAfterPermission) {
            listenAfterPermission = false;
            if (ok) startListening();
            else {
                js("error", "mic-denied");
                js("end", "");
            }
        }
    }

    void destroy() {
        continuous = false;
        main.removeCallbacksAndMessages(null);
        if (sr != null) sr.destroy();
        if (tts != null) tts.shutdown();
    }
}
