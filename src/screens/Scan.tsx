import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/stores/useApp';
import { addMealItems, createFood, findFoodByBarcode, upsertFood } from '@/db/repo';
import { lookupBarcodeTiered } from '@/lib/foodLookup';
import { ConsensusBuffer, createDecoder, isValidEAN, type Decoder } from '@/lib/scanner/barcode';
import { interpretScan } from '@/lib/scanner/payload';
import { useCamera } from '@/lib/camera';
import { HAPTIC, haptic } from '@/lib/motion';
import { captureFrame } from '@/lib/image';
import { buildMealItem, scaleNutrients } from '@/lib/nutrition';
import { draftToFood, generateFood } from '@/ai/service';
import { hasKey } from '@/ai/registry';
import { describeError } from '@/ai/types';
import { uid } from '@/db/schema';
import { BottomSheet } from '@/components/BottomSheet';
import { MealPickerSheet } from '@/components/MealPickerSheet';
import { Button, Card, Field, PageHeader } from '@/components/ui';
import { IconBarcode, IconCamera, IconSparkle, IconTorch, IconWarning } from '@/components/icons';
import { MEAL_SLOT_LABEL, type Food, type MealSlot } from '@/types';

/**
 * Guide box as a fraction of the frame — the decoder only sees this region.
 *
 * Taller than it needs to be for a 1D barcode, because the same box now has to
 * frame a QR code, which is square. A letterbox sized to a barcode clips the
 * top and bottom off a QR held at a natural distance, and a clipped QR never
 * decodes at all.
 */
const ROI = { x: 0.12, y: 0.24, w: 0.76, h: 0.44 };

/**
 * What the decoder actually reads: the guide box plus a margin on every side.
 *
 * An EAN or UPC needs blank space either side of its bars (the quiet zone,
 * about eleven bar-widths) to be found at all. Cropping exactly to the box
 * means a barcode lined up the way the screen asks — filling the box — can
 * have that margin cut off by the crop. Reading a little past the edges keeps
 * it, while still throwing away most of the clutter the crop exists to
 * remove. The box on screen stays the same size, so the instruction doesn't
 * change.
 */
const DECODE_ROI = (() => {
  const mx = 0.1;
  const my = 0.06;
  const x = Math.max(0, ROI.x - mx);
  const y = Math.max(0, ROI.y - my);
  return {
    x,
    y,
    w: Math.min(1, ROI.x + ROI.w + mx) - x,
    h: Math.min(1, ROI.y + ROI.h + my) - y,
  };
})();

/**
 * The whole visible frame, tried occasionally alongside the guide box.
 *
 * Cropping to the box is what makes a read reliable — it throws away the
 * clutter a decoder would otherwise lock onto. But it also means a barcode
 * just outside the box is never seen at all, and from the user's side that is
 * indistinguishable from a barcode that cannot be read: they are holding the
 * pack up and nothing happens. Sweeping the full frame every few passes
 * catches those without giving up the cropped pass's accuracy.
 */
const FULL_FRAME = { x: 0, y: 0, w: 1, h: 1 };

/** Full-frame sweeps per cropped passes. Kept low; the sweep costs more. */
const SWEEP_EVERY = 4;

/**
 * Longest edge, in pixels, of the frame handed to the decoder. A barcode that
 * fills the guide box is still hundreds of pixels wide at this size, and a
 * full 1080x1920 sensor frame costs the decoder roughly twice as long for no
 * extra reads.
 */
const DECODE_EDGE = 1280;

/** See `zoom` in useCamera: fills the box from outside the close-focus limit. */
const SCAN_ZOOM = 2;

/** How long to scan before offering the manual fallback unprompted. */
const STRUGGLE_AFTER_MS = 9000;

type Phase = 'scanning' | 'looking-up' | 'found' | 'not-found';

