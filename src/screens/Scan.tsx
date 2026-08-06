import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/stores/useApp';
import { addMealItems, createFood, findFoodByBarcode, upsertFood } from '@/db/repo';
import { lookupBarcodeTiered } from '@/lib/foodLookup';
import { ConsensusBuffer, createDecoder, isValidEAN, type Decoder } from '@/lib/scanner/barcode';
import { useCamera } from '@/lib/camera';
import { captureFrame } from '@/lib/image';
import { buildMealItem, scaleNutrients } from '@/lib/nutrition';
import { draftToFood, generateFood } from '@/ai/service';
import { hasKey } from '@/ai/registry';
import { describeError } from '@/ai/types';
import { uid } from '@/db/schema';
import { BottomSheet } from '@/components/BottomSheet';
import { MealPickerSheet } from '@/components/MealPickerSheet';
import { Button, Card, Field, PageHeader } from '@/components/ui';
import { IconBarcode, IconSparkle, IconTorch, IconWarning } from '@/components/icons';
import { MEAL_SLOT_LABEL, type Food, type MealSlot } from '@/types';

/** Guide box as a fraction of the frame — the decoder only sees this region. */
const ROI = { x: 0.1, y: 0.32, w: 0.8, h: 0.28 };

type Phase = 'scanning' | 'looking-up' | 'found' | 'not-found';

