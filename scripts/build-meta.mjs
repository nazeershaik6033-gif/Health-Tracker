/**
 * Keeps the committed build honest.
 *
 * The published site is `docs/`, committed to main and served straight off the
 * branch. That removes the deploy race, but introduces the failure it trades
 * for: a source change committed without rebuilding leaves the live site
 * silently serving the previous build. No error, no warning — just an app that
 * quietly isn't what the repo says it is.
 *
 * So the build records a hash of everything it was built from, and CI
 * recomputes it. If they disagree, `docs/` is stale and the check fails with
 * the command that fixes it.
 *
 *   node scripts/build-meta.mjs          write docs/.build-meta.json
 *   node scripts/build-meta.mjs --check  fail if docs/ is stale
 *
 * Deliberately hashes inputs rather than diffing output: the bundle embeds a
 * build timestamp, so two builds of identical source are never byte-identical
 * and comparing output directly would fail every time.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const META = join(ROOT, 'docs', '.build-meta.json');

/** Everything the built output is derived from. */
const FILES = ['index.html', 'vite.config.ts', 'tsconfig.json', 'package.json', 'package-lock.json'];
const DIRS = ['src', 'public', 'scripts'];

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

function sourceHash() {
  const files = [
    ...FILES.map((f) => join(ROOT, f)).filter(existsSync),
    ...DIRS.flatMap((d) => walk(join(ROOT, d))),
  ].sort();

  const hash = createHash('sha256');
  for (const file of files) {
    // Path as well as contents, so a rename or deletion is a change too.
    hash.update(relative(ROOT, file).split(sep).join('/'));
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

const check = process.argv.includes('--check');
const current = sourceHash();

if (!check) {
  writeFileSync(META, `${JSON.stringify({ sourceHash: current, builtAt: new Date().toISOString() }, null, 2)}\n`);
  console.log(`build-meta: recorded ${current.slice(0, 12)}`);
  process.exit(0);
}

if (!existsSync(META)) {
  console.error('docs/.build-meta.json is missing — docs/ was not produced by `npm run build:pages`.');
  process.exit(1);
}

const recorded = JSON.parse(readFileSync(META, 'utf8')).sourceHash;
if (recorded !== current) {
  console.error(
    'docs/ is stale: the source has changed since it was built.\n' +
      `  recorded ${String(recorded).slice(0, 12)}\n` +
      `  current  ${current.slice(0, 12)}\n` +
      'Run `npm run build:pages` and commit docs/.',
  );
  process.exit(1);
}

console.log('build-meta: docs/ is up to date');
