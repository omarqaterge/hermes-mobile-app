package com.omarqaterge.hermesmobile;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * On-device dictation models (sherpa-onnx format): the built-in catalogue, how to recognise the files of a model the user
 * brings, and how its text is tidied. Plain Java, no Android classes, so tools/test_stt_models.sh tests it on a JDK.
 * The catalogue is here and not in the page so a download's URLs and SHA-256 hashes can't be changed from the web view.
 */
final class SttModels {
    private SttModels() {}

    // what kind of recogniser the files are for (LocalStt/SttEngine build the matching sherpa-onnx config)
    static final String MOONSHINE = "moonshine";          // encoder + merged decoder (Moonshine v2) or the four v1 parts
    static final String ONLINE = "online-transducer";     // streaming Zipformer / NeMo transducer: words while you speak
    static final String OFFLINE = "offline-transducer";   // non-streaming transducer (Parakeet, Zipformer): per phrase
    static final String WHISPER = "whisper";
    static final String SENSE_VOICE = "sense-voice";

    /** Streaming models hear everything; the others transcribe the phrases voice activity detection cuts out. */
    static boolean needsVad(String kind) {
        return !ONLINE.equals(kind);
    }

    static final class FileSpec {
        final String name, url, sha256;
        final long size;
        FileSpec(String name, String url, String sha256, long size) {
            this.name = name;
            this.url = url;
            this.sha256 = sha256;
            this.size = size;
        }
    }

    static final class Spec {
        final String id, name, kind, licence, good, weak;
        final boolean live, punctuation, recommended;
        final Map<String, String> roles; // role (encoder, decoder, joiner, mergedDecoder, tokens, …) → file name
        final FileSpec[] files;
        Spec(String id, String name, String kind, boolean live, boolean punctuation, boolean recommended, String good, String weak,
             String licence, Map<String, String> roles, FileSpec... files) {
            this.id = id;
            this.name = name;
            this.kind = kind;
            this.live = live;
            this.punctuation = punctuation;
            this.recommended = recommended;
            this.good = good;
            this.weak = weak;
            this.licence = licence;
            this.roles = roles;
            this.files = files;
        }
        long size() {
            long n = 0;
            for (FileSpec f : files) n += f.size;
            return n + (needsVad(kind) ? VAD.size : 0);
        }
    }

    private static final String HF = "https://huggingface.co/";

    private static FileSpec hf(String repo, String name, String sha, long size) {
        return new FileSpec(name, HF + repo + "/resolve/main/" + name, sha, size);
    }

    private static Map<String, String> roles(String... kv) {
        Map<String, String> m = new LinkedHashMap<>();
        for (int i = 0; i + 1 < kv.length; i += 2) m.put(kv[i], kv[i + 1]);
        return m;
    }

    /** Silero voice activity detection, shared by every model that isn't streaming (stt/vad/silero_vad.onnx). */
    static final FileSpec VAD = new FileSpec("silero_vad.onnx",
            "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx",
            "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6", 643854);

    private static final String MB = "csukuangfj2/sherpa-onnx-moonshine-base-en-quantized-2026-02-27";
    private static final String MT = "csukuangfj2/sherpa-onnx-moonshine-tiny-en-quantized-2026-02-27";
    private static final String ZF = "csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26";
    private static final String NM = "csukuangfj/sherpa-onnx-nemo-streaming-fast-conformer-transducer-en-480ms-int8";
    private static final String ZF_STEM = "-epoch-99-avg-1-chunk-16-left-128.int8.onnx";

