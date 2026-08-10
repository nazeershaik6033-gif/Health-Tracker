/**
 * Reading an Apple Health export.
 *
 * HealthKit has no web API, so a PWA cannot see the Watch or the Health app
 * directly — that is a native-only capability and no amount of work here
 * changes it. What Apple does give you is a full export: Health → your profile
 * → Export All Health Data, which produces `export.zip` containing
 * `apple_health_export/export.xml`. This reads that file.
 *
 * Three things make it harder than it sounds, and each is handled below:
 *
 *   Size. The XML is routinely hundreds of megabytes and can pass a gigabyte
 *   — years of per-minute samples. It is never loaded into memory; it is
 *   streamed and reduced to per-day aggregates as it goes.
 *
 *   Double counting. An iPhone and a Watch both record steps for the same
 *   walk, and both appear in the export. Summing every record inflates a day
 *   massively. Health itself de-duplicates by source priority; the same shape
 *   of fix is applied here.
 *
 *   Dates. Apple writes `2024-01-01 08:00:00 +0530`. `new Date()` returns
 *   Invalid Date for that in Safari — a space instead of `T` is enough — so
 *   the format is parsed by hand rather than trusted to the platform.
 *
 * No dependencies: the zip is read with a minimal central-directory parser and
 * inflated with the platform's own DecompressionStream.
 */

/** Per-day aggregates, keyed by local ISO day. */
export interface HealthImport {
  steps: Map<string, number>;
  /** kg */
  weight: Map<string, number>;
  sleep: Map<string, { bedtime: string; wake: string; durationMin: number }>;
  /** ml */
  water: Map<string, number>;
  workouts: ImportedWorkout[];
  /** Bytes of XML read, for reporting when a file yields nothing. */
  bytesRead: number;
  /** Records seen whose type we don't import — useful context, not an error. */
  skippedTypes: number;
}

export interface ImportedWorkout {
  date: string;
  type: string;
  durationMin: number;
  kcal: number;
  startMs: number;
}

export type HealthMetric = 'steps' | 'weight' | 'sleep' | 'water' | 'workouts';

export const METRIC_LABEL: Record<HealthMetric, string> = {
  steps: 'Steps',
  weight: 'Weight',
  sleep: 'Sleep',
  water: 'Water',
  workouts: 'Workouts',
};

export class HealthImportError extends Error {}

/* ------------------------------------------------------------------ dates */

/**
 * `YYYY-MM-DD HH:MM:SS ±HHMM` → epoch ms, plus the local ISO day.
 *
 * Deliberately hand-rolled. Safari rejects this format outright, and even
 * where a browser accepts it the offset handling differs — the day a sample
 * belongs to would then depend on the browser, which is not acceptable for
 * data the user is going to see totalled.
 *
 * The day is taken in the *sample's own* offset, so a walk at 11pm in Delhi
 * stays on that date wherever the file is later opened.
 */
const APPLE_DATE =
  /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/;

export function parseAppleDate(
  raw: string,
): { ms: number; day: string; offsetMin: number } | null {
  const m = APPLE_DATE.exec(raw);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, sign, oh, om] = m;
  const offsetMin = (sign === '-' ? -1 : 1) * (Number(oh) * 60 + Number(om));
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  return { ms: utc - offsetMin * 60_000, day: `${y}-${mo}-${d}`, offsetMin };
}

/* -------------------------------------------------------------------- zip */

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
}

async function readSlice(file: Blob, start: number, end: number): Promise<DataView> {
  const buf = await file.slice(start, end).arrayBuffer();
  return new DataView(buf);
}