export default function Scan() {
  const navigate = useNavigate();
  const { settings, selectedDate, showToast } = useApp();
  const camera = useCamera({ ideal: { width: 1920, height: 1080 } });

  const decoderRef = useRef<Decoder | null>(null);
  const bufferRef = useRef(new ConsensusBuffer(2, 2500));
  const rafRef = useRef<number>(0);
  const busyRef = useRef(false);

  const [phase, setPhase] = useState<Phase>('scanning');
  const [decoderKind, setDecoderKind] = useState<string>('');
  const [code, setCode] = useState('');
  const [food, setFood] = useState<Food | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [qty, setQty] = useState('1');
  const [servingLabel, setServingLabel] = useState('');
  const [generating, setGenerating] = useState(false);

  /* ------------------------------ lookup ------------------------------- */

  const handleCode = useCallback(
    async (value: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setCode(value);
      setPhase('looking-up');
      setError('');
      setNote('');
      camera.stop();

      try {
        // A barcode we've already resolved is instant and works offline.
        const cached = await findFoodByBarcode(value);
        if (cached) {
          setFood(cached);
          setServingLabel(cached.servings[0]?.label ?? '100 g');
          setNote('From your saved foods');
          setPhase('found');
          return;
        }

        const result = await lookupBarcodeTiered(settings, value);
        if (result.found && result.food) {
          const prefix = result.food.source === 'fatsecret' ? 'fs_' : 'off_';
          const saved = await upsertFood({ ...result.food, id: uid(prefix) });
          setFood(saved);
          setServingLabel(saved.servings[0]?.label ?? '100 g');
          setNote(result.note ?? '');
          // A tier that failed while another succeeded is worth showing, but
          // quietly — the user has their product.
          setError(result.warning ?? '');
          setPhase('found');
          return;
        }

        setNote(result.note ?? '');
        setError(result.warning ?? '');
        setPhase('not-found');
      } catch (err) {
        setError(describeError(err));
        setPhase('not-found');
      } finally {
        busyRef.current = false;
      }
    },
    [camera, settings],
  );

  /* ------------------------------ scan loop ---------------------------- */

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const decoder = await createDecoder();
      if (cancelled) return;
      decoderRef.current = decoder;
      setDecoderKind(decoder.kind);
      if (decoder.kind === 'none') {
        setError('No barcode decoder is available in this browser. Enter the number by hand.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (phase !== 'scanning' || camera.status !== 'live') return;

    let stopped = false;
    let last = 0;

    const tick = async (now: number) => {
      if (stopped) return;
      rafRef.current = requestAnimationFrame(tick);

      // ~8 decodes/sec is plenty and leaves the main thread responsive.
      if (now - last < 125) return;
      last = now;

      const video = camera.videoRef.current;
      const decoder = decoderRef.current;
      if (!video || !decoder || decoder.kind === 'none' || busyRef.current) return;
      if (!video.videoWidth) return;

      try {
        const canvas = captureFrame(video, ROI);
        const hit = await decoder.decode(canvas);
        if (!hit || stopped) return;
        if (!isValidEAN(hit.value)) return; // failed check digit: a misread

        const confirmed = bufferRef.current.push(hit.value);
        if (confirmed) {
          if (navigator.vibrate) navigator.vibrate(40);
          await handleCode(confirmed);
        }
      } catch {
        /* a dropped frame is not worth surfacing */
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(rafRef.current);
    };
  }, [phase, camera.status, camera.videoRef, handleCode]);

  /* ------------------------------- actions ----------------------------- */

  async function generateWithAI() {
    if (generating) return;
    setGenerating(true);
    setError('');
    try {
      const draft = await generateFood(settings, `packaged food with barcode ${code}`);
      const created = await createFood(draftToFood(draft, 'ai', code));
      setFood(created);
      setServingLabel(created.servings[0]?.label ?? '100 g');
      setNote('Estimated by AI — check before saving');
      setPhase('found');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setGenerating(false);
    }
  }

  async function save(slot: MealSlot) {
    if (!food) return;
    const item = buildMealItem(food, servingLabel, Math.max(0, Number(qty) || 1));
    await addMealItems(selectedDate, slot, [item]);
    setPickerOpen(false);
    showToast({ message: `${food.name} added to ${MEAL_SLOT_LABEL[slot]}` });
    navigate('/diet');
  }

  function rescan() {
    bufferRef.current.reset();
    setFood(null);
    setCode('');
    setError('');
    setNote('');
    setPhase('scanning');
    void camera.start();
  }

  const serving = food?.servings.find((s) => s.label === servingLabel) ?? food?.servings[0];
  const preview = food
    ? scaleNutrients(food.per100g, ((serving?.grams ?? 100) * (Number(qty) || 0)) / 100)
    : null;

  /* -------------------------------- render ----------------------------- */

  return (
    <div className="flex min-h-dvh flex-col bg-black">
      <PageHeader
        title="Scan a barcode"
        back={() => navigate(-1)}
        action={
          phase === 'scanning' && camera.torchAvailable ? (
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

      {phase === 'scanning' && (
        <div className="relative flex flex-1 flex-col">
          <div className="relative flex-1 overflow-hidden">
            <video
              ref={camera.videoRef}
              playsInline
              muted
              autoPlay
              className="h-full w-full object-cover"
            />

            {/* Guide box matching the decode ROI exactly */}
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
                <IconBarcode width={34} height={34} />
                <p className="text-[13.5px]">
                  {camera.status === 'starting' ? 'Starting camera…' : camera.error}
                </p>
              </div>
            )}
          </div>

          <div className="bg-black px-6 pt-4 pb-safe">
            <p className="text-center text-[12.5px] text-white/60">
              Line the barcode up inside the box. Hold steady — it confirms across two reads.
            </p>
            {decoderKind === 'wasm' && (
              <p className="mt-1 text-center text-[11px] text-white/35">
                Using the built-in decoder
              </p>
            )}
            {error && (
              <p className="mt-2 text-center text-[12px] text-amber-400">{error}</p>
            )}
            <div className="flex justify-center py-4">
              <Button variant="secondary" onClick={() => setManualOpen(true)}>
                Enter number manually
              </Button>
            </div>
          </div>
        </div>
      )}

      {phase === 'looking-up' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-[var(--surface-canvas)] px-8 text-center">
          <IconBarcode width={30} height={30} className="animate-pulse text-brand-600" />
          <p className="tabular text-[15px] font-bold">{code}</p>
          <p className="text-[13px] text-secondary">Looking it up…</p>
        </div>
      )}

      {phase === 'found' && food && (
        <div className="flex-1 bg-[var(--surface-canvas)] px-4 pt-3 pb-32">
          <Card className="space-y-3">
            <div>
              <h2 className="text-[17px] leading-snug font-bold tracking-tight">{food.name}</h2>
              {food.brand && <p className="text-[13px] text-secondary">{food.brand}</p>}
              {note && (
                <p className="mt-1 flex items-center gap-1 text-[11.5px] text-muted">
                  {note.startsWith('Estimated') && <IconSparkle width={11} height={11} />}
                  {note}
                </p>
              )}
              <p className="tabular mt-1 text-[11px] text-muted">{code}</p>
              {error && (
                <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11.5px] text-amber-900">
                  {error}
                </p>
              )}
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
                      s.label === servingLabel ? 'border-brand-500 bg-brand-50 text-brand-700' : ''
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
              <div className="surface-sunken grid grid-cols-5 gap-1 rounded-xl p-3 text-center">
                <Stat label="Cal" value={Math.round(preview.kcal)} />
                <Stat label="Protein" value={`${Math.round(preview.protein)}g`} />
                <Stat label="Fat" value={`${Math.round(preview.fat)}g`} />
                <Stat label="Carbs" value={`${Math.round(preview.carbs)}g`} />
                <Stat label="Fibre" value={`${Math.round(preview.fibre)}g`} />
              </div>
            )}
          </Card>

          <div className="fixed inset-x-0 bottom-0 mx-auto flex max-w-lg gap-2 border-t border-[var(--surface-border)] bg-[var(--surface-card)] px-4 pt-3 pb-safe">
            <Button variant="secondary" onClick={rescan}>
              Rescan
            </Button>
            <Button size="lg" full onClick={() => setPickerOpen(true)}>
              Add {preview ? Math.round(preview.kcal) : 0} Cal
            </Button>
          </div>
        </div>
      )}

      {phase === 'not-found' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-[var(--surface-canvas)] px-8 text-center">
          <IconWarning width={30} height={30} className="text-amber-500" />
          <div>
            <p className="text-[15px] font-bold">Not in the database</p>
            <p className="tabular mt-1 text-[12px] text-muted">{code}</p>
            {(note || error) && (
              <p className="mt-2 max-w-xs text-[12.5px] text-secondary">{error || note}</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            {hasKey(settings) ? (
              <Button onClick={generateWithAI} disabled={generating}>
                <IconSparkle width={16} height={16} />
                {generating ? 'Estimating…' : 'Estimate it with AI'}
              </Button>
            ) : (
              <Button onClick={() => navigate('/settings')}>Add an AI key to estimate it</Button>
            )}
            <Button variant="secondary" onClick={() => navigate('/search')}>
              Search by name instead
            </Button>
            <Button variant="ghost" onClick={rescan}>
              Scan another
            </Button>
          </div>
        </div>
      )}

      {/* Manual entry — the fallback when a barcode is damaged or unreadable */}
      <BottomSheet
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        title="Enter the barcode number"
        footer={
          <Button
            size="lg"
            full
            disabled={manualCode.trim().length < 6}
            onClick={() => {
              setManualOpen(false);
              void handleCode(manualCode.trim());
            }}
          >
            Look it up
          </Button>
        }
      >
        <Field
          value={manualCode}
          onChange={(e) => setManualCode(e.target.value.replace(/\D/g, ''))}
          inputMode="numeric"
          placeholder="8901234567890"
          autoFocus
          hint="The digits printed under the barcode."
        />
        <div className="h-2" />
      </BottomSheet>

      <MealPickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={save}
        date={selectedDate}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="tabular text-[14px] font-bold">{value}</p>
      <p className="text-[10px] text-muted">{label}</p>
    </div>
  );
}