    /** English first. The first one is the one the app suggests. Accuracy notes come from docs/improvements.md (STT). */
    static final Spec[] CATALOG = {
        new Spec("moonshine-base-en", "Moonshine Base (English)", MOONSHINE, false, true, true,
                "Most accurate here, with punctuation and capitals. Works only on what you say, so it saves battery.",
                "Words appear after each short pause, not while you speak. Largest download.",
                "MIT",
                roles("encoder", "encoder_model.ort", "mergedDecoder", "decoder_model_merged.ort", "tokens", "tokens.txt"),
                hf(MB, "encoder_model.ort", "7c66495948d0d08ec1af454cd4b5514862ae6511e94712a60e6d83eaec8dc8cf", 31326816),
                hf(MB, "decoder_model_merged.ort", "d9d7b333af34bc552580576ddcf248a1c6c839e0d3b43b09afb9376ed009899d", 109424400),
                hf(MB, "tokens.txt", "2870d843e14c1e187bf1913a521562a63b53933814bd7f2145120468f494a049", 549350)),
        new Spec("moonshine-tiny-en", "Moonshine Tiny (English)", MOONSHINE, false, true, false,
                "Small and the lightest on battery, with punctuation. Nearly as accurate as Base on clear speech.",
                "More mistakes with noise, accents and fast speech. Words appear after each pause.",
                "MIT",
                roles("encoder", "encoder_model.ort", "mergedDecoder", "decoder_model_merged.ort", "tokens", "tokens.txt"),
                hf(MT, "encoder_model.ort", "94e90a4654fc45cdfedb77c4c08e1739f48862998e58fada384b25118134f221", 13281600),
                hf(MT, "decoder_model_merged.ort", "cf524c4862d36e9e5ab032eddc73637efd822d70e868ac575cf1a46e1e4708a0", 30412256),
                hf(MT, "tokens.txt", "2870d843e14c1e187bf1913a521562a63b53933814bd7f2145120468f494a049", 549350)),
        new Spec("nemo-streaming-en", "NeMo FastConformer streaming (English)", ONLINE, true, false, false,
                "Words appear while you speak; trained on a wide mix of speech, so it copes with everyday talk.",
                "No punctuation or capitals. Keeps the processor busy the whole time the microphone is on.",
                "CC-BY-4.0",
                roles("encoder", "encoder.int8.onnx", "decoder", "decoder.int8.onnx", "joiner", "joiner.int8.onnx", "tokens", "tokens.txt"),
                hf(NM, "encoder.int8.onnx", "100c5616929a131b5b3c8c8ab0d83aaba2cdcae163acd8d190b4e5ffa5f7d051", 131507603),
                hf(NM, "decoder.int8.onnx", "4f04431988472f8c7b815f942aa6901976929c9e22353029681fcdb262da0164", 3955864),
                hf(NM, "joiner.int8.onnx", "d2d8e7290a6a8245a83ed211aa0dd8cdf8effb8a7c64fe392399561111b52f30", 1408182),
                hf(NM, "tokens.txt", "618dc110fc2213886b52e063ff42329bbdf37a266ca7705184090fa5f39f3131", 11896)),
        new Spec("zipformer-en", "Zipformer streaming (English)", ONLINE, true, false, false,
                "Words appear while you speak, from the smallest download. Fine for clear, read-out speech.",
                "Trained on audiobooks only: often wrong on casual speech, names and tech words. No punctuation.",
                "Apache-2.0",
                roles("encoder", "encoder" + ZF_STEM, "decoder", "decoder" + ZF_STEM, "joiner", "joiner" + ZF_STEM, "tokens", "tokens.txt"),
                hf(ZF, "encoder" + ZF_STEM, "563fde436d16cf7607cf408cd6b30909819d03162652ef389c2450ced3f45ac1", 71083163),
                hf(ZF, "decoder" + ZF_STEM, "98da299f471e38bb4e1a8df579b8cc9122d6039576a77e357b3c60f17dd83b02", 1307236),
                hf(ZF, "joiner" + ZF_STEM, "d944208d660d67c8d72cd2acaeac971fa5ceb8c80e76c1968148846fedd6e297", 259335),
                hf(ZF, "tokens.txt", "49e3c2646595fd907228b3c6787069658f67b17377c60aeb8619c4551b2316fb", 5048)),
    };

    static Spec find(String id) {
        for (Spec s : CATALOG) if (s.id.equals(id)) return s;
        return null;
    }