/** Locates `export.xml` inside the export zip without inflating anything else. */
async function findExportEntry(file: Blob): Promise<ZipEntry> {
  // The end-of-central-directory record sits at the very end, after a comment
  // of up to 64KB. Scan backwards over that window for its signature.
  const tailLen = Math.min(file.size, 65_536 + 22);
  const tail = await readSlice(file, file.size - tailLen, file.size);

  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new HealthImportError('That file is not a zip archive.');

  let cdOffset = tail.getUint32(eocd + 16, true);
  let cdSize = tail.getUint32(eocd + 12, true);

  // Zip64: the 32-bit fields saturate and the real values live in a separate
  // record. A multi-gigabyte export genuinely hits this.
  if (cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    const locStart = file.size - tailLen;
    let loc = -1;
    for (let i = eocd - 20; i >= 0; i--) {
      if (tail.getUint32(i, true) === 0x07064b50) {
        loc = i;
        break;
      }
    }
    if (loc < 0) throw new HealthImportError('This zip is too large to read (missing Zip64 index).');
    const z64At = Number(tail.getBigUint64(loc + 8, true));
    const z64 = await readSlice(file, z64At, z64At + 56);
    if (z64.getUint32(0, true) !== 0x06064b50) {
      throw new HealthImportError('This zip is too large to read (bad Zip64 index).');
    }
    cdSize = Number(z64.getBigUint64(40, true));
    cdOffset = Number(z64.getBigUint64(48, true));
    void locStart;
  }

  const cd = await readSlice(file, cdOffset, cdOffset + cdSize);
  const decoder = new TextDecoder();
  let best: ZipEntry | null = null;

  for (let p = 0; p + 46 <= cd.byteLength; ) {
    if (cd.getUint32(p, true) !== CD_SIG) break;
    const method = cd.getUint16(p + 10, true);
    let compressedSize = cd.getUint32(p + 20, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    let localOffset = cd.getUint32(p + 42, true);
    const name = decoder.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));

    // Zip64 extra field carries the real sizes when the 32-bit ones saturate.
    if (compressedSize === 0xffffffff || localOffset === 0xffffffff) {
      const exStart = p + 46 + nameLen;
      for (let e = exStart; e + 4 <= exStart + extraLen; ) {
        const id = cd.getUint16(e, true);
        const size = cd.getUint16(e + 2, true);
        if (id === 0x0001) {
          let q = e + 4;
          // Fields appear only if their 32-bit counterpart saturated, in a
          // fixed order: uncompressed, compressed, local offset.
          if (cd.getUint32(p + 24, true) === 0xffffffff) q += 8;
          if (compressedSize === 0xffffffff) {
            compressedSize = Number(cd.getBigUint64(q, true));
            q += 8;
          }
          if (localOffset === 0xffffffff) localOffset = Number(cd.getBigUint64(q, true));
          break;
        }
        e += 4 + size;
      }
    }

    // export_cda.xml is a second, clinical-format file we don't want.
    if (/(^|\/)export\.xml$/.test(name)) best = { name, method, compressedSize, localOffset };
    p += 46 + nameLen + extraLen + commentLen;
  }

  if (!best) {
    throw new HealthImportError(
      "That zip doesn't contain export.xml. Use Health → your profile → Export All Health Data.",
    );
  }
  return best;
}

/** A stream of the raw XML bytes, whether given the zip or the xml itself. */
export async function openExportXml(file: File): Promise<ReadableStream<Uint8Array>> {
  const isXml = file.name.toLowerCase().endsWith('.xml');
  if (isXml) return file.stream();

  const entry = await findExportEntry(file);
  // The central directory's name/extra lengths can differ from the local
  // header's, so the data offset has to come from the local header itself.
  const local = await readSlice(file, entry.localOffset, entry.localOffset + 30);
  if (local.getUint32(0, true) !== LOCAL_SIG) {
    throw new HealthImportError('This zip appears to be damaged.');
  }
  const dataStart =
    entry.localOffset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
  const raw = file.slice(dataStart, dataStart + entry.compressedSize).stream();

  if (entry.method === 0) return raw;
  if (entry.method !== 8) {
    throw new HealthImportError(`This zip uses an unsupported compression method (${entry.method}).`);
  }
  // 'deflate-raw' because a zip member has no zlib header.
  return raw.pipeThrough(new DecompressionStream('deflate-raw'));
}

/* ------------------------------------------------------------------ parse */

const WANTED_QUANTITY: Record<string, HealthMetric> = {
  HKQuantityTypeIdentifierStepCount: 'steps',
  HKQuantityTypeIdentifierBodyMass: 'weight',
  HKQuantityTypeIdentifierDietaryWater: 'water',
};
const SLEEP_TYPE = 'HKCategoryTypeIdentifierSleepAnalysis';

/** Half-open [start, end) intervals in ms, used to de-overlap sleep. */
type Interval = [number, number];

function mergeIntervals(list: Interval[]): number {
  if (!list.length) return 0;
  list.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let [cs, ce] = list[0];
  for (let i = 1; i < list.length; i++) {
    const [s, e] = list[i];
    if (s > ce) {
      total += ce - cs;
      cs = s;
      ce = e;
    } else if (e > ce) ce = e;
  }
  return total + (ce - cs);
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w:]+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) out[m[1]] = m[2];
  return out;
}

