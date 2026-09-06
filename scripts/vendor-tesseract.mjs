/**
 * Re-copies the Tesseract worker and wasm cores from node_modules into
 * `public/tesseract/`, where the offline label reader loads them from.
 *
 * Worth running after any tesseract.js or tesseract.js-core upgrade: the
 * worker script and the core it imports are a matched pair, and a stale copy
 * of one against a fresh copy of the other fails at runtime, in the worker,
 * with nothing useful on the page. See public/tesseract/README.md.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'tesseract');

const coreDir = dirname(require.resolve('tesseract.js-core/package.json'));
const jsDir = dirname(require.resolve('tesseract.js/package.json'));

const files = [
  [join(jsDir, 'dist', 'worker.min.js'), 'worker.min.js'],
  [join(coreDir, 'tesseract-core-simd-lstm.wasm.js'), 'tesseract-core-simd-lstm.wasm.js'],
  [join(coreDir, 'tesseract-core-lstm.wasm.js'), 'tesseract-core-lstm.wasm.js'],
];

mkdirSync(out, { recursive: true });
for (const [from, name] of files) {
  copyFileSync(from, join(out, name));
  console.log(`vendored ${name}`);
}
console.log(
  `\ntesseract.js ${require('tesseract.js/package.json').version} · ` +
    `tesseract.js-core ${require('tesseract.js-core/package.json').version}\n` +
    'Update the version table in public/tesseract/README.md if these changed.',
);