    /** The model a set of files is (from a Hugging Face repo or picked on the phone): kind + role → file, or an error. */
    static final class Detected {
        String kind, error;
        final Map<String, String> roles = new LinkedHashMap<>();
    }

    /**
     * Recognises a sherpa-onnx model from its file names. `hint` is the repo or folder name (it tells streaming from
     * non-streaming transducers). int8 files win over full-precision copies of the same part.
     */
    static Detected detect(List<String> names, String hint) {
        Detected d = new Detected();
        List<String> files = new ArrayList<>();
        for (String n : names) {
            String l = n.toLowerCase(Locale.ROOT);
            if (l.endsWith(".onnx") || l.endsWith(".ort") || l.endsWith(".txt")) files.add(n);
        }
        String tokens = pick(files, "tokens.txt", null);
        if (tokens == null) tokens = pick(files, "tokens", ".txt");
        String all = ((hint == null ? "" : hint) + " " + String.join(" ", files)).toLowerCase(Locale.ROOT);
        if (tokens == null) {
            d.error = "No tokens.txt among the files, so this isn't a sherpa-onnx model. Look for one whose name starts with sherpa-onnx (most are by csukuangfj or k2-fsa).";
            return d;
        }
        d.roles.put("tokens", tokens);
        String enc2 = pick(files, "encoder_model", null), merged = pick(files, "decoder_model_merged", null);
        String pre = pick(files, "preprocess", null), unc = pick(files, "uncached_decode", null), cac = pick(files, "cached_decode", null);
        String encoder = pick(files, "encoder", null), decoder = pick(files, "decoder", null), joiner = pick(files, "joiner", null);
        String model = pick(files, "model", ".onnx");
        if (enc2 != null && merged != null) {
            d.kind = MOONSHINE;
            d.roles.put("encoder", enc2);
            d.roles.put("mergedDecoder", merged);
        } else if (pre != null && unc != null && cac != null && pick(files, "encode", null) != null) {
            d.kind = MOONSHINE;
            d.roles.put("preprocessor", pre);
            d.roles.put("encoder", pickExcluding(files, "encode", "decode"));
            d.roles.put("uncachedDecoder", unc);
            d.roles.put("cachedDecoder", cac);
        } else if (encoder != null && decoder != null && joiner != null) {
            d.kind = all.contains("streaming") || all.contains("chunk") || all.contains("online") ? ONLINE : OFFLINE;
            d.roles.put("encoder", encoder);
            d.roles.put("decoder", sibling(files, encoder, "encoder", "decoder", decoder));
            d.roles.put("joiner", sibling(files, encoder, "encoder", "joiner", joiner));
        } else if (encoder != null && decoder != null) { // no joiner: Whisper (base.en-encoder.onnx, base.en-decoder.onnx)
            d.kind = WHISPER;
            d.roles.put("encoder", encoder);
            d.roles.put("decoder", sibling(files, encoder, "encoder", "decoder", decoder));
        } else if (model != null && (all.contains("sense") || all.contains("sensevoice"))) {
            d.kind = SENSE_VOICE;
            d.roles.put("model", model);
        } else {
            d.error = "These files aren't a model the app can run. It runs sherpa-onnx models: Moonshine, Whisper, SenseVoice, "
                    + "and Zipformer, NeMo or Parakeet transducers (encoder, decoder, joiner).";
        }
        return d;
    }

    /** The file whose name contains `part` (and ends with `ext` when given), preferring an int8 copy. */
    private static String pick(List<String> files, String part, String ext) {
        String best = null;
        for (String f : files) {
            String l = f.toLowerCase(Locale.ROOT);
            if (!l.contains(part) || (ext != null && !l.endsWith(ext))) continue;
            if (part.equals("encoder") && l.contains("encoder_model")) continue; // Moonshine v2, handled apart
            if (part.equals("decoder") && l.contains("decoder_model")) continue;
            if (part.equals("cached_decode") && l.contains("uncached")) continue;
            if (part.equals("model") && (l.contains("vad") || l.contains("encoder") || l.contains("decoder"))) continue;
            if (best == null || (l.contains("int8") && !best.toLowerCase(Locale.ROOT).contains("int8"))) best = f;
        }
        return best;
    }

