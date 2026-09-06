# NER runtime verification — 2026-09-06

The inference engine now uses `@huggingface/tokenizers@0.1.3`, a local typed GLiNER span adapter, and `onnxruntime-web@1.27.0`. The obsolete GLiNER npm wrapper, Xenova Transformers, duplicate ONNX runtime, native Node dependencies and patch-package workaround were removed. The retained GLiNER processor/decoder behavior is attributed in `src/workers/glinerSpan.ts`; the upstream Apache-2.0 license is retained alongside it.

The fp16 model and its tokenizer are pinned together to Hugging Face revision `6ddaeb9413b0e71ad8457da1aab378a165b24058`. The model contains 579,717,643 bytes. Quantization, span width, word splitting, label prompting and greedy overlap selection were not changed. The tokenizer resolves some emoji that the old tokenizer mapped to UNK; ordinary RU/UA/EN words, names, accents and GLiNER prompt markers matched in the migration comparison.

## Why these runtime settings

- ORT 1.29.0 preserved the observed 42 spans but took 84.04 seconds for the measured CPU batch, versus 27.47 seconds with 1.19.2. It is not used. An [upstream native CPU FP16 regression](https://github.com/microsoft/onnxruntime/issues/32255) suggests a possible relationship, but the exact cause of this WASM slowdown was not profiled.
- Stable `onnxruntime-web@1.28.0` was not published. Version 1.27.0 is pinned and passes the comparisons below.
- CPU sessions use `graphOptimizationLevel: 'layout'`. The default `all` level fails on this fp16 graph during `SimplifiedLayerNormFusion`; this matches the [upstream issue and workaround](https://github.com/microsoft/onnxruntime/issues/26717). Other graph optimizations remain enabled.
- WebGPU uses the JSEP implementation exported by `onnxruntime-web/all`. The smaller native `/webgpu` implementation returned only four of six synthetic RU/UA/EN entities on Intel Gen12; JSEP returned all six. Therefore the final worker is approximately 839 KB, not the experimental native worker's 105 KB. The previous worker was approximately 2.06 MB.
- The matching JSEP `.mjs` and `.wasm` are served by the application with Vite-generated hashes. The external-WASM package export avoids emitting an additional unused runtime binary. GPU and CPU use the same fp16 model bytes, including after GPU fallback.

Every new session runs a six-entity RU/UA/EN calibration. A failed GPU calibration releases that session and triggers CPU fallback. A failed CPU calibration is an NER error. This small canary detects the observed backend degradation; it is not a guarantee of accuracy on arbitrary documents. Invalid shapes, truncated output and non-finite model scores are rejected.

## Measurements and scope

All inference ran locally. No source document or extracted text was uploaded. Remote requests were limited to public packages/model files. The four holdout excerpts and detailed outputs remain in gitignored `.work/`.

| Check | Result |
| --- | --- |
| Old/new tokenizer comparison | 345 word/sentence inputs; five differences, all involving emoji/zero-width joiner |
| Six synthetic RU/UA/EN/accented samples | Same 18 spans, positions and labels as the old runtime |
| Four local holdout excerpts | Same additional 24 spans, positions and labels |
| Combined old 1.19.2 CPU/WASM batch | Init 1.92 s; inference 27.47 s |
| Combined new 1.27.0 CPU/WASM batch | Init 1.90 s; inference 26.07 s |
| Experimental 1.29.0 CPU/WASM batch | Init 2.27 s; inference 84.04 s |
| Production worker, Chromium, CPU | Six calibration-text entities; no runtime/CSP errors |
| Production worker, Chromium, Intel Gen12 JSEP WebGPU | Six calibration-text entities; actual WebGPU execution, no runtime/CSP errors |

CPU timings used the same ten-text batch, one WASM thread and fp16 weights. These are single local runs, not a statistically established speedup. Maximum confidence drift with 1.27.0 was about 0.0344, on the emoji-containing synthetic sentence. Agreement with the previous engine is a migration check, not a ground-truth recall measurement or a full multilingual quality study.

The production smoke used the built worker, the application's CSP, matching built WASM assets and an actual Intel `gen-12lp` adapter. Public model download requests were redirected to a local HTTP stream of the pinned model to avoid downloading it again. A full-model Cache Storage preseed failed in the temporary browser profile; streaming download and graceful cache-write failure handling still completed successfully. The smoke is not evidence that every browser can retain a 580 MB cache entry.

The loader now allocates one model destination, consumes chunks directly and streams a response copy to Cache Storage. It no longer retains a full chunk array or creates an explicit `bytes.slice()` for caching. Stream tees and browser internals may still buffer data; no numerical peak-RAM reduction is claimed.

## Reproduce the public synthetic check

Use the project's pinned Node/npm toolchain and run `npm ci` first.

```sh
# Optional first download of the public model/tokenizer (~580 MB model).
node scripts/benchmark-ner.mjs --download

# Subsequent run uses only local assets.
node scripts/benchmark-ner.mjs

# Regression tests require no model download.
npm test -- src/workers/glinerSpan.test.ts src/workers/modelAssets.test.ts src/workers/nerCalibration.test.ts
```

The benchmark prints runtime, model revision, timings and exact agreement with the 18 recorded synthetic legacy spans. It does not read the private holdout corpus. To reuse already downloaded files, pass `--assets-dir .work/ner-parity`.
