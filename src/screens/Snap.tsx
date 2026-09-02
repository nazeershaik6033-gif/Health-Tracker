import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '@/stores/useApp';
import { addMealItems, addSnap, deleteSnap, getSnap, getSnapImage, updateSnap } from '@/db/repo';
import { analyseMealPhoto } from '@/ai/service';
import { hasKey, modelFor } from '@/ai/registry';
import { describeError, errorDetail } from '@/ai/types';
import { useCamera } from '@/lib/camera';
import { blobToImagePart, canvasToBlob, captureFrame, prepareImage } from '@/lib/image';
import {
  formatPortion,
  per100gFromItem,
  rescaleMealItem,
  roundNutrients,
  scaleNutrients,
  sumNutrients,
} from '@/lib/nutrition';
import { MealPickerSheet } from '@/components/MealPickerSheet';
import { PortionSheet } from '@/components/PortionSheet';
import { Button, Card, PageHeader, ScoreCircle, Skeleton } from '@/components/ui';
import {
  IconCamera,
  IconClose,
  IconGallery,
  IconRefresh,
  IconSparkle,
  IconTorch,
  IconTrash,
  IconWarning,
} from '@/components/icons';
import { MEAL_SLOT_LABEL, type MealItem, type MealSlot, type Snap as SnapRow, type SnapAnalysis } from '@/types';

type Phase = 'capture' | 'analysing' | 'result' | 'error';

