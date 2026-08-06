import { db } from './schema';
import { blobToBase64 } from '@/lib/image';
import type { Snap } from '@/types';

/**
 * JSON export/import — the only backup path in a local-first app with no
 * server, so it has to round-trip everything including photos.
 *
 * Photos are the reason `includePhotos` exists: a few hundred snaps is tens
 * of megabytes as base64, which some browsers will refuse to serialise in one
 * string. The metadata-only export stays small and still restores every
 * number.
 */

export const EXPORT_VERSION = 2;

interface SerialisedSnap extends Omit<Snap, 'blob' | 'thumb'> {
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
  ]);

  const serialisedSnaps: SerialisedSnap[] = await Promise.all(
    snaps.map(async (snap) => {
      const { blob, thumb, ...rest } = snap;
      if (!includePhotos) return rest;
      return {
        ...rest,
        blob: await blobToBase64(blob),
        thumb: await blobToBase64(thumb),
        blobType: blob.type || 'image/jpeg',
      };
    }),
  );

  // API keys are deliberately stripped: an export is a file that gets emailed
  // to yourself and left in a downloads folder.
  const safeSettings = settings.map((s) => ({ ...s, apiKeys: {} }));

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
    },
  };
}

export interface ImportSummary {
  imported: Record<string, number>;
  photosRestored: number;
  warnings: string[];
}

export async function importData(bundle: unknown): Promise<ImportSummary> {
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

  const warnings: string[] = [];
  const imported: Record<string, number> = {};
  let photosRestored = 0;

  const { snaps: rawSnaps, settings: rawSettings, ...rest } = parsed.data as Record<
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
      apiKeys: current?.apiKeys ?? {},
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
        await db.snaps.put({ ...meta, blob, thumb } as never);
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
