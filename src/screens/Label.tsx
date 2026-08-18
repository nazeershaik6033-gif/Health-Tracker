import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/stores/useApp';
import { addMealItems, createFood } from '@/db/repo';
import { readNutritionLabel, draftToFood } from '@/ai/service';
import { hasKey } from '@/ai/registry';
import { describeError } from '@/ai/types';
import { useCamera } from '@/lib/camera';
import { blobToImagePart, canvasToBlob, captureFrame } from '@/lib/image';
import { readLabelOffline, terminateOCR, type LabelReading } from '@/lib/ocr';
import { buildMealItem, scaleNutrients } from '@/lib/nutrition';
import { MealPickerSheet } from '@/components/MealPickerSheet';
import { Button, Card, Field, PageHeader, Skeleton } from '@/components/ui';
import { IconCamera, IconSparkle, IconTorch, IconWarning } from '@/components/icons';
import { MEAL_SLOT_LABEL, type Food, type MealSlot } from '@/types';

type Phase = 'capture' | 'reading' | 'result' | 'error';

/** Nutrition panels are tall and narrow — crop to the middle of the frame. */
const ROI = { x: 0.08, y: 0.16, w: 0.84, h: 0.62 };

export default function Label() {
  const navigate = useNavigate();
  const { settings, selectedDate, showToast } = useApp();
  const camera = useCamera();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraFileRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>('capture');
  const [food, setFood] = useState<Food | null>(null);
  const [rawText, setRawText] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(0);
  const [qty, setQty] = useState('1');
  const [servingLabel, setServingLabel] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  const keyed = hasKey(settings);

  async function readCanvas(canvas: HTMLCanvasElement) {
    setPhase('reading');
    setError('');
    setRawText('');
    setProgress(0.1);
    camera.stop();

    try {
      if (keyed) {
        // The vision model reads panels far more reliably than OCR, including
        // rotated, curved and glare-affected labels.
        const blob = await canvasToBlob(canvas, 0.9);
        const draft = await readNutritionLabel(settings, await blobToImagePart(blob));
        const created = await createFood(draftToFood(draft, 'ai'));
        setFood(created);
        setServingLabel(created.servings[0]?.label ?? '100 g');
        setNote('Read by AI — check the numbers against the pack');
        setPhase('result');
        return;
      }

      const reading: LabelReading = await readLabelOffline(canvas, setProgress);
      if (reading.matched === 0) {
        setRawText(reading.raw);
        setError(
          "Couldn't find nutrition numbers in that image. Try filling the frame with just the panel, in good light.",
        );
        setPhase('error');
        return;
      }
      const created = await createFood({
        name: reading.name,
        per100g: reading.per100g,
        servings: reading.servings,
        source: 'custom',
        tags: ['scanned'],
        verified: false,
      });
      setFood(created);
      setServingLabel(created.servings[0]?.label ?? '100 g');
      setRawText(reading.raw);
      setNote(
        `Read on-device — found ${reading.matched} of 5 values. Check them before saving.`,
      );
      setPhase('result');
    } catch (err) {
      setError(describeError(err));
      setPhase('error');
    } finally {
      void terminateOCR();
    }
  }

  async function shoot() {
    const video = camera.videoRef.current;
    if (!video || camera.status !== 'live') return;
    await readCanvas(captureFrame(video, ROI));
  }

  async function fromFile(file: File) {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    bitmap.close();
    await readCanvas(canvas);
  }

  async function save(slot: MealSlot) {
    if (!food) return;
    const item = buildMealItem(food, servingLabel, Math.max(0, Number(qty) || 1));
    await addMealItems(selectedDate, slot, [item]);
    setPickerOpen(false);
    showToast({ message: `${food.name} added to ${MEAL_SLOT_LABEL[slot]}` });
    navigate('/diet');
  }

  const serving = food?.servings.find((s) => s.label === servingLabel) ?? food?.servings[0];
  const preview = food
    ? scaleNutrients(food.per100g, ((serving?.grams ?? 100) * (Number(qty) || 0)) / 100)
    : null;

  // svh with a hard overflow clip, matching Snap and Scan: `min-h-dvh` let this
  // column grow past the screen, so the shutter sat below the fold and had to
  // be scrolled to. Each phase below owns its own scrolling.
  return (
    <div className="flex h-svh flex-col overflow-hidden bg-black">
      <PageHeader
        title="Read a nutrition label"
        back={() => navigate(-1)}
        action={
          phase === 'capture' && camera.torchAvailable ? (
            <button
              type="button"
              onClick={camera.toggleTorch}
              aria-label="Toggle torch"
              aria-pressed={camera.torchOn}
              className={`mr-1 rounded-full p-2 ${camera.torchOn ? 'text-accent-500' : 'text-secondary'}`}
            >
              <IconTorch width={20} height={20} />
            </button>
          ) : undefined
        }
      />

      {/* No `capture` — it would launch the camera and put the photo library
          out of reach, which is the opposite of what this button offers. */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) await fromFile(file);
        }}
      />
      <input
        ref={cameraFileRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) await fromFile(file);
        }}
      />

      {phase === 'capture' && (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* min-h-0 so the preview yields space to the shutter bar below
              rather than shoving it off the bottom of the screen. */}
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <video
              ref={camera.videoRef}
              playsInline
              muted
              autoPlay
              className="h-full w-full object-cover"
            />
            <div className="pointer-events-none absolute inset-0">
              <div
                className="absolute rounded-xl border-2 border-white shadow-[0_0_0_100vmax_rgba(0,0,0,0.45)]"
                style={{
                  left: `${ROI.x * 100}%`,
                  top: `${ROI.y * 100}%`,
                  width: `${ROI.w * 100}%`,
                  height: `${ROI.h * 100}%`,
                }}
              />
            </div>
            {camera.status !== 'live' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center text-white/80">
                <IconCamera width={32} height={32} />
                <p className="text-[13.5px]">
                  {camera.status === 'starting' ? 'Starting camera…' : camera.error}
                </p>
                <div className="flex flex-col gap-2">
                  <Button variant="secondary" onClick={() => fileRef.current?.click()}>
                    Choose from gallery
                  </Button>
                  <Button variant="ghost" onClick={() => cameraFileRef.current?.click()}>
                    Take a photo
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="bg-black px-6 pt-4 pb-[max(env(safe-area-inset-bottom),1.5rem)]">
            <p className="text-center text-[12.5px] text-white/60">
              Fill the box with the nutrition panel. Flatten the pack if you can.
            </p>
            {!keyed && (
              <p className="mt-1 text-center text-[11px] text-white/40">
                Reading on-device — add an AI key for much better accuracy
              </p>
            )}
            <div className="flex items-center justify-around py-4">
              <div className="h-12 w-12" />
              <button
                type="button"
                onClick={shoot}
                disabled={camera.status !== 'live'}
                aria-label="Capture label"
                className="flex items-center justify-center rounded-full border-4 border-white/40 disabled:opacity-40"
                style={{ height: '4.5rem', width: '4.5rem' }}
              >
                <span className="h-14 w-14 rounded-full bg-white" />
              </button>
              <div className="h-12 w-12" />
            </div>
          </div>
        </div>
      )}

      {phase === 'reading' && (
        <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--surface-canvas)] px-4 pt-6">
          <Card className="space-y-3">
            <div className="flex items-center gap-2">
              <IconSparkle width={16} height={16} className="animate-pulse text-brand-600" />
              <p className="text-[14px] font-bold">
                {keyed ? 'Reading the label…' : 'Running text recognition…'}
              </p>
            </div>
            {!keyed && (
              <div className="surface-sunken h-1.5 overflow-hidden rounded-full">
                <div
                  className="h-full rounded-full bg-brand-500 transition-[width]"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            )}
            <Skeleton className="h-3 w-2/3 rounded" />
            <Skeleton className="h-3 w-1/2 rounded" />
          </Card>
        </div>
      )}

      {phase === 'result' && food && (
        <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--surface-canvas)] px-4 pt-3 pb-32">
          <Card className="space-y-3">
            <Field
              label="Product"
              value={food.name}
              onChange={(e) => setFood({ ...food, name: e.target.value })}
            />
            {note && <p className="text-[11.5px] text-muted">{note}</p>}

            <div>
              <span className="mb-1.5 block text-[13px] font-medium text-secondary">
                Per 100 g — edit anything that looks wrong
              </span>
              <div className="grid grid-cols-5 gap-1.5">
                {(['kcal', 'protein', 'fat', 'carbs', 'fibre'] as const).map((key) => (
                  <label key={key} className="text-center">
                    <input
                      value={food.per100g[key]}
                      onChange={(e) =>
                        setFood({
                          ...food,
                          per100g: { ...food.per100g, [key]: Number(e.target.value) || 0 },
                        })
                      }
                      inputMode="decimal"
                      className="hairline tabular w-full rounded-lg border bg-transparent py-2 text-center text-[14px] font-bold outline-none focus:border-brand-500"
                    />
                    <span className="mt-1 block text-[10px] text-muted">
                      {key === 'kcal' ? 'Cal' : key}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <span className="mb-1.5 block text-[13px] font-medium text-secondary">Serving</span>
              <div className="flex flex-wrap gap-2">
                {food.servings.map((s) => (
                  <button
                    key={s.label}
                    type="button"
                    onClick={() => setServingLabel(s.label)}
                    className={`hairline rounded-full border px-3 py-1.5 text-[13px] font-medium ${
                      s.label === servingLabel ? 'border-brand-500 tint-soft tint-brand' : ''
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <Field
              label="Quantity"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              inputMode="decimal"
              suffix={`× ${serving?.label ?? ''}`}
            />

            {preview && (
              <div className="surface-sunken rounded-xl p-3 text-center">
                <p className="tabular text-2xl font-extrabold">{Math.round(preview.kcal)}</p>
                <p className="text-[11px] text-muted">calories for this portion</p>
              </div>
            )}
          </Card>

          {rawText && (
            <details className="mt-3">
              <summary className="cursor-pointer text-[12px] font-semibold text-secondary">
                What was read from the image
              </summary>
              <pre className="surface-card mt-2 max-h-40 overflow-auto p-3 text-[11px] whitespace-pre-wrap text-muted">
                {rawText}
              </pre>
            </details>
          )}

          <div className="fixed inset-x-0 bottom-0 mx-auto flex max-w-lg gap-2 border-t border-[var(--surface-border)] bg-[var(--surface-card)] px-4 pt-3 pb-safe">
            <Button
              variant="secondary"
              onClick={() => {
                setPhase('capture');
                void camera.start();
              }}
            >
              Retake
            </Button>
            <Button size="lg" full onClick={() => setPickerOpen(true)}>
              Add {preview ? Math.round(preview.kcal) : 0} Cal
            </Button>
          </div>
        </div>
      )}

      {phase === 'error' && (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto bg-[var(--surface-canvas)] px-8 py-6 text-center">
          <IconWarning width={30} height={30} className="text-amber-500" />
          <p className="max-w-xs text-[14px] font-semibold">{error}</p>
          {rawText && (
            <details className="w-full max-w-xs text-left">
              <summary className="cursor-pointer text-[12px] font-semibold text-secondary">
                Show what was read
              </summary>
              <pre className="surface-card mt-2 max-h-40 overflow-auto p-3 text-[11px] whitespace-pre-wrap text-muted">
                {rawText}
              </pre>
            </details>
          )}
          <div className="flex gap-2">
            <Button
              onClick={() => {
                setPhase('capture');
                void camera.start();
              }}
            >
              Try again
            </Button>
            <Button variant="secondary" onClick={() => navigate('/search')}>
              Search instead
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
