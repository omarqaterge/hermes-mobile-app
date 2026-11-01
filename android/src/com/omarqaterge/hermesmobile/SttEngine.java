package com.omarqaterge.hermesmobile;

import com.k2fsa.sherpa.onnx.EndpointConfig;
import com.k2fsa.sherpa.onnx.EndpointRule;
import com.k2fsa.sherpa.onnx.OfflineModelConfig;
import com.k2fsa.sherpa.onnx.OfflineMoonshineModelConfig;
import com.k2fsa.sherpa.onnx.OfflineRecognizer;
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig;
import com.k2fsa.sherpa.onnx.OfflineSenseVoiceModelConfig;
import com.k2fsa.sherpa.onnx.OfflineStream;
import com.k2fsa.sherpa.onnx.OfflineTransducerModelConfig;
import com.k2fsa.sherpa.onnx.OfflineWhisperModelConfig;
import com.k2fsa.sherpa.onnx.OnlineModelConfig;
import com.k2fsa.sherpa.onnx.OnlineRecognizer;
import com.k2fsa.sherpa.onnx.OnlineRecognizerConfig;
import com.k2fsa.sherpa.onnx.OnlineStream;
import com.k2fsa.sherpa.onnx.OnlineTransducerModelConfig;
import com.k2fsa.sherpa.onnx.SileroVadModelConfig;
import com.k2fsa.sherpa.onnx.SpeechSegment;
import com.k2fsa.sherpa.onnx.Vad;
import com.k2fsa.sherpa.onnx.VadModelConfig;

import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.ArrayDeque;
import java.util.Arrays;

/**
 * One loaded on-device speech model (sherpa-onnx) and the decoding around it, used by LocalStt (dictation, in the app's
 * process) and SttProbe (the first load and "Test model", in a process of its own). A model folder holds the model's files
 * and model.json: {id, name, kind, roles: {encoder, decoder, joiner, mergedDecoder, tokens, …}, punctuation}.
 * Audio is 16 kHz mono floats. Not thread-safe: one thread uses an engine at a time.
 */
final class SttEngine {
    static final int RATE = 16000;
    private static final int THREADS = 2; // a phone's big cores: faster than 1, and more barely helps while costing battery
    private static final int WINDOW = 512; // Silero VAD's window at 16 kHz
    private static final float MAX_PHRASE_S = 8f; // Moonshine v2 gives nothing past ~9 s: the VAD cuts longer speech

    final String kind;
    final boolean punctuation;
    private OnlineRecognizer online;
    private OfflineRecognizer offline;
    private Vad vad;

    interface Out {
        void partial(String text);
        void phrase(String text);
    }

    private SttEngine(String kind, boolean punctuation) {
        this.kind = kind;
        this.punctuation = punctuation;
    }

    static JSONObject meta(File dir) throws Exception {
        return new JSONObject(new String(readAll(new File(dir, "model.json")), "UTF-8"));
    }

