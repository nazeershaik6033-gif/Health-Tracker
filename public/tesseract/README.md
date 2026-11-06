# Vendored Tesseract runtime

These files are copied verbatim out of `node_modules` (and one npm package) so
the offline label reader works **offline**. Tesseract.js otherwise fetches all
three of them from jsDelivr the first time a keyless user reads a label, which
fails on a plane, on a filtered network, and in an installed PWA with no
connection — exactly the situations the on-device reader exists for.

They live in `public/` rather than being imported through Vite because
`corePath` and `langPath` are **directories**: tesseract.js appends
`/tesseract-core-…wasm.js` and `/eng.traineddata.gz` itself. Hashed asset URLs
cannot express that, and `public/` copies filenames through unchanged.

| File | Source | Version |
| --- | --- | --- |
| `worker.min.js` | `tesseract.js/dist/worker.min.js` | 6.0.1 |
| `tesseract-core-simd-lstm.wasm.js` | `tesseract.js-core/` | 6.1.2 |
| `tesseract-core-lstm.wasm.js` | `tesseract.js-core/` | 6.1.2 |
| `eng.traineddata.gz` | `@tesseract.js-data/eng@1.0.0`, `4.0.0_best_int/` | 4.0.0 |

Both cores are shipped and only one is ever downloaded: tesseract.js feature-
detects wasm SIMD and asks for `-simd-` where it is available (Safari 16.4+,
Chrome 91+, Firefox 89+), falling back to the plain build everywhere else.
The `.wasm.js` builds are used rather than the smaller `.js` + `.wasm` pair
because they carry the binary inline — the worker runs from a `blob:` URL, so
the relative `locateFile` lookup the split build depends on has no directory to
resolve against.

`4.0.0_best_int` is the LSTM-only model, which is what the CDN default resolves
to for our `OEM.LSTM_ONLY` worker; the combined legacy model is 10.9 MB and
would never be used.

## Refreshing

```
npm run vendor:ocr          # worker + cores, from node_modules
```

The language data is not on that path — it is pinned and rarely changes:

```
npm pack @tesseract.js-data/eng && tar xzf tesseract.js-data-eng-*.tgz
cp package/4.0.0_best_int/eng.traineddata.gz public/tesseract/
```