export default function Scan() {
  const navigate = useNavigate();
  const { settings, selectedDate, showToast } = useApp();
  const camera = useCamera({ ideal: { width: 1920, height: 1080 }, zoom: SCAN_ZOOM });
  // The stable function, not the hook's return object: that object is new on
  // every render, so depending on it restarted the scan loop each time —
  // resetting the full-frame sweep's pass counter and the struggle timer.
  const stopCamera = camera.stop;

  const decoderRef = useRef<Decoder | null>(null);
  const bufferRef = useRef(new ConsensusBuffer(2, 2500));
  // One canvas for every grab, rather than a new multi-MB one per frame.
  const frameCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const busyRef = useRef(false);
  // The symbology behind the accepted value. Eight digits are ambiguous
  // between EAN-8 and UPC-E, and the two expand to entirely different
  // products, so the lookup wants to know which one was actually printed.
  const formatRef = useRef<string | undefined>(undefined);

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
  // A QR that turned out not to be a product — a menu link, a Wi-Fi string.
  // Shown rather than swallowed, since the user did deliberately scan it.
  const [other, setOther] = useState<{ url?: string; text: string } | null>(null);
  /**
   * A product a database could name but not describe. Worth holding on to: it
   * turns "not found" into "we know what this is", and gives the AI fallback a
   * real product to estimate instead of a barcode number no model has seen.
   */
  const [knownProduct, setKnownProduct] = useState<{ name: string; brand?: string } | null>(null);
  /** Set once scanning has gone on long enough to be worth offering a hand. */
  const [struggling, setStruggling] = useState(false);
  /**
   * What the user says the product is, when no database knew.
   * A model can estimate "Amul Masti Buttermilk 200 ml" well; it can do
   * nothing whatever with thirteen digits.
   */
  const [typedName, setTypedName] = useState('');

  /* ------------------------------ lookup ------------------------------- */

  const handleCode = useCallback(
    async (value: string) => {
      if (busyRef.current) return;
      busyRef.current = true;
      setCode(value);
      setPhase('looking-up');
      setError('');
      setNote('');
      stopCamera();

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

        const result = await lookupBarcodeTiered(settings, value, undefined, formatRef.current);
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
        setKnownProduct(
          result.productName
            ? { name: result.productName, brand: result.brand }
            : null,
        );
        setPhase('not-found');
      } catch (err) {
        setError(describeError(err));
        setPhase('not-found');
      } finally {
        busyRef.current = false;
      }
    },
    [stopCamera, settings],
  );

  /**
   * Routes a decoded symbol by what it contains.
   *
   * Only the `gtin` case is a database lookup. A QR carrying its own nutrition
   * panel becomes a food immediately — no network, no key needed — and anything
   * else is surfaced as itself rather than silently dropped, since the user did
   * deliberately point the camera at it.
   */
  const handleScan = useCallback(
    async (raw: string) => {
      if (busyRef.current) return;
      const payload = interpretScan(raw);

      if (payload.kind === 'gtin') {
        await handleCode(payload.gtin);
        return;
      }

      busyRef.current = true;
      stopCamera();
      setCode(raw);

      if (payload.kind === 'nutrition') {
        const created = await createFood({
          name: payload.name,
          brand: payload.brand,
          per100g: payload.per100g,
          servings: payload.servings,
          source: 'custom',
          tags: ['scanned'],
        });
        setFood(created);
        setServingLabel(created.servings[0]?.label ?? '100 g');
        setNote('Read from the code itself — check the numbers before saving');
        setError('');
        setPhase('found');
      } else {
        setOther(
          payload.kind === 'url' ? { url: payload.url, text: payload.url } : { text: payload.text },
        );
      }
      busyRef.current = false;
    },
    [stopCamera, handleCode],
  );

  /* ------------------------------ scan loop ---------------------------- */

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const decoder = await createDecoder();
      if (cancelled) {
        decoder.dispose?.();
        return;
      }
      decoderRef.current = decoder;
      setDecoderKind(decoder.kind);
      if (decoder.kind === 'none') {
        setError('No code decoder is available in this browser. Enter the number by hand.');
      }
    })();

    return () => {
      cancelled = true;
      decoderRef.current?.dispose?.();
      decoderRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (phase !== 'scanning' || camera.status !== 'live') return;

    let stopped = false;
    let pass = 0;
    const canvas = (frameCanvasRef.current ??= document.createElement('canvas'));

    // Back-to-back rather than on a fixed timer: as soon as one decode returns
    // the next frame is grabbed. It used to be capped at 8 a second with every
    // decode blocking the main thread; off-thread (the iPhone path) and native
    // decoders now run as fast as they can return, which is what makes a read
    // land within a fraction of a second of the pack being lined up. Only the
    // main-thread fallback keeps a gap, so the UI still gets frames.
    const run = async () => {
      let last = 0;
      while (!stopped) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (stopped) return;

        const video = camera.videoRef.current;
        const decoder = decoderRef.current;
        if (!video || !decoder || decoder.kind === 'none' || busyRef.current) continue;
        if (!video.videoWidth || document.hidden) continue;

        const now = performance.now();
        const gap = decoder.offThread || decoder.kind === 'native' ? 30 : 150;
        if (now - last < gap) continue;
        last = now;

        try {
          // Every fourth pass looks at the whole frame instead, so a barcode
          // the user has framed slightly off still gets read.
          const sweep = pass % SWEEP_EVERY === SWEEP_EVERY - 1;
          pass += 1;

          captureFrame(video, sweep ? FULL_FRAME : DECODE_ROI, {
            canvas,
            maxEdge: DECODE_EDGE,
            readback: true,
          });
          // A cropped pass that misses retries sharpened, which reads frames
          // a little out of focus — the usual state of a pack held close. It
          // only costs anything on a miss: a sharp frame reads on the plain
          // pass and returns before the sharpen ever runs.
          const hit = await decoder.decode(canvas, { thorough: !sweep, sharpen: !sweep });
          if (!hit || stopped) continue;
          if (!isValidEAN(hit.value)) continue; // failed check digit: a misread

          const confirmed = bufferRef.current.push(hit.value);
          if (confirmed) {
            formatRef.current = hit.format;
            haptic(HAPTIC.success);
            await handleScan(confirmed);
          }
        } catch {
          /* a dropped frame is not worth surfacing */
        }
      }
    };
    void run();

    // Nine seconds of pointing a camera at a pack with nothing happening is
    // long enough. Rather than leave the user guessing whether it is still
    // trying, say what usually helps and put the manual entry in reach.
    const nudge = setTimeout(() => setStruggling(true), STRUGGLE_AFTER_MS);

    return () => {
      stopped = true;
      clearTimeout(nudge);
    };
  }, [phase, camera.status, camera.videoRef, handleScan]);

  /* ----------------------------- photo fallback ------------------------ */

  const photoInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);
  const [readingPhoto, setReadingPhoto] = useState(false);

  /**
   * Reads a barcode from a still photo.
   *
   * The live viewfinder decodes video frames, and video is where close-up
   * focus fails: recent iPhone Pro main cameras cannot focus nearer than about
   * 20 cm, and the browser's stream never switches to the macro lens. A photo
   * taken through the system camera does — it focuses properly, switches lens
   * when it needs to, and comes back at full sensor resolution. It also needs
   * no camera permission, so it works where the live scanner cannot start.
   *
   * Tried at a few sizes: a large frame keeps thin bars, and a smaller one
   * shrinks whatever blur there is relative to the bars.
   */
  async function readPhoto(file: File | undefined) {
    if (!file || readingPhoto) return;
    const decoder = decoderRef.current;
    if (!decoder || decoder.kind === 'none') {
      setError('No code decoder is available in this browser. Enter the number by hand.');
      return;
    }
    setReadingPhoto(true);
    setError('');
    busyRef.current = true; // pause the live loop while the photo is read
    let bitmap: ImageBitmap | undefined;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() =>
        createImageBitmap(file),
      );
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Canvas is unavailable in this browser');
      for (const edge of [2000, 1200, 800]) {
        const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const hit = await decoder.decode(canvas, { thorough: true, sharpen: true });
        if (hit && isValidEAN(hit.value)) {
          formatRef.current = hit.format;
          haptic(HAPTIC.success);
          busyRef.current = false;
          await handleScan(hit.value);
          return;
        }
      }
      setError(
        "Couldn't find a barcode in that photo. Get close enough that the barcode fills most of the picture, keep it sharp, or type the number.",
      );
    } catch {
      setError("That photo couldn't be opened. Try taking it again.");
    } finally {
      bitmap?.close();
      busyRef.current = false;
      setReadingPhoto(false);
      if (photoInputRef.current) photoInputRef.current.value = '';
      if (libraryInputRef.current) libraryInputRef.current.value = '';
    }
  }

  /* ------------------------------- actions ----------------------------- */

  async function generateWithAI() {
    if (generating) return;
    setGenerating(true);
    setError('');
    try {
      // Asking a model to recognise a barcode number is asking it to invent
      // one: the digits carry no information it could have learned. Anything
      // that names the product beats them — what the user typed first, since
      // they are holding the pack, then whatever a database could tell us.
      const named =
        typedName.trim() ||
        (knownProduct ? [knownProduct.brand, knownProduct.name].filter(Boolean).join(' ') : '');
      const subject = named || `packaged food with barcode ${code}`;
      const draft = await generateFood(settings, subject);
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
    formatRef.current = undefined;
    setFood(null);
    setCode('');
    setError('');
    setNote('');
    setKnownProduct(null);
    setStruggling(false);
    setTypedName('');
    setPhase('scanning');
    void camera.start();
  }

  const serving = food?.servings.find((s) => s.label === servingLabel) ?? food?.servings[0];
  const preview = food
    ? scaleNutrients(food.per100g, ((serving?.grams ?? 100) * (Number(qty) || 0)) / 100)
    : null;

  /* -------------------------------- render ----------------------------- */

  // svh with a hard overflow clip, matching Snap: `min-h-dvh` let this column
  // grow past the screen, which pushed the guide box and the manual-entry
  // button below the fold on shorter phones — you had to scroll a camera
  // viewfinder to reach its own controls. Each phase below owns its scrolling.
  return (
    <div className="flex h-svh flex-col overflow-hidden bg-black">
      <PageHeader
        title="Scan a code"
        back={-1}
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
        <div className="relative flex min-h-0 flex-1 flex-col">
          {/* min-h-0 so the preview yields space to the bar below rather than
              shoving it off the bottom. */}
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <video
              ref={camera.videoRef}
              playsInline
              muted
              autoPlay
              className="h-full w-full object-cover"
            />

            {/* Guide box. The decoder reads DECODE_ROI, slightly larger. */}
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

            {/* Only when the camera can actually zoom. 2x is the default because
                it keeps the pack outside the close-focus limit; 1x is there for
                a large or very close code that no longer fits the box. */}
            {camera.status === 'live' && camera.zoomRange && camera.zoomRange.max >= 1.5 && (
              <button
                type="button"
                onClick={() => void camera.setZoom(camera.zoom > 1.2 ? 1 : SCAN_ZOOM)}
                aria-label={camera.zoom > 1.2 ? 'Zoom out to 1x' : `Zoom in to ${SCAN_ZOOM}x`}
                className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-3.5 py-1.5 text-[13px] font-bold text-white tabular"
              >
                {camera.zoom > 1.2 ? `${Math.round(camera.zoom * 10) / 10}×` : '1×'}
              </button>
            )}

            {camera.status !== 'live' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center text-white/80">
                <IconBarcode width={34} height={34} />
                <p className="text-[13.5px]">
                  {camera.status === 'starting' ? 'Starting camera…' : camera.error}
                </p>
              </div>
            )}
          </div>

          <div className="bg-black px-6 pt-4 pb-[max(env(safe-area-inset-bottom),1.5rem)]">
            <p className="text-center text-[12.5px] text-white/60">
              Line the barcode or QR up inside the box. Hold steady — it confirms across two
              reads.
            </p>
            {/* The three things that actually fix a stubborn read, in the order
                they usually help. Offered only after a while, so it is advice
                when it is wanted rather than noise on every scan. */}
            {struggling && (
              <p className="mt-2 text-center text-[12px] leading-relaxed text-white/75">
                Still not reading? Tap Take a photo — your camera app focuses up close where the
                live view can't. Or hold the pack about 20 cm away, wipe the lens, and
                {camera.torchAvailable ? ' turn the torch on for glossy or dark packaging.' : ' try more even lighting — glare on the plastic is usually the culprit.'}
              </p>
            )}
            {decoderKind === 'wasm' && (
              <p className="mt-1 text-center text-[11px] text-white/35">
                Using the built-in decoder
              </p>
            )}
            {error && (
              <p className="mt-2 text-center text-[12px] text-amber-400">{error}</p>
            )}
            <div className="flex justify-center gap-2 pt-4">
              <Button
                variant={struggling || camera.status !== 'live' ? 'primary' : 'secondary'}
                onClick={() => photoInputRef.current?.click()}
                disabled={readingPhoto || decoderKind === 'none'}
              >
                <IconCamera width={16} height={16} />
                {readingPhoto ? 'Reading photo…' : 'Take a photo'}
              </Button>
              <Button variant="secondary" onClick={() => setManualOpen(true)}>
                Type number
              </Button>
            </div>
            <div className="flex justify-center pt-2 pb-2">
              <button
                type="button"
                onClick={() => libraryInputRef.current?.click()}
                disabled={readingPhoto || decoderKind === 'none'}
                className="text-[12px] font-semibold text-white/60 underline-offset-2 hover:underline disabled:opacity-40"
              >
                Choose a photo or screenshot
              </button>
            </div>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => void readPhoto(e.target.files?.[0])}
            />
            <input
              ref={libraryInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void readPhoto(e.target.files?.[0])}
            />
          </div>
        </div>
      )}

      {phase === 'looking-up' && (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto bg-[var(--surface-canvas)] px-8 text-center">
          <IconBarcode width={30} height={30} className="animate-pulse text-brand-600" />
          <p className="tabular text-[15px] font-bold">{code}</p>
          <p className="text-[13px] text-secondary">Looking it up…</p>
        </div>
      )}

      {phase === 'found' && food && (
        <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--surface-canvas)] px-4 pt-3 pb-32">
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
                <p className="mt-2 accent-card accent-amber px-2.5 py-1.5 text-[11.5px]">
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
              <div className="surface-sunken grid grid-cols-5 gap-1 rounded-xl p-3 text-center">
                <Stat label="Cal" value={Math.round(preview.kcal)} />
                <Stat label="Protein" value={`${Math.round(preview.protein)}g`} />
                <Stat label="Fat" value={`${Math.round(preview.fat)}g`} />
                <Stat label="Carbs" value={`${Math.round(preview.carbs)}g`} />
                <Stat label="Fibre" value={`${Math.round(preview.fibre)}g`} />
              </div>
            )}
          </Card>

          <div className="dock inset-x-0 mx-auto flex shell-w gap-2 border-t border-[var(--surface-border)] bg-[var(--surface-card)] px-4 pt-3 pb-safe">
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
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto bg-[var(--surface-canvas)] px-8 py-6 text-center">
          <IconWarning width={30} height={30} className="text-amber-500" />
          <div>
            {/* Naming the product changes what this screen is: not "we have no
                idea what you scanned" but "we know what it is, just not what's
                in it" — which is a much smaller thing to ask the user to fix. */}
            <p className="text-[15px] font-bold">
              {knownProduct ? 'No nutrition on file' : 'Not in the database'}
            </p>
            {knownProduct && (
              <p className="mt-1 text-[13.5px] font-semibold">
                {[knownProduct.brand, knownProduct.name].filter(Boolean).join(' · ')}
              </p>
            )}
            <p className="tabular mt-1 text-[12px] text-muted">{code}</p>
            {(note || error) && (
              <p className="mt-2 max-w-xs text-[12.5px] text-secondary">{error || note}</p>
            )}
          </div>

          <div className="flex w-full max-w-xs flex-col gap-2">
            {/*
              The pack is in the user's hand and the panel on the back of it is
              the most accurate source there is — more accurate than any
              database entry and certainly than an estimate. For a product no
              database carries, this is the real answer, so it leads. The
              barcode rides along, so once the panel is read this install
              recognises the product instantly and offline from then on.
            */}
            <Button onClick={() => navigate(`/label?barcode=${encodeURIComponent(code)}`)}>
              <IconCamera width={16} height={16} />
              Scan the nutrition label
            </Button>

            {/* Failing that, the user can simply say what it is. */}
            {hasKey(settings) && !knownProduct && (
              <Field
                label="Or tell us what it is"
                placeholder="e.g. Amul Masti Buttermilk 200 ml"
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
              />
            )}

            {hasKey(settings) ? (
              <Button variant="secondary" onClick={generateWithAI} disabled={generating}>
                <IconSparkle width={16} height={16} />
                {generating
                  ? 'Estimating…'
                  : knownProduct
                    ? `Estimate ${knownProduct.name} with AI`
                    : typedName.trim()
                      ? `Estimate ${typedName.trim()} with AI`
                      : 'Estimate it with AI'}
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => navigate('/settings')}>
                Add an AI key to estimate it
              </Button>
            )}
            {/* Prefilled with the name when we have one, so "search by name"
                does not mean "type it out yourself". */}
            <Button
              variant="secondary"
              onClick={() =>
                navigate(
                  knownProduct
                    ? `/search?q=${encodeURIComponent(knownProduct.name)}`
                    : '/search',
                )
              }
            >
              Search by name instead
            </Button>
            <Button variant="ghost" onClick={rescan}>
              Scan another
            </Button>

            {hasKey(settings) && !knownProduct && !typedName.trim() && (
              <p className="text-[11.5px] leading-relaxed text-muted">
                Estimating from the number alone is guesswork — a barcode tells a model nothing
                about what is inside. Reading the label, or naming the product above, gives a
                figure worth logging.
              </p>
            )}
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

      {/* A QR that isn't a product. Shown as itself rather than sent to a
          lookup that could only ever fail. */}
      <BottomSheet
        open={Boolean(other)}
        onClose={() => {
          setOther(null);
          rescan();
        }}
        title={other?.url ? 'That code is a link' : 'That code is text'}
        footer={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setOther(null);
                rescan();
              }}
            >
              Scan again
            </Button>
            {other?.url ? (
              <Button
                size="lg"
                full
                onClick={() => window.open(other.url, '_blank', 'noopener,noreferrer')}
              >
                Open link
              </Button>
            ) : (
              <Button
                size="lg"
                full
                onClick={() => void navigator.clipboard?.writeText(other?.text ?? '')}
              >
                Copy text
              </Button>
            )}
          </div>
        }
      >
        <p className="surface-sunken rounded-xl p-3 text-[12.5px] break-all">{other?.text}</p>
        <p className="mt-2 text-[12px] leading-relaxed text-muted">
          {other?.url
            ? 'It carries no product code, so there is nothing to look up. Opening it leaves the app.'
            : 'It carries no product code and no nutrition data.'}
        </p>
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