    /** Builds the recogniser for the model in `dir` (vadModel: Silero's file, for models that aren't streaming). */
    static SttEngine load(File dir, File vadModel) throws Exception {
        JSONObject m = meta(dir);
        JSONObject r = m.getJSONObject("roles");
        String kind = m.getString("kind");
        SttEngine e = new SttEngine(kind, m.optBoolean("punctuation", SttModels.punctuates(kind)));
        String tokens = path(dir, r, "tokens");
        if (SttModels.ONLINE.equals(kind)) {
            OnlineTransducerModelConfig t = OnlineTransducerModelConfig.builder()
                    .setEncoder(path(dir, r, "encoder")).setDecoder(path(dir, r, "decoder")).setJoiner(path(dir, r, "joiner")).build();
            OnlineModelConfig mc = OnlineModelConfig.builder().setTransducer(t).setTokens(tokens).setNumThreads(THREADS).setDebug(false).build();
            // a phrase ends after 0.8 s of silence once something was said (2.4 s if nothing was), or at 20 s
            EndpointConfig ep = EndpointConfig.builder()
                    .setRule1(EndpointRule.builder().setMustContainNonSilence(false).setMinTrailingSilence(2.4f).setMinUtteranceLength(0).build())
                    .setRule2(EndpointRule.builder().setMustContainNonSilence(true).setMinTrailingSilence(0.8f).setMinUtteranceLength(0).build())
                    .setRule3(EndpointRule.builder().setMustContainNonSilence(false).setMinTrailingSilence(0).setMinUtteranceLength(20).build())
                    .build();
            e.online = new OnlineRecognizer(OnlineRecognizerConfig.builder().setOnlineModelConfig(mc)
                    .setEndpointConfig(ep).setEnableEndpoint(true).setDecodingMethod("greedy_search").build());
            return e;
        }
        OfflineModelConfig.Builder mc = OfflineModelConfig.builder().setTokens(tokens).setNumThreads(THREADS).setDebug(false);
        switch (kind) {
            case SttModels.MOONSHINE:
                OfflineMoonshineModelConfig.Builder ms = OfflineMoonshineModelConfig.builder().setEncoder(path(dir, r, "encoder"));
                if (r.has("mergedDecoder")) ms.setMergedDecoder(path(dir, r, "mergedDecoder"));
                else ms.setPreprocessor(path(dir, r, "preprocessor"))
                        .setUncachedDecoder(path(dir, r, "uncachedDecoder")).setCachedDecoder(path(dir, r, "cachedDecoder"));
                mc.setMoonshine(ms.build());
                break;
            case SttModels.OFFLINE:
                mc.setTransducer(OfflineTransducerModelConfig.builder()
                        .setEncoder(path(dir, r, "encoder")).setDecoder(path(dir, r, "decoder")).setJoiner(path(dir, r, "joiner")).build());
                break;
            case SttModels.WHISPER:
                mc.setWhisper(OfflineWhisperModelConfig.builder()
                        .setEncoder(path(dir, r, "encoder")).setDecoder(path(dir, r, "decoder")).setTask("transcribe").build());
                break;
            case SttModels.SENSE_VOICE:
                mc.setSenseVoice(OfflineSenseVoiceModelConfig.builder().setModel(path(dir, r, "model"))
                        .setLanguage("auto").setInverseTextNormalization(true).build());
                break;
            default:
                throw new IOException("unknown model kind " + kind);
        }
        e.offline = new OfflineRecognizer(OfflineRecognizerConfig.builder().setOfflineModelConfig(mc.build())
                .setDecodingMethod("greedy_search").build());
        if (vadModel != null) {
            SileroVadModelConfig s = SileroVadModelConfig.builder().setModel(vadModel.getAbsolutePath())
                    .setThreshold(0.5f).setMinSilenceDuration(0.5f).setMinSpeechDuration(0.25f)
                    .setMaxSpeechDuration(MAX_PHRASE_S).setWindowSize(WINDOW).build();
            e.vad = new Vad(VadModelConfig.builder().setSileroVadModelConfig(s).setSampleRate(RATE).setNumThreads(1).setDebug(false).build());
        }
        return e;
    }

    private static String path(File dir, JSONObject roles, String role) throws Exception {
        File f = new File(dir, roles.getString(role));
        if (!f.isFile()) throw new IOException("missing " + f.getName());
        return f.getAbsolutePath();
    }

    void release() {
        if (online != null) online.release();
        if (offline != null) offline.release();
        if (vad != null) vad.release();
        online = null;
        offline = null;
        vad = null;
    }

    private String tidy(String t) {
        return SttModels.tidy(t, punctuation);
    }

    private String decodeOffline(float[] samples) {
        OfflineStream st = offline.createStream();
        try {
            st.acceptWaveform(samples, RATE);
            offline.decode(st);
            return tidy(offline.getResult(st).getText());
        } finally {
            st.release();
        }
    }

    /** A whole recording (the sample in "Test model"), decoded the way dictation would. */
    String transcribe(float[] samples) {
        final StringBuilder out = new StringBuilder();
        Session s = new Session(new Out() {
            @Override public void partial(String text) {}
            @Override public void phrase(String text) {
                if (out.length() > 0) out.append(' ');
                out.append(text);
            }
        });
        for (int i = 0; i < samples.length; i += 1600) s.accept(Arrays.copyOfRange(samples, i, Math.min(samples.length, i + 1600)));
        s.finish();
        return out.toString();
    }

    /** One dictation: feed audio as it comes, then finish() for the last phrase. */
    final class Session {
        private final Out out;
        private OnlineStream stream;
        private String last = "";
        // VAD models: samples not yet a full window, the speech heard so far (for partial results) and a short pre-roll
        private final float[] pending = new float[WINDOW];
        private int pendingN = 0;
        private final ArrayDeque<float[]> speech = new ArrayDeque<>(), preroll = new ArrayDeque<>();
        private int speechN = 0, sincePartial = 0;
        /** Set by the caller while unread audio piles up (a slow phone): no previews until decoding has caught up. */
        volatile boolean behind = false;
        private static final int PARTIAL_EVERY = RATE * 3 / 2; // a preview of the phrase every 1.5 s of speech

        Session(Out out) {
            this.out = out;
            if (online != null) {
                stream = online.createStream();
                stream.acceptWaveform(new float[RATE / 4], RATE); // the first word needs a little lead-in
            } else if (vad != null) {
                vad.reset();
            }
        }

        void accept(float[] f) {
            if (online != null) {
                stream.acceptWaveform(f, RATE);
                decodeOnline(false);
                return;
            }
            if (vad == null) { // no VAD file: one phrase per session
                speech.add(f);
                speechN += f.length;
                return;
            }
            for (int i = 0; i < f.length; ) {
                int n = Math.min(WINDOW - pendingN, f.length - i);
                System.arraycopy(f, i, pending, pendingN, n);
                pendingN += n;
                i += n;
                if (pendingN == WINDOW) {
                    window(pending.clone());
                    pendingN = 0;
                }
            }
        }