/** Cheap single-attribute read, to reject unwanted records before full parse. */
function attr(tag: string, name: string): string | null {
  const at = tag.indexOf(`${name}="`);
  if (at < 0) return null;
  const from = at + name.length + 2;
  const to = tag.indexOf('"', from);
  return to < 0 ? null : tag.slice(from, to);
}

function prettyActivity(raw: string): string {
  const bare = raw.replace(/^HKWorkoutActivityType/, '');
  // TraditionalStrengthTraining → Traditional Strength Training
  return bare.replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim() || 'Workout';
}

export interface ParseProgress {
  bytesRead: number;
  records: number;
}

/**
 * Streams the export and reduces it to per-day aggregates.
 *
 * Only the opening tag of each element is examined, so `<Workout>` children
 * (metadata, route points, per-second heart rate) cost nothing beyond being
 * scanned past.
 */
export async function parseHealthExport(
  stream: ReadableStream<Uint8Array>,
  opts: { signal?: AbortSignal; onProgress?: (p: ParseProgress) => void } = {},
): Promise<HealthImport> {
  // Count on the byte side: past the decoder these are characters, and
  // reporting those as bytes would misstate progress on any non-ASCII export.
  let bytesRead = 0;
  const counting = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytesRead += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });

  const reader = stream
    .pipeThrough(counting)
    // TextDecoderStream declares its writable side as BufferSource, which is
    // wider than Uint8Array, so the pair doesn't line up nominally.
    .pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>)
    .getReader();

  const steps = new Map<string, Map<string, number>>(); // day → source → count
  const water = new Map<string, Map<string, number>>();
  const weightLatest = new Map<string, { ms: number; kg: number }>();
  // The offset is carried per night so bedtime reads as the clock the sleeper
  // actually saw, not the clock of whoever opens the file later.
  const sleepNights = new Map<string, { asleep: Interval[]; inBed: Interval[]; offsetMin: number }>();
  const workouts: ImportedWorkout[] = [];
  const workoutSeen = new Set<string>();

  let buffer = '';
  let records = 0;
  let skippedTypes = 0;
  let lastReport = 0;

  for (;;) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;

    let cursor = 0;
    for (;;) {
      // Only two element names matter; skip straight to the next one.
      const rec = buffer.indexOf('<Record ', cursor);
      const wk = buffer.indexOf('<Workout ', cursor);
      let at = rec < 0 ? wk : wk < 0 ? rec : Math.min(rec, wk);
      if (at < 0) break;
      const close = buffer.indexOf('>', at);
      if (close < 0) break; // tag straddles the chunk boundary
      const tag = buffer.slice(at, close);
      const isRecord = at === rec && (wk < 0 || rec < wk);
      cursor = close + 1;
      records++;

      if (isRecord) {
        const type = attr(tag, 'type');
        if (!type) continue;
        const metric = WANTED_QUANTITY[type];

        if (metric) {
          const a = attrs(tag);
          const start = parseAppleDate(a.startDate ?? '');
          const value = Number(a.value);
          if (!start || !Number.isFinite(value)) continue;
          const source = a.sourceName || 'unknown';

          if (metric === 'steps') {
            const perSource = steps.get(start.day) ?? new Map<string, number>();
            perSource.set(source, (perSource.get(source) ?? 0) + value);
            steps.set(start.day, perSource);
          } else if (metric === 'water') {
            // Exports use L or mL depending on locale.
            const ml = /^l$/i.test(a.unit ?? '') ? value * 1000 : value;
            const perSource = water.get(start.day) ?? new Map<string, number>();
            perSource.set(source, (perSource.get(source) ?? 0) + ml);
            water.set(start.day, perSource);
          } else {
            const kg = /^lb$/i.test(a.unit ?? '') ? value * 0.45359237 : value;
            const prev = weightLatest.get(start.day);
            // Last reading of the day wins, matching how a person would read it.
            if (!prev || start.ms >= prev.ms) weightLatest.set(start.day, { ms: start.ms, kg });
          }
        } else if (type === SLEEP_TYPE) {
          const a = attrs(tag);
          const start = parseAppleDate(a.startDate ?? '');
          const end = parseAppleDate(a.endDate ?? '');
          if (!start || !end || end.ms <= start.ms) continue;
          // A night is filed under the day it ends, which is the morning the
          // user would call it. Sleep starting at 23:40 lands on the next day.
          const night = end.day;
          const bucket = sleepNights.get(night) ?? {
            asleep: [],
            inBed: [],
            offsetMin: start.offsetMin,
          };
          const v = a.value ?? '';
          if (v.includes('Asleep')) bucket.asleep.push([start.ms, end.ms]);
          else if (v.includes('InBed')) bucket.inBed.push([start.ms, end.ms]);
          sleepNights.set(night, bucket);
        } else {
          skippedTypes++;
        }
      } else {
        const a = attrs(tag);
        const start = parseAppleDate(a.startDate ?? '');
        if (!start) continue;
        const key = `${a.startDate}|${a.workoutActivityType}|${a.duration}`;
        // The same session syncs from both Watch and phone in some exports.
        if (workoutSeen.has(key)) continue;
        workoutSeen.add(key);

        const duration = Number(a.duration);
        const durationMin = /^s(ec)?$/i.test(a.durationUnit ?? 'min')
          ? duration / 60
          : /^h(r|our)?$/i.test(a.durationUnit ?? '')
            ? duration * 60
            : duration;
        const energy = Number(a.totalEnergyBurned);
        const kcal = /^kj$/i.test(a.totalEnergyBurnedUnit ?? '') ? energy / 4.184 : energy;

        workouts.push({
          date: start.day,
          type: prettyActivity(a.workoutActivityType ?? ''),
          durationMin: Math.max(0, Math.round(durationMin)),
          kcal: Number.isFinite(kcal) ? Math.max(0, Math.round(kcal)) : 0,
          startMs: start.ms,
        });
      }
    }

    // Keep only the unparsed tail, plus a little slack for a straddling tag.
    buffer = cursor > 0 ? buffer.slice(cursor) : buffer;
    if (buffer.length > 1_000_000) buffer = buffer.slice(-1_000_000);

    if (opts.onProgress && bytesRead - lastReport > 4_000_000) {
      lastReport = bytesRead;
      opts.onProgress({ bytesRead, records });
    }
  }
  opts.onProgress?.({ bytesRead, records });

  /* --------- collapse per-source counts, rather than summing them --------- */

  // Health shows one number per day, not the sum of every device that saw the
  // walk. Taking the largest single source is the closest honest approximation
  // without Apple's source-priority list: it never inflates, and it matches
  // the device that actually recorded the day.
  const pickMax = (perDay: Map<string, Map<string, number>>) => {
    const out = new Map<string, number>();
    for (const [day, sources] of perDay) out.set(day, Math.max(...sources.values()));
    return out;
  };

  const sleep = new Map<string, { bedtime: string; wake: string; durationMin: number }>();
  for (const [night, { asleep, inBed, offsetMin }] of sleepNights) {
    // Prefer real asleep samples; older exports only recorded time in bed.
    const source = asleep.length ? asleep : inBed;
    const minutes = Math.round(mergeIntervals(source.map((i) => [...i] as Interval)) / 60_000);
    if (minutes <= 0) continue;
    const from = Math.min(...source.map((i) => i[0]));
    const to = Math.max(...source.map((i) => i[1]));
    sleep.set(night, {
      bedtime: hhmm(from, offsetMin),
      wake: hhmm(to, offsetMin),
      durationMin: minutes,
    });
  }

  return {
    steps: pickMax(steps),
    water: pickMax(water),
    weight: new Map([...weightLatest].map(([d, v]) => [d, Math.round(v.kg * 10) / 10])),
    sleep,
    workouts,
    bytesRead,
    skippedTypes,
  };
}

