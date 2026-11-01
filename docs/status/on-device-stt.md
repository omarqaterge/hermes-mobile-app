# On-device speech-to-text

**State** (2026-11-01): Settings → Voice → Speech recognition lets dictation and Live mode use a model on the phone
(sherpa-onnx in the APK): four built-in English models to download (Moonshine Base recommended, Moonshine Tiny, NeMo
FastConformer streaming, Zipformer streaming) or the user's own sherpa-onnx model from a Hugging Face link or the
phone's files. Every model is checked on a test recording in a separate process (`SttProbe`) before use. The choice of
default and the measurements are in docs/improvements.md ("On-device speech-to-text"). Tested on Android 15 and 8.0
emulators; the browser check is in `tools/web-e2e/checks/13-player-and-voice.cjs`.

**Next:** measure speed, battery and real voices on phones and adjust the defaults (preview interval 1.5 s, VAD
silence 0.5 s, two decoding threads); more languages in the catalogue (Moonshine has Chinese, Ukrainian and others, but
under a non-commercial licence, so only by "your own model" for now); maybe load the chosen model when the composer
opens, so the first dictation starts sooner.

**Needs a real phone:** the checklist in docs/manual-tests.md ("On-device dictation"), a 32-bit phone.

**Links:** spec 4.6 "On-device dictation", 3.15 "Speech recognition", `tools/sherpa-onnx.sh`.