    private static String pickExcluding(List<String> files, String part, String not) {
        String best = null;
        for (String f : files) {
            String l = f.toLowerCase(Locale.ROOT);
            if (!l.contains(part) || l.contains(not) || l.contains("preprocess")) continue;
            if (best == null || (l.contains("int8") && !best.toLowerCase(Locale.ROOT).contains("int8"))) best = f;
        }
        return best;
    }

    /** decoder/joiner exported with the encoder (same epoch, chunk and precision), when the folder has several. */
    private static String sibling(List<String> files, String encoder, String from, String to, String fallback) {
        String want = encoder.replace(from, to);
        return files.contains(want) ? want : fallback;
    }

    /**
     * Text as the composer should get it. Models without punctuation (transducers) give UPPER or lower case words: they
     * become a sentence in lower case with a capital first letter and a capital "I". Models with punctuation are kept.
     */
    static String tidy(String text, boolean punctuation) {
        String t = text == null ? "" : text.trim().replaceAll("\\s+", " ");
        if (t.isEmpty() || punctuation) return t;
        if (!t.equals(t.toUpperCase(Locale.ROOT)) && !t.equals(t.toLowerCase(Locale.ROOT))) return t; // already cased
        t = t.toLowerCase(Locale.ROOT).replaceAll("\\bi\\b", "I"); // also "I'm", "I've"
        return Character.toUpperCase(t.charAt(0)) + t.substring(1);
    }

    /**
     * Cuts a run of one word repeated at the end ("at the the the the"). A Moonshine-type decoder given audio that stops
     * mid-word (a preview while you speak) can loop like that; the finished phrase is decoded again from whole audio.
     */
    static String trimRepeats(String text) {
        String[] w = text.trim().split("\\s+");
        for (int i = 0; i + 2 < w.length; i++) {
            String a = w[i].replaceAll("[^\\p{L}\\p{N}']", "").toLowerCase(Locale.ROOT);
            if (a.isEmpty()) continue;
            int j = i + 1;
            while (j < w.length && w[j].replaceAll("[^\\p{L}\\p{N}']", "").toLowerCase(Locale.ROOT).equals(a)) j++;
            if (j - i >= 3) return String.join(" ", Arrays.copyOfRange(w, 0, i + 1));
        }
        return text.trim();
    }

    /** Words (letters, digits, apostrophes) in lower case, for comparing a transcript with what was said. */
    static String[] words(String t) {
        String s = t == null ? "" : t.toLowerCase(Locale.ROOT).replaceAll("[^\\p{L}\\p{N}' ]", " ").trim();
        return s.isEmpty() ? new String[0] : s.split("\\s+");
    }

    /** Word error rate of `hyp` against `ref` (0 = every word right), by edit distance over words. */
    static double wer(String ref, String hyp) {
        String[] r = words(ref), h = words(hyp);
        if (r.length == 0) return h.length == 0 ? 0 : 1;
        int[] d = new int[h.length + 1];
        for (int j = 0; j <= h.length; j++) d[j] = j;
        for (int i = 1; i <= r.length; i++) {
            int prev = d[0];
            d[0] = i;
            for (int j = 1; j <= h.length; j++) {
                int cur = d[j];
                d[j] = Math.min(Math.min(d[j] + 1, d[j - 1] + 1), prev + (r[i - 1].equals(h[j - 1]) ? 0 : 1));
                prev = cur;
            }
        }
        return (double) d[h.length] / r.length;
    }

    /** Whether a kind's own output has punctuation (Moonshine, Whisper and SenseVoice do). */
    static boolean punctuates(String kind) {
        return MOONSHINE.equals(kind) || WHISPER.equals(kind) || SENSE_VOICE.equals(kind);
    }
}
