# Third-party code

- `web/vendor/hermes-shared/`: client code copied from NousResearch/hermes-agent (`apps/shared`), pinned in `.hermes-commit`.
  Licensed MIT, Copyright (c) Nous Research. Source: https://github.com/NousResearch/hermes-agent
- `web/vendor/desktop-slash-registry.json`: derived from Hermes Desktop's slash command registry (same project, MIT).
- OpenUI (`@openuidev/react-lang`, `@openuidev/lang-core`, `@openuidev/react-ui`, `@openuidev/react-headless`), which draws the
  cards in replies: MIT, Copyright (c) Thesys Inc. Source: https://github.com/thesysdev/openui. It and the parts it uses of
  these libraries are built into the app's lazy OpenUI bundle: Radix UI primitives, Floating UI, TanStack Table, react-day-picker,
  date-fns, d3 (scale, selection, shape), lodash-es, react-markdown with remark/rehype plugins and KaTeX,
  react-syntax-highlighter with refractor/Prism and lowlight, zod, zustand, its own copy of React and `@ag-ui/core` (all
  MIT), lucide-react icons (ISC), highlight.js (BSD-3-Clause), tslib (0BSD) and highlightjs-vue (CC0-1.0).
- npm dependencies (React, KaTeX, Mermaid, highlight.js, rehype/remark plugins, Vite, vitest) keep their own licenses, see `web/package.json` and `web/package-lock.json`.
- sherpa-onnx (`tools/sherpa-onnx.sh` fetches the pinned release; its Java API is compiled into the APK and its native
  library `libsherpa-onnx-jni.so`, with ONNX Runtime linked in, ships in it), the on-device speech-to-text engine:
  Apache-2.0, Copyright (c) Xiaomi Corporation and the k2-fsa authors. Source: https://github.com/k2-fsa/sherpa-onnx.
  ONNX Runtime: MIT, Copyright (c) Microsoft Corporation. Source: https://github.com/microsoft/onnxruntime
- `android/stt/sample.wav` (the recording on-device speech models are checked with): an utterance of LibriSpeech
  test-clean (as in sherpa-onnx's model test files), CC BY 4.0, by Vassil Panayotov, Guoguo Chen, Daniel Povey and Sanjeev Khudanpur, from
  LibriVox public-domain audiobooks. Source: https://www.openslr.org/12
- Speech models the app downloads when you ask (not in the APK), each under its own licence, shown on its card:
  Moonshine Base and Tiny (English): MIT, Copyright (c) Useful Sensors, Inc. (Moonshine AI); NeMo FastConformer
  streaming (English): CC BY 4.0, NVIDIA; Zipformer streaming (English): Apache-2.0, k2-fsa; Silero VAD: MIT, Silero Team.
