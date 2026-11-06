import { db } from './schema';
import { blobToBase64 } from '@/lib/image';
import { DEFAULT_FATSECRET, type Snap } from '@/types';

/**
 * JSON export/import — the only backup path in a local-first app with no
 * server, so it has to round-trip everything including photos.
 *
 * Photos are the reason `includePhotos` exists: a few hundred snaps is tens
 * of megabytes as base64, which some browsers will refuse to serialise in one
 * string. The metadata-only export stays small and still restores every
 * number.
 */

/**
 * 3 adds the `exercises` table; 4 adds `favourites`. Older bundles import
 * unchanged — the restore loop skips table keys a file doesn't carry, and the
 * guard below only rejects files from a *newer* version than this build
 * understands.
 *
 * The on-disk shape of a snap did not change when full images moved to their
 * own table: a bundle still carries one object per photo with both encodings
 * on it, and the import splits them back apart.
 */
export const EXPORT_VERSION = 4;

interface SerialisedSnap extends Omit<Snap, 'thumb'> {
  blob?: string;
  thumb?: string;
  blobType?: string;
}

export interface ExportBundle {
  version: number;
  exportedAt: string;
  app: 'healthify';
  includesPhotos: boolean;
  data: Record<string, unknown[]>;
}

async function base64ToBlob(base64: string, type: string): Promise<Blob> {
  const res = await fetch(`data:${type};base64,${base64}`);
  return res.blob();
}

export async function exportData(includePhotos: boolean): Promise<ExportBundle> {
  const [
    profile,
    settings,
    foods,
    meals,
    snaps,
    water,
    sleep,
    weight,
    steps,
    workouts,
    chats,
    insights,
    plans,
    exercises,
    favourites,
  ] = await Promise.all([
    db.profile.toArray(),
    db.settings.toArray(),
    // Seed foods are shipped with the app; exporting them just bloats the file.
    db.foods.filter((f) => f.source !== 'seed' || f.useCount > 0).toArray(),
    db.meals.toArray(),
    db.snaps.toArray(),
    db.water.toArray(),
    db.sleep.toArray(),
    db.weight.toArray(),
    db.steps.toArray(),
    db.workouts.toArray(),
    db.chats.toArray(),
    db.insights.toArray(),
    db.plans.toArray(),
    // Same reasoning as foods: the seed catalog ships with the app, so only
    // custom entries and ones actually used are worth carrying.
    db.exercises.filter((e) => e.source !== 'seed' || e.useCount > 0).toArray(),
    db.favourites.toArray(),
  ]);

  // Full images are fetched per snap rather than read as one table: with photos
  // switched off nothing pulls them out of IndexedDB at all.
  const serialisedSnaps: SerialisedSnap[] = await Promise.all(
    snaps.map(async (snap) => {
      const { thumb, ...rest } = snap;
      if (!includePhotos) return rest;
      const full = (await db.snapImages.get(snap.id))?.blob;
      if (!full) return rest;
      return {
        ...rest,
        blob: await blobToBase64(full),
        thumb: await blobToBase64(thumb),
        blobType: full.type || 'image/jpeg',
      };
    }),
  );

  // Credentials are deliberately stripped: an export is a file that gets
  // emailed to yourself and left in a downloads folder. FatSecret is blanked
  // and switched off rather than left enabled-but-broken on the next device.
  const safeSettings = settings.map((s) => ({
    ...s,
    apiKeys: {},
    fatsecret: { ...DEFAULT_FATSECRET, region: s.fatsecret?.region ?? DEFAULT_FATSECRET.region },
  }));

  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    app: 'healthify',
    includesPhotos: includePhotos,
    data: {
      profile,
      settings: safeSettings,
      foods,
      meals,
      snaps: serialisedSnaps,
      water,
      sleep,
      weight,
      steps,
      workouts,
      chats,
      insights,
      plans,
      exercises,
      favourites,
    },
  };
}

export interface ImportSummary {
  imported: Record<string, number>;
  photosRestored: number;
  warnings: string[];
}