export default function Snap() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { settings, selectedDate, showToast, showConfirm } = useApp();
  // Two inputs, because `capture` is a one-way door: with it the OS opens the
  // camera and the photo library is unreachable, without it the library. One
  // input cannot serve both affordances.
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraFileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [phase, setPhase] = useState<Phase>('capture');
  const [snap, setSnap] = useState<SnapRow | null>(null);
  const [preview, setPreview] = useState<string>('');
  const [analysis, setAnalysis] = useState<SnapAnalysis | null>(null);
  const [error, setError] = useState('');
  // Provider, model and HTTP status behind the friendly message — the only
  // thing that makes a failed reading actionable or reportable.
  const [detail, setDetail] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const keyed = hasKey(settings);
  const camera = useCamera({ autoStart: phase === 'capture' && keyed });

  /* ------------------------------ analysis ----------------------------- */

  /**
   * `image` is passed straight through on the capture path, where the blob is
   * already in hand; "Try again" has only the row, so it reads the full image
   * back out of its own table.
   */
  const analyse = useCallback(
    async (row: SnapRow, image?: Blob) => {
      setPhase('analysing');
      setError('');
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        await updateSnap(row.id, { status: 'analysing' });
        const full = image ?? (await getSnapImage(row.id));
        if (!full) throw new Error('That photo is no longer stored on this device.');
        const part = await blobToImagePart(full);
        const result = await analyseMealPhoto(settings, part, controller.signal);
        await updateSnap(row.id, { status: 'ready', analysis: result });
        setAnalysis(result);
        setPhase('result');
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const message = describeError(err);
        await updateSnap(row.id, { status: 'failed', error: message });
        setError(message);
        setDetail(errorDetail(err, settings.provider, modelFor(settings)));
        setPhase('error');
      }
    },
    [settings],
  );

  /** Shared entry point for camera capture, file picking and share-target. */
  const ingest = useCallback(
    async (blob: Blob, autoTracked = false) => {
      const prepared = await prepareImage(blob);
      const row = await addSnap(
        {
          date: selectedDate,
          thumb: prepared.thumb,
          width: prepared.width,
          height: prepared.height,
          status: 'pending',
          autoTracked,
        },
        prepared.full,
      );
      setSnap(row);
      setPreview(URL.createObjectURL(prepared.full));
      camera.stop();
      if (keyed) await analyse(row, prepared.full);
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
      const full = await getSnapImage(id);
      // Fall back to the thumbnail: a stored snap should still be viewable if
      // its full image went missing, rather than showing an empty frame.
      setPreview(URL.createObjectURL(full ?? row.thumb));
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

  /**
   * The estimate was accept-or-discard: a wrong portion meant throwing the
   * whole reading away and logging by hand. Items can now be corrected or
   * dropped before saving, with the totals recomputed from what is left.
   *
   * Only the snap's draft analysis changes here — nothing is logged until
   * Save, so the day's numbers are untouched.
   */
  function reviseItems(items: MealItem[]) {
    if (!analysis) return;
    const next: SnapAnalysis = {
      ...analysis,
      items,
      totals: sumNutrients(items.map((i) => i.nutrients)),
    };
    setAnalysis(next);
    if (snap) void updateSnap(snap.id, { analysis: next });
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
    setDetail('');
    setPhase('capture');
    void camera.start();
  }

  /* ------------------------------- render ------------------------------ */

  // svh, not dvh or min-h-dvh, for a screen whose shutter is pinned to the
  // bottom and which must never scroll:
  //   min-h-dvh  lets the column grow past the screen instead of fitting in it
  //   dvh        tracks the *current* viewport, so it grows as browser chrome
  //              retracts — the shutter then sits under a toolbar that is
  //              about to come back
  //   svh        is the viewport with chrome fully shown, the one size that
  //              fits in every state
  // Each phase below owns its own scrolling.
  return (
    <div className="flex h-svh flex-col overflow-hidden bg-black">
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

      {/* Gallery picker — deliberately no `capture`, which would make the OS
          launch the camera and hide the photo library entirely. */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) await ingest(file);
        }}
      />
      {/* The OS camera app, for when getUserMedia can't give us a live preview. */}
      <input
        ref={cameraFileRef}
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
        <div className="relative flex min-h-0 flex-1 flex-col">
          {/* min-h-0 so the preview yields space to the shutter bar below
              rather than shoving it off the bottom of the screen. */}
          <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
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
                  <div className="flex flex-col gap-2">
                    <Button variant="secondary" onClick={() => fileRef.current?.click()}>
                      Choose from gallery
                    </Button>
                    {/* The OS camera app is a separate permission from
                        getUserMedia, so this often works when the preview
                        above does not. */}
                    <Button variant="ghost" onClick={() => cameraFileRef.current?.click()}>
                      Take a photo
                    </Button>
                  </div>
                )}
              </div>
            )}
            {camera.status === 'live' && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="h-[68%] w-[86%] rounded-3xl border-2 border-white/35" />
              </div>
            )}
          </div>

          {/* A browser toolbar is not a safe-area inset, so in a Safari tab
              env(safe-area-inset-bottom) is 0 and pb-safe alone left the
              shutter tucked under the toolbar. The floor gives it real
              clearance there while notched devices still get their inset. */}
          <div className="bg-black px-6 pt-5 pb-[max(env(safe-area-inset-bottom),1.5rem)]">
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
        <div className="scroll-y flex-1 bg-[var(--surface-canvas)] px-4 pt-3 pb-8">
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
        <div className="scroll-y flex-1 bg-[var(--surface-canvas)] px-4 pt-3 pb-32">
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
              <p className="flex items-start gap-1.5 accent-card accent-amber p-2.5 text-[12px]">
                <IconWarning width={14} height={14} className="mt-px shrink-0" />
                Low confidence on this one — check the portions below before saving.
              </p>
            )}
          </Card>

          <h3 className="mt-4 mb-1 px-1 text-[13px] font-bold text-secondary">
            What&apos;s on the plate
          </h3>
          <p className="mb-1 px-1 text-[11.5px] text-muted">
            Tap anything to fix the portion, or remove it. Nothing is logged until you save.
          </p>
          <Card className="py-1">
            <ul>
              {analysis.items.map((item, i) => (
                <li
                  key={`${item.name}-${i}`}
                  className="flex items-center gap-2.5 border-b border-[var(--surface-border)] py-2.5 last:border-0"
                >
                  {item.score !== undefined && <ScoreCircle score={item.score} size={28} />}
                  <button
                    type="button"
                    onClick={() => setEditIndex(i)}
                    aria-label={`Edit ${item.name}`}
                    className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold">{item.name}</span>
                      <span className="block text-[12px] text-secondary">
                        {formatPortion(item.qty, item.servingLabel)} · {Math.round(item.grams)} g
                      </span>
                    </span>
                    <span className="tabular text-[13px] font-bold">
                      {Math.round(item.nutrients.kcal)}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${item.name}`}
                    onClick={() =>
                      reviseItems(analysis.items.filter((_, j) => j !== i))
                    }
                    className="shrink-0 rounded-lg p-1.5 text-muted"
                  >
                    <IconTrash width={15} height={15} />
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          {analysis.take && (
            <div className="mt-3 accent-card p-3.5">
              <p className="mb-1 flex items-center gap-1.5 text-[12px] font-bold text-brand-700">
                <IconSparkle width={13} height={13} />
                Ria&apos;s take
              </p>
              <p className="text-[13px] leading-relaxed text-brand-800/90">{analysis.take}</p>
            </div>
          )}

          <div className="dock inset-x-0 mx-auto flex max-w-lg gap-2 border-t border-[var(--surface-border)] bg-[var(--surface-card)] px-4 pt-3 pb-safe">
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
        <div className="scroll-y flex flex-1 flex-col items-center justify-center gap-4 bg-[var(--surface-canvas)] px-8 py-6 text-center">
          {preview && (
            <img src={preview} alt="" className="h-40 w-40 rounded-2xl object-cover opacity-60" />
          )}
          <IconWarning width={30} height={30} className="text-amber-500" />
          <p className="text-[14px] font-semibold">{error}</p>
          {detail && (
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(detail)}
              title="Tap to copy"
              className="tabular max-w-full rounded-lg surface-sunken px-2.5 py-1.5 text-[11px] break-words text-muted"
            >
              {detail}
            </button>
          )}
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

          {/* The photo is already saved by this point — ingest() writes it
              before analysis is attempted, so it survives in the gallery.
              "Start over" deliberately keeps it (a failed reading is often
              worth retrying later), which left no way at all to throw a bad
              photo away from here. */}
          {snap && (
            <button
              type="button"
              onClick={() =>
                showConfirm({
                  title: 'Delete this photo?',
                  body: 'It is removed from your Snap Gallery and cannot be analysed again.',
                  onConfirm: async () => {
                    await deleteSnap(snap.id);
                    showToast({ message: 'Photo deleted' });
                    reset();
                  },
                })
              }
              // The accessible name has to contain the visible text, or voice
              // control cannot activate what the button says it is (WCAG 2.5.3).
              aria-label="Delete photo"
              className="flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-semibold text-muted transition-transform active:scale-95"
            >
              <IconTrash width={15} height={15} />
              Delete photo
            </button>
          )}
        </div>
      )}

      {editIndex !== null && analysis?.items[editIndex] && (
        <PortionSheet
          title={analysis.items[editIndex].name}
          per100g={per100gFromItem(analysis.items[editIndex])}
          servings={[
            {
              label: analysis.items[editIndex].servingLabel,
              grams:
                analysis.items[editIndex].grams / (analysis.items[editIndex].qty || 1),
            },
          ]}
          initialQty={analysis.items[editIndex].qty}
          initialServingLabel={analysis.items[editIndex].servingLabel}
          confirmLabel={(kcal) => `Set to ${kcal} Cal`}
          onClose={() => setEditIndex(null)}
          onConfirm={(qty, label, grams) => {
            const current = analysis.items[editIndex];
            const revised =
              grams !== undefined
                ? {
                    ...current,
                    qty: 1,
                    servingLabel: label,
                    grams,
                    nutrients: roundNutrients(
                      scaleNutrients(per100gFromItem(current), grams / 100),
                    ),
                  }
                : rescaleMealItem(current, qty, label);
            reviseItems(analysis.items.map((it, j) => (j === editIndex ? revised : it)));
            setEditIndex(null);
          }}
          onDelete={() => {
            reviseItems(analysis.items.filter((_, j) => j !== editIndex));
            setEditIndex(null);
          }}
        />
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
