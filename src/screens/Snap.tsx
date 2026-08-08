import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '@/stores/useApp';
import { addMealItems, addSnap, getSnap, updateSnap } from '@/db/repo';
import { analyseMealPhoto } from '@/ai/service';
import { hasKey } from '@/ai/registry';
import { describeError } from '@/ai/types';
import { useCamera } from '@/lib/camera';
import { blobToImagePart, canvasToBlob, captureFrame, prepareImage } from '@/lib/image';
import { formatPortion } from '@/lib/nutrition';
import { MealPickerSheet } from '@/components/MealPickerSheet';
import { Button, Card, PageHeader, ScoreCircle, Skeleton } from '@/components/ui';
import {
  IconCamera,
  IconClose,
  IconGallery,
  IconRefresh,
  IconSparkle,
  IconTorch,
  IconWarning,
} from '@/components/icons';
import { MEAL_SLOT_LABEL, type MealSlot, type Snap as SnapRow, type SnapAnalysis } from '@/types';

type Phase = 'capture' | 'analysing' | 'result' | 'error';

export default function Snap() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { settings, selectedDate, showToast } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [phase, setPhase] = useState<Phase>('capture');
  const [snap, setSnap] = useState<SnapRow | null>(null);
  const [preview, setPreview] = useState<string>('');
  const [analysis, setAnalysis] = useState<SnapAnalysis | null>(null);
  const [error, setError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  const keyed = hasKey(settings);
  const camera = useCamera({ autoStart: phase === 'capture' && keyed });

  /* ------------------------------ analysis ----------------------------- */

  const analyse = useCallback(
    async (row: SnapRow) => {
      setPhase('analysing');
      setError('');
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        await updateSnap(row.id, { status: 'analysing' });
        const part = await blobToImagePart(row.blob);
        const result = await analyseMealPhoto(settings, part, controller.signal);
        await updateSnap(row.id, { status: 'ready', analysis: result });
        setAnalysis(result);
        setPhase('result');
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const message = describeError(err);
        await updateSnap(row.id, { status: 'failed', error: message });
        setError(message);
        setPhase('error');
      }
    },
    [settings],
  );

  /** Shared entry point for camera capture, file picking and share-target. */
  const ingest = useCallback(
    async (blob: Blob, autoTracked = false) => {
      const prepared = await prepareImage(blob);
      const row = await addSnap({
        date: selectedDate,
        blob: prepared.full,
        thumb: prepared.thumb,
        width: prepared.width,
        height: prepared.height,
        status: 'pending',
        autoTracked,
      });
      setSnap(row);
      setPreview(URL.createObjectURL(prepared.full));
      camera.stop();
      if (keyed) await analyse(row);
      else {
        setError('Add an AI key in Settings to read this photo.');
        setPhase('error');
      }
    },
    [selectedDate, keyed, analyse, camera],
  );

  /* --------------------------- share target ---------------------------- */

  useEffect(() => {
    const shared = params.get('shared');
    if (!shared) return;
    setParams({}, { replace: true });

    if (shared === 'empty' || shared === 'error') {
      setError(
        shared === 'empty'
          ? "That share didn't include a photo."
          : 'Something went wrong receiving that share.',
      );
      setPhase('error');
      return;
    }

    void (async () => {
      // The service worker parked each shared file in the cache; pull the
      // first one out, use it, then clear the entry so it can't be replayed.
      const ids = shared.split(',').filter(Boolean);
      const cache = await caches.open('healthify-shared-v1');
      for (const id of ids) {
        // The worker keyed these under the app's base, which is not the
        // domain root on a Pages project site.
        const key = `${import.meta.env.BASE_URL}__shared/${id}`;
        const res = await cache.match(key);
        await cache.delete(key);
        if (!res) continue;
        const blob = await res.blob();
        await ingest(blob, settings.autoTrack);
        break;
      }
    })();
    // Runs once per navigation carrying a ?shared= param.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  /* ------------------------- upload from gallery ----------------------- */

  // Arriving with ?pick=1 (from the Snap Gallery's Upload button) opens the
  // file picker straight away, so "upload a photo" is one tap rather than a
  // hunt for the small gallery icon on the camera screen.
  useEffect(() => {
    if (params.get('pick') !== '1') return;
    const next = new URLSearchParams(params);
    next.delete('pick');
    setParams(next, { replace: true });
    fileRef.current?.click();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------------------- existing snap -------------------------- */

  useEffect(() => {
    const id = params.get('id');
    if (!id) return;
    void (async () => {
      const row = await getSnap(id);
      if (!row) return;
      setSnap(row);
      setPreview(URL.createObjectURL(row.blob));
      if (row.analysis) {
        setAnalysis(row.analysis);
        setPhase('result');
      } else {
        setPhase('error');
        setError(row.error || 'This snap has not been analysed yet.');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  /* ------------------------------ actions ------------------------------ */

  async function shoot() {
    const video = camera.videoRef.current;
    if (!video || camera.status !== 'live') return;
    const blob = await canvasToBlob(captureFrame(video), 0.9);
    await ingest(blob);
  }

  async function save(slot: MealSlot) {
    if (!analysis || !snap) return;
    const meal = await addMealItems(selectedDate, slot, analysis.items, {
      snapId: snap.id,
      healthScore: analysis.healthScore,
      aiNote: analysis.take,
    });
    await updateSnap(snap.id, { status: 'logged', mealId: meal.id });
    setPickerOpen(false);
    showToast({ message: `${analysis.title} added to ${MEAL_SLOT_LABEL[slot]}` });
    navigate(`/meal/${meal.id}`, { replace: true });
  }

  function reset() {
    abortRef.current?.abort();
    if (preview) URL.revokeObjectURL(preview);
    setPreview('');
    setSnap(null);
    setAnalysis(null);
    setError('');
    setPhase('capture');
    void camera.start();
  }

  /* ------------------------------- render ------------------------------ */

  return (
    <div className="flex min-h-dvh flex-col bg-black">
      <PageHeader
        title="Snap a meal"
        back={() => navigate(-1)}
        action={
          <div className="flex items-center gap-1">
            {phase === 'capture' && camera.torchAvailable && (
              <button
                type="button"
                onClick={camera.toggleTorch}
                aria-label="Toggle torch"
                aria-pressed={camera.torchOn}
                className={`rounded-full p-2 ${camera.torchOn ? 'text-accent-500' : 'text-secondary'}`}
              >
                <IconTorch width={20} height={20} />
              </button>
            )}
            <button
              type="button"
              onClick={() => navigate('/snap/gallery')}
              aria-label="Snap gallery"
              className="rounded-full p-2 text-secondary"
            >
              <IconGallery width={20} height={20} />
            </button>
          </div>
        }
      />

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) await ingest(file);
        }}
      />

      {/* --------------------------- capture --------------------------- */}
      {phase === 'capture' && (
        <div className="relative flex flex-1 flex-col">
          <div className="relative flex-1 overflow-hidden bg-black">
            <video
              ref={camera.videoRef}
              playsInline
              muted
              autoPlay
              className="h-full w-full object-cover"
            />
            {/* Without a key the camera is deliberately not started, since a
                photo could not be read. Saying so beats "Camera not started",
                which reads as a broken camera rather than a missing key. */}
            {!keyed && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center text-white/80">
                <IconSparkle width={30} height={30} className="text-accent-500" />
                <p className="text-[15px] font-bold text-white">Snap needs an AI key</p>
                <p className="max-w-xs text-[13px] leading-relaxed">
                  Reading calories from a photo is the one thing here that can&apos;t run
                  on-device. Everything else — searching foods, barcodes, and every tracker —
                  works without one.
                </p>
                <div className="flex flex-col gap-2 pt-1">
                  <Button onClick={() => navigate('/settings')}>Add a key in Settings</Button>
                  <Button variant="secondary" onClick={() => navigate('/search')}>
                    Search the food database instead
                  </Button>
                  <Button variant="ghost" onClick={() => navigate('/scan')}>
                    Scan a barcode
                  </Button>
                </div>
              </div>
            )}

            {keyed && camera.status !== 'live' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center text-white/80">
                <IconCamera width={34} height={34} />
                <p className="text-[13.5px]">
                  {camera.status === 'starting'
                    ? 'Starting camera…'
                    : camera.error || 'Camera not started'}
                </p>
                {(camera.status === 'denied' ||
                  camera.status === 'error' ||
                  camera.status === 'unavailable') && (
                  <Button variant="secondary" onClick={() => fileRef.current?.click()}>
                    Choose a photo instead
                  </Button>
                )}
              </div>
            )}
            {camera.status === 'live' && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="h-[68%] w-[86%] rounded-3xl border-2 border-white/35" />
              </div>
            )}
          </div>

          <div className="bg-black px-6 pt-5 pb-safe">
            <p className="mb-4 text-center text-[12.5px] text-white/60">
              {keyed
                ? 'Fit the whole plate in frame. Good light gives a much better estimate.'
                : 'Photo tracking is the only feature that needs a key.'}
            </p>
            <div className="flex items-center justify-around pb-4">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                aria-label="Choose from gallery"
                className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-white"
              >
                <IconGallery width={22} height={22} />
              </button>
              <button
                type="button"
                onClick={shoot}
                disabled={camera.status !== 'live'}
                aria-label="Take photo"
                className="flex h-18 w-18 items-center justify-center rounded-full border-4 border-white/40 disabled:opacity-40"
                style={{ height: '4.5rem', width: '4.5rem' }}
              >
                <span className="h-14 w-14 rounded-full bg-white" />
              </button>
              <div className="h-12 w-12" />
            </div>
          </div>
        </div>
      )}

      {/* -------------------------- analysing -------------------------- */}
      {phase === 'analysing' && (
        <div className="flex-1 bg-[var(--surface-canvas)] px-4 pt-3 pb-8">
          {preview && (
            <img
              src={preview}
              alt="Your meal"
              className="mb-4 h-56 w-full rounded-2xl object-cover"
            />
          )}
          <Card className="space-y-3">
            <div className="flex items-center gap-2">
              <IconSparkle width={16} height={16} className="animate-pulse text-brand-600" />
              <p className="text-[14px] font-bold">Reading your plate…</p>
            </div>
            <Skeleton className="h-3 w-3/4 rounded" />
            <Skeleton className="h-3 w-1/2 rounded" />
            <div className="grid grid-cols-4 gap-2 pt-1">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-xl" />
              ))}
            </div>
          </Card>
          <Button variant="secondary" full className="mt-4" onClick={reset}>
            Cancel
          </Button>
        </div>
      )}

      {/* ---------------------------- result --------------------------- */}
      {phase === 'result' && analysis && (
        <div className="flex-1 bg-[var(--surface-canvas)] px-4 pt-3 pb-32">
          {preview && (
            <img
              src={preview}
              alt={analysis.title}
              className="mb-3 h-52 w-full rounded-2xl object-cover"
            />
          )}

          <Card className="space-y-3">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-[17px] font-bold tracking-tight">{analysis.title}</h2>
              <ScoreCircle score={analysis.healthScore} />
            </div>

            <div className="surface-sunken flex items-center justify-between rounded-xl px-3.5 py-3">
              <span className="text-[13px] font-semibold text-secondary">Calories</span>
              <span className="tabular text-2xl font-extrabold">
                {Math.round(analysis.totals.kcal)}
              </span>
            </div>

            <div className="grid grid-cols-4 gap-2">
              <Macro label="Protein" value={analysis.totals.protein} />
              <Macro label="Fat" value={analysis.totals.fat} />
              <Macro label="Carbs" value={analysis.totals.carbs} />
              <Macro label="Fibre" value={analysis.totals.fibre} />
            </div>

            {analysis.confidence === 'low' && (
              <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 p-2.5 text-[12px] text-amber-800">
                <IconWarning width={14} height={14} className="mt-px shrink-0" />
                Low confidence on this one — check the portions below before saving.
              </p>
            )}
          </Card>

          <h3 className="mt-4 mb-1 px-1 text-[13px] font-bold text-secondary">
            What&apos;s on the plate
          </h3>
          <Card className="py-1">
            <ul>
              {analysis.items.map((item, i) => (
                <li
                  key={`${item.name}-${i}`}
                  className="flex items-center gap-2.5 border-b border-[var(--surface-border)] py-2.5 last:border-0"
                >
                  {item.score !== undefined && <ScoreCircle score={item.score} size={28} />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold">{item.name}</p>
                    <p className="text-[12px] text-secondary">
                      {formatPortion(item.qty, item.servingLabel)} · {Math.round(item.grams)} g
                    </p>
                  </div>
                  <span className="tabular text-[13px] font-bold">
                    {Math.round(item.nutrients.kcal)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          {analysis.take && (
            <div className="mt-3 rounded-2xl bg-brand-50 p-3.5">
              <p className="mb-1 flex items-center gap-1.5 text-[12px] font-bold text-brand-700">
                <IconSparkle width={13} height={13} />
                Ria&apos;s take
              </p>
              <p className="text-[13px] leading-relaxed text-brand-800/90">{analysis.take}</p>
            </div>
          )}

          <div className="fixed inset-x-0 bottom-0 mx-auto flex max-w-lg gap-2 border-t border-[var(--surface-border)] bg-[var(--surface-card)] px-4 pt-3 pb-safe">
            <Button variant="secondary" onClick={reset} aria-label="Retake">
              <IconRefresh width={17} height={17} />
            </Button>
            <Button size="lg" full onClick={() => setPickerOpen(true)}>
              Save {Math.round(analysis.totals.kcal)} Cal
            </Button>
          </div>
        </div>
      )}

      {/* ----------------------------- error --------------------------- */}
      {phase === 'error' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-[var(--surface-canvas)] px-8 text-center">
          {preview && (
            <img src={preview} alt="" className="h-40 w-40 rounded-2xl object-cover opacity-60" />
          )}
          <IconWarning width={30} height={30} className="text-amber-500" />
          <p className="text-[14px] font-semibold">{error}</p>
          <div className="flex gap-2">
            {!keyed ? (
              <Button onClick={() => navigate('/settings')}>Open Settings</Button>
            ) : (
              snap && <Button onClick={() => analyse(snap)}>Try again</Button>
            )}
            <Button variant="secondary" onClick={reset}>
              <IconClose width={16} height={16} />
              Start over
            </Button>
          </div>
        </div>
      )}

      <MealPickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={save}
        date={selectedDate}
      />
    </div>
  );
}

function Macro({ label, value }: { label: string; value: number }) {
  return (
    <div className="surface-sunken rounded-xl py-2.5 text-center">
      <p className="tabular text-[15px] font-bold">{Math.round(value)}g</p>
      <p className="text-[10.5px] text-muted">{label}</p>
    </div>
  );
}