/**
 * Wall-clock time in the sample's own offset.
 *
 * Deliberately not getHours(), which formats in whatever timezone the *reader*
 * is in: a night slept at 23:00 in Delhi came back as 17:30 when parsed on a
 * UTC machine. The day a sample belongs to is already taken in its own offset,
 * so the time shown beside it has to match.
 */
function hhmm(ms: number, offsetMin: number): string {
  const d = new Date(ms + offsetMin * 60_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** Days touched by a metric, for the pre-import summary. */
export function metricSummary(data: HealthImport): Record<HealthMetric, { days: number; range: string }> {
  const range = (days: string[]) => {
    if (!days.length) return '—';
    const sorted = [...days].sort();
    return sorted[0] === sorted[sorted.length - 1]
      ? sorted[0]
      : `${sorted[0]} → ${sorted[sorted.length - 1]}`;
  };
  const workoutDays = [...new Set(data.workouts.map((w) => w.date))];
  return {
    steps: { days: data.steps.size, range: range([...data.steps.keys()]) },
    weight: { days: data.weight.size, range: range([...data.weight.keys()]) },
    sleep: { days: data.sleep.size, range: range([...data.sleep.keys()]) },
    water: { days: data.water.size, range: range([...data.water.keys()]) },
    workouts: { days: data.workouts.length, range: range(workoutDays) },
  };
}