export async function importData(bundle: unknown): Promise<ImportSummary> {
  const parsed = assertBundle(bundle);

  const warnings: string[] = [];
  const imported: Record<string, number> = {};
  let photosRestored = 0;

  const { snaps: rawSnaps, settings: rawSettings, ...rest } = (parsed.data ?? {}) as Record<
    string,
    unknown[]
  >;

  // Everything except snaps and settings restores as-is.
  const tables: Record<string, { bulkPut(rows: never[]): Promise<unknown> }> = {
    profile: db.profile,
    foods: db.foods,
    meals: db.meals,
    water: db.water,
    sleep: db.sleep,
    weight: db.weight,
    steps: db.steps,
    workouts: db.workouts,
    chats: db.chats,
    insights: db.insights,
    plans: db.plans,
    exercises: db.exercises,
    favourites: db.favourites,
  } as never;

  for (const [name, table] of Object.entries(tables)) {
    const rows = rest[name];
    if (!Array.isArray(rows) || rows.length === 0) continue;
    try {
      await table.bulkPut(rows as never[]);
      imported[name] = rows.length;
    } catch {
      warnings.push(`Some ${name} rows could not be restored.`);
    }
  }

  // Settings restore without touching the keys already on this device.
  if (Array.isArray(rawSettings) && rawSettings.length) {
    const incoming = rawSettings[0] as Record<string, unknown>;
    const current = await db.settings.get('app');
    await db.settings.put({
      ...(current ?? {}),
      ...incoming,
      id: 'app',
      // Credentials already on this device win: a backup never carries them,
      // so taking the incoming blanks would log the user out of their own key.
      apiKeys: current?.apiKeys ?? {},
      fatsecret: current?.fatsecret ?? DEFAULT_FATSECRET,
    } as never);
    imported.settings = 1;
  }

  if (Array.isArray(rawSnaps) && rawSnaps.length) {
    let restored = 0;
    for (const raw of rawSnaps as SerialisedSnap[]) {
      try {
        if (!raw.blob || !raw.thumb) {
          // Metadata-only export: the record is useless without its image.
          continue;
        }
        const type = raw.blobType || 'image/jpeg';
        const [blob, thumb] = await Promise.all([
          base64ToBlob(raw.blob, type),
          base64ToBlob(raw.thumb, type),
        ]);
        const { blob: _b, thumb: _t, blobType: _bt, ...meta } = raw;
        // Back into the two tables the app now reads.
        await db.transaction('rw', db.snaps, db.snapImages, async () => {
          await db.snaps.put({ ...meta, thumb } as never);
          await db.snapImages.put({ id: meta.id, blob });
        });
        restored++;
      } catch {
        /* skip the one bad snap rather than failing the whole import */
      }
    }
    photosRestored = restored;
    imported.snaps = restored;
    if (restored < rawSnaps.length) {
      warnings.push(
        `${rawSnaps.length - restored} snap${rawSnaps.length - restored === 1 ? '' : 's'} had no photo data and were skipped.`,
      );
    }
  }

  return { imported, photosRestored, warnings };
}

/** What a file contains, shown before an import so it isn't a blind merge. */
export interface BundlePreview {
  version: number;
  exportedAt: string;
  includesPhotos: boolean;
  counts: Record<string, number>;
  total: number;
  from?: string;
  to?: string;
}

export function previewBundle(bundle: unknown): BundlePreview {
  const parsed = assertBundle(bundle);
  const counts: Record<string, number> = {};
  let total = 0;
  const dates: string[] = [];

  for (const [name, rows] of Object.entries(parsed.data ?? {})) {
    if (!Array.isArray(rows)) continue;
    counts[name] = rows.length;
    total += rows.length;
    for (const row of rows) {
      const date = (row as { date?: unknown })?.date;
      if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) dates.push(date);
    }
  }
  dates.sort();

  return {
    version: typeof parsed.version === 'number' ? parsed.version : 1,
    exportedAt: parsed.exportedAt ?? '',
    includesPhotos: Boolean(parsed.includesPhotos),
    counts,
    total,
    from: dates[0],
    to: dates[dates.length - 1],
  };
}

function assertBundle(bundle: unknown): Partial<ExportBundle> {
  if (!bundle || typeof bundle !== 'object') {
    throw new Error('That file is not a Healthify backup.');
  }
  const parsed = bundle as Partial<ExportBundle>;
  if (parsed.app !== 'healthify' || !parsed.data) {
    throw new Error('That file is not a Healthify backup.');
  }
  if (typeof parsed.version === 'number' && parsed.version > EXPORT_VERSION) {
    throw new Error(
      'That backup was made by a newer version of Healthify. Update the app and try again.',
    );
  }
  return parsed;
}

function bundleFilename(bundle: ExportBundle): string {
  return `healthify-backup-${bundle.exportedAt.slice(0, 10)}.json`;
}

/**
 * Hands the file to the OS share sheet where one exists, falling back to a
 * download.
 *
 * On a phone a downloaded JSON lands somewhere most people never look, which
 * makes the backup theoretically present and practically useless. The share
 * sheet puts it into Drive, Files or a chat in one tap.
 */
export async function shareBundle(
  bundle: ExportBundle,
): Promise<{ size: number; shared: boolean }> {
  const json = JSON.stringify(bundle);
  const blob = new Blob([json], { type: 'application/json' });
  const file = new File([blob], bundleFilename(bundle), { type: 'application/json' });

  if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Healthify backup' });
      return { size: blob.size, shared: true };
    } catch (err) {
      // A cancelled share sheet is a deliberate choice, not a failure — don't
      // fall through to a download the user didn't ask for.
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { size: blob.size, shared: false };
      }
    }
  }

  return { ...downloadBundle(bundle), shared: false };
}

export function downloadBundle(bundle: ExportBundle): { size: number } {
  const json = JSON.stringify(bundle);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `healthify-backup-${bundle.exportedAt.slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoke on the next tick so the download has picked the URL up.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { size: blob.size };
}