        private void decodeOnline(boolean end) {
            while (online.isReady(stream)) online.decode(stream);
            String t = online.getResult(stream).getText().trim();
            if (end || online.isEndpoint(stream)) {
                if (!t.isEmpty()) out.phrase(tidy(t));
                if (!end) online.reset(stream);
                last = "";
            } else if (!t.equals(last)) {
                last = t;
                if (!t.isEmpty()) out.partial(tidy(t));
            }
        }

        private void window(float[] w) {
            vad.acceptWaveform(w);
            if (vad.isSpeechDetected()) {
                if (speech.isEmpty()) {
                    for (float[] p : preroll) {
                        speech.add(p);
                        speechN += p.length;
                    }
                    preroll.clear();
                }
                speech.add(w);
                speechN += w.length;
                sincePartial += w.length;
                if (sincePartial >= PARTIAL_EVERY && speechN < MAX_PHRASE_S * RATE && !behind) {
                    sincePartial = 0;
                    String t = SttModels.trimRepeats(decodeOffline(joined()));
                    if (!t.isEmpty()) out.partial(t);
                }
            } else {
                preroll.add(w);
                if (preroll.size() > 12) preroll.removeFirst(); // ~0.4 s
            }
            drain();
        }

        private void drain() {
            while (!vad.empty()) {
                SpeechSegment seg = vad.front();
                vad.pop();
                String t = decodeOffline(seg.getSamples());
                if (!t.isEmpty()) out.phrase(t);
                speech.clear();
                speechN = 0;
                sincePartial = 0;
            }
        }

        private float[] joined() {
            float[] all = new float[speechN];
            int at = 0;
            for (float[] p : speech) {
                System.arraycopy(p, 0, all, at, p.length);
                at += p.length;
            }
            return all;
        }

        /** The user stopped: the words still being said become the last phrase. */
        void finish() {
            if (online != null) {
                stream.acceptWaveform(new float[RATE * 2 / 5], RATE);
                stream.inputFinished();
                decodeOnline(true);
                stream.release();
                stream = null;
                return;
            }
            if (vad == null) {
                String t = speechN > 0 ? decodeOffline(joined()) : "";
                if (!t.isEmpty()) out.phrase(t);
                speech.clear();
                speechN = 0;
                return;
            }
            if (pendingN > 0) {
                float[] w = new float[WINDOW];
                System.arraycopy(pending, 0, w, 0, pendingN);
                pendingN = 0;
                vad.acceptWaveform(w);
            }
            vad.flush();
            drain();
            vad.reset();
            speech.clear();
            preroll.clear();
            speechN = 0;
        }
    }

    // ── audio helpers ────────────────────────────────────────

    static byte[] readAll(File f) throws IOException {
        try (InputStream in = new java.io.FileInputStream(f)) {
            return readAll(in);
        }
    }

    static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        byte[] buf = new byte[16384];
        for (int n; (n = in.read(buf)) > 0; ) b.write(buf, 0, n);
        return b.toByteArray();
    }

    /** 16-bit PCM WAV → floats at 16 kHz (other rates are resampled). */
    static float[] wav(byte[] b) throws IOException {
        ByteBuffer bb = ByteBuffer.wrap(b).order(ByteOrder.LITTLE_ENDIAN);
        int pos = 12, rate = RATE, channels = 1;
        while (pos + 8 <= b.length) {
            String id = new String(b, pos, 4, "US-ASCII");
            int len = bb.getInt(pos + 4);
            if (id.equals("fmt ")) {
                channels = bb.getShort(pos + 10);
                rate = bb.getInt(pos + 12);
            } else if (id.equals("data")) {
                int n = Math.min(len, b.length - pos - 8) / 2 / Math.max(1, channels);
                float[] out = new float[n];
                for (int i = 0; i < n; i++) out[i] = bb.getShort(pos + 8 + 2 * i * channels) / 32768f;
                return resample(out, rate);
            }
            pos += 8 + len + (len & 1);
        }
        throw new IOException("not a WAV file");
    }

    /** Linear resampling to 16 kHz (for microphones that don't record at 16 kHz). */
    static float[] resample(float[] in, int rate) {
        if (rate == RATE || in.length == 0) return in;
        int n = (int) ((long) in.length * RATE / rate);
        float[] out = new float[n];
        double step = (double) rate / RATE;
        for (int i = 0; i < n; i++) {
            double x = i * step;
            int k = (int) x;
            double f = x - k;
            float a = in[Math.min(k, in.length - 1)], c = in[Math.min(k + 1, in.length - 1)];
            out[i] = (float) (a + (c - a) * f);
        }
        return out;
    }
}
