#!/bin/bash
# Tests on-device dictation's model helper (android/.../SttModels.java) with a plain JDK: the catalogue's hashes and
# sizes, recognising a model the user brings from its file names, the text tidying, repeat trimming and the word error
# rate. Needs javac 11+. Also run by tools/java-check.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/src/com/omarqaterge/hermesmobile"
cp android/src/com/omarqaterge/hermesmobile/SttModels.java "$T/src/com/omarqaterge/hermesmobile/"
cat > "$T/src/com/omarqaterge/hermesmobile/SttModelsTest.java" <<'JAVA'
package com.omarqaterge.hermesmobile;
import java.util.*;
public class SttModelsTest {
    static int fails = 0;
    static void check(boolean ok, String what) { System.out.println((ok ? "PASS  " : "FAIL  ") + what); if (!ok) fails++; }
    static SttModels.Detected d(String hint, String... names) { return SttModels.detect(Arrays.asList(names), hint); }
    public static void main(String[] a) {
        // catalogue
        check(SttModels.CATALOG[0].recommended && SttModels.CATALOG[0].id.equals("moonshine-base-en"), "Moonshine Base is first and recommended");
        int rec = 0;
        Set<String> ids = new HashSet<>();
        for (SttModels.Spec s : SttModels.CATALOG) {
            if (s.recommended) rec++;
            check(ids.add(s.id), s.id + ": unique id");
            for (SttModels.FileSpec f : s.files) {
                check(f.sha256.matches("[0-9a-f]{64}") && f.size > 0 && f.url.startsWith("https://"), s.id + "/" + f.name + ": https, size and SHA-256");
            }
            for (String file : s.roles.values()) {
                boolean has = false;
                for (SttModels.FileSpec f : s.files) has |= f.name.equals(file);
                check(has, s.id + ": role file " + file + " is downloaded");
            }
            check(s.live == SttModels.ONLINE.equals(s.kind), s.id + ": live words only for streaming models");
            check(s.size() > 0 && s.size() < (1L << 30), s.id + ": size " + (s.size() >> 20) + " MB");
        }
        check(rec == 1, "exactly one recommended model");
        check(SttModels.find("zipformer-en") != null && SttModels.find("nope") == null, "find by id");
        check(SttModels.needsVad(SttModels.MOONSHINE) && !SttModels.needsVad(SttModels.ONLINE), "VAD for phrase models, not streaming ones");

        // detection
        SttModels.Detected m = d("csukuangfj2/sherpa-onnx-moonshine-base-en-quantized-2026-02-27", "encoder_model.ort", "decoder_model_merged.ort", "tokens.txt", "LICENSE");
        check(SttModels.MOONSHINE.equals(m.kind) && "decoder_model_merged.ort".equals(m.roles.get("mergedDecoder")), "Moonshine v2");
        m = d("sherpa-onnx-moonshine-tiny-en-int8", "preprocess.onnx", "encode.int8.onnx", "uncached_decode.int8.onnx", "cached_decode.int8.onnx", "tokens.txt");
        check(SttModels.MOONSHINE.equals(m.kind) && "encode.int8.onnx".equals(m.roles.get("encoder")) && "cached_decode.int8.onnx".equals(m.roles.get("cachedDecoder"))
                && "uncached_decode.int8.onnx".equals(m.roles.get("uncachedDecoder")), "Moonshine v1, four parts");
        m = d("csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26",
                "encoder-epoch-99-avg-1-chunk-16-left-64.onnx", "encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx", "encoder-epoch-99-avg-1-chunk-16-left-128.onnx",
                "decoder-epoch-99-avg-1-chunk-16-left-64.int8.onnx", "decoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx",
                "joiner-epoch-99-avg-1-chunk-16-left-64.int8.onnx", "joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx", "tokens.txt", "bpe.model");
        check(SttModels.ONLINE.equals(m.kind), "streaming Zipformer → online transducer");
        check("encoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx".equals(m.roles.get("encoder")), "int8 encoder preferred");
        check("decoder-epoch-99-avg-1-chunk-16-left-128.int8.onnx".equals(m.roles.get("decoder"))
                && "joiner-epoch-99-avg-1-chunk-16-left-128.int8.onnx".equals(m.roles.get("joiner")), "decoder and joiner match the encoder's variant");
        m = d("csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8", "encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt");
        check(SttModels.OFFLINE.equals(m.kind), "Parakeet → non-streaming transducer");
        m = d("csukuangfj/sherpa-onnx-whisper-base.en", "base.en-encoder.int8.onnx", "base.en-decoder.int8.onnx", "base.en-encoder.onnx", "base.en-tokens.txt");
        check(SttModels.WHISPER.equals(m.kind) && "base.en-encoder.int8.onnx".equals(m.roles.get("encoder")) && "base.en-tokens.txt".equals(m.roles.get("tokens")), "Whisper");
        m = d("csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17", "model.int8.onnx", "model.onnx", "tokens.txt");
        check(SttModels.SENSE_VOICE.equals(m.kind) && "model.int8.onnx".equals(m.roles.get("model")), "SenseVoice");
        m = d("some/thing", "model.onnx", "config.json");
        check(m.kind == null && m.error.contains("tokens.txt"), "no tokens.txt → clear error");
        m = d("some/thing", "weights.onnx", "tokens.txt");
        check(m.kind == null && m.error.contains("sherpa-onnx"), "unknown files → says what runs");
        m = d("", "silero_vad.onnx", "tokens.txt");
        check(m.kind == null, "a VAD file alone is not a model");

        // text
        check(SttModels.tidy("CAN YOU HEAR ME I THINK SO", false).equals("Can you hear me I think so"), "upper case → sentence case, capital I");
        check(SttModels.tidy("i'm here", false).equals("I'm here"), "I'm");
        check(SttModels.tidy("Already Cased text", false).equals("Already Cased text"), "mixed case kept");
        check(SttModels.tidy("  Hello,   world. ", true).equals("Hello, world."), "punctuated text: spaces only");
        check(SttModels.trimRepeats("can you look at the the the the the").equals("can you look at the"), "a looping word is cut");
        check(SttModels.trimRepeats("at 5 3 3 3 3 3").equals("at 5 3"), "a looping number is cut");
        check(SttModels.trimRepeats("very very good").equals("very very good"), "two in a row are kept");
        check(SttModels.wer("After early nightfall, the lamps.", "after early nightfall the lamps") == 0, "WER ignores case and punctuation");
        check(Math.abs(SttModels.wer("one two three four", "one too three") - 0.5) < 1e-9, "WER: a substitution and a deletion");
        check(SttModels.wer("a", "") == 1, "WER of nothing heard is 1");
        System.out.println(fails == 0 ? "ALL PASSED" : fails + " FAILED");
        System.exit(fails == 0 ? 0 : 1);
    }
}
JAVA
javac -encoding UTF-8 -d "$T/out" "$T/src/com/omarqaterge/hermesmobile/"*.java
java -cp "$T/out" com.omarqaterge.hermesmobile.SttModelsTest
