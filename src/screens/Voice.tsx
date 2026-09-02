import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/stores/useApp';
import { addMealItems } from '@/db/repo';
import { parseSpokenMeal } from '@/ai/service';
import { hasKey } from '@/ai/registry';
import { describeError } from '@/ai/types';
import { formatPortion } from '@/lib/nutrition';
import { MealPickerSheet } from '@/components/MealPickerSheet';
import { Button, Card, PageHeader, ScoreCircle, Skeleton } from '@/components/ui';
import { IconMic, IconSparkle, IconWarning } from '@/components/icons';
import { MEAL_SLOT_LABEL, type MealSlot, type SnapAnalysis } from '@/types';

type Phase = 'idle' | 'listening' | 'parsing' | 'result' | 'error';

const EXAMPLES = [
  'Two rotis, a katori of dal and a glass of milk',
  'Masala dosa with sambar and a filter coffee',
  'Grilled chicken breast, a bowl of salad and half a cup of rice',
];

export default function Voice() {
  const navigate = useNavigate();
  const { settings, selectedDate, showToast } = useApp();
  const keyed = hasKey(settings);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const finalRef = useRef('');

  const [phase, setPhase] = useState<Phase>('idle');
  const [transcript, setTranscript] = useState('');
  const [interim, setInterim] = useState('');
  const [analysis, setAnalysis] = useState<SnapAnalysis | null>(null);
  const [error, setError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [supported, setSupported] = useState(true);

  const parse = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) {
        setError("Didn't catch anything. Try again, or type it instead.");
        setPhase('error');
        return;
      }
      setPhase('parsing');
      setError('');
      try {
        const result = await parseSpokenMeal(settings, trimmed);
        setAnalysis(result);
        setPhase('result');
      } catch (err) {
        setError(describeError(err));
        setPhase('error');
      }
    },
    [settings],
  );

  /* ----------------------------- recognition ---------------------------- */

  useEffect(() => {
    const Ctor =
      (window as unknown as { SpeechRecognition?: typeof SpeechRecognition })
        .SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: typeof SpeechRecognition })
        .webkitSpeechRecognition;

    if (!Ctor) {
      setSupported(false);
      return;
    }

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let live = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalRef.current += result[0].transcript;
        else live += result[0].transcript;
      }
      setTranscript(finalRef.current);
      setInterim(live);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      setError(
        event.error === 'not-allowed'
          ? 'Microphone permission was denied. Allow it in your browser settings.'
          : `Speech recognition failed (${event.error}).`,
      );
      setPhase('error');
    };

    recognition.onend = () => {
      // Fires both when the user stops and when the engine times out.
      setPhase((current) => {
        if (current !== 'listening') return current;
        void parse(finalRef.current);
        return 'parsing';
      });
    };

    recognitionRef.current = recognition;
    return () => {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.stop();
      } catch {
        /* already stopped */
      }
    };
  }, [parse]);

  function startListening() {
    finalRef.current = '';
    setTranscript('');
    setInterim('');
    setAnalysis(null);
    setError('');
    setPhase('listening');
    try {
      recognitionRef.current?.start();
    } catch {
      /* start() throws if already running */
    }
  }

  function stopListening() {
    try {
      recognitionRef.current?.stop();
    } catch {
      void parse(finalRef.current);
    }
  }

  async function save(slot: MealSlot) {
    if (!analysis) return;
    await addMealItems(selectedDate, slot, analysis.items, {
      healthScore: analysis.healthScore,
      aiNote: analysis.take,
    });
    setPickerOpen(false);
    showToast({ message: `${analysis.items.length} items added to ${MEAL_SLOT_LABEL[slot]}` });
    navigate('/diet');
  }

  /* -------------------------------- render ------------------------------ */

  if (!keyed) {
    return (
      <div className="min-h-dvh">
        <PageHeader title="Say what you ate" back={() => navigate(-1)} />
        <div className="flex flex-col items-center gap-4 px-8 pt-24 text-center">
          <IconSparkle width={30} height={30} className="text-brand-500" />
          <p className="text-[15px] font-semibold">Voice logging needs an AI key</p>
          <p className="max-w-xs text-[13px] text-secondary">
            Your speech is turned into food entries by the model you configure. Everything else in
            the app works without one.
          </p>
          <Button onClick={() => navigate('/settings')}>Open Settings</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh pb-32">
      <PageHeader title="Say what you ate" back={() => navigate(-1)} />

      <div className="px-4 pt-4">
        {!supported && (
          <Card className="mb-3 flex items-start gap-2">
            <IconWarning width={16} height={16} className="mt-0.5 shrink-0 text-amber-500" />
            <p className="text-[12.5px] text-secondary">
              This browser has no speech recognition. Type what you ate instead — it works exactly
              the same way.
            </p>
          </Card>
        )}

        {/* Mic + live transcript */}
        {(phase === 'idle' || phase === 'listening' || phase === 'error') && (
          <div className="flex flex-col items-center gap-5 py-6">
            {supported && (
              <button
                type="button"
                onClick={phase === 'listening' ? stopListening : startListening}
                aria-label={phase === 'listening' ? 'Stop listening' : 'Start listening'}
                className={`relative flex h-24 w-24 items-center justify-center rounded-full text-white transition-transform active:scale-95 ${
                  phase === 'listening' ? 'bg-red-500' : 'bg-brand-500'
                }`}
              >
                {phase === 'listening' && (
                  <span className="absolute inset-0 animate-ping rounded-full bg-red-500/40" />
                )}
                <IconMic width={36} height={36} />
              </button>
            )}
            <p className="text-[13.5px] font-semibold">
              {phase === 'listening' ? 'Listening — tap to stop' : 'Tap and describe your meal'}
            </p>
          </div>
        )}

        {(transcript || interim) && phase !== 'result' && (
          <Card className="mb-3">
            <p className="text-[14px] leading-relaxed">
              {transcript}
              <span className="text-muted">{interim}</span>
            </p>
          </Card>
        )}

        {/* Typed fallback, always available */}
        {(phase === 'idle' || phase === 'error') && (
          <Card className="space-y-2">
            <label className="text-[13px] font-medium text-secondary" htmlFor="voice-text">
              {supported ? 'Or type it' : 'What did you eat?'}
            </label>
            <textarea
              id="voice-text"
              value={transcript}
              onChange={(e) => {
                setTranscript(e.target.value);
                finalRef.current = e.target.value;
              }}
              rows={3}
              placeholder={EXAMPLES[0]}
              className="hairline w-full resize-none rounded-xl border bg-transparent px-3.5 py-2.5 text-[15px] outline-none focus:border-brand-500"
            />
            <Button full disabled={!transcript.trim()} onClick={() => parse(transcript)}>
              <IconSparkle width={16} height={16} />
              Work out the calories
            </Button>
          </Card>
        )}

        {phase === 'idle' && (
          <div className="mt-4">
            <p className="mb-2 text-[12px] font-semibold text-secondary">Try something like</p>
            <div className="space-y-1.5">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => {
                    setTranscript(example);
                    finalRef.current = example;
                  }}
                  className="hairline w-full rounded-xl border px-3.5 py-2.5 text-left text-[13px] text-secondary"
                >
                  &ldquo;{example}&rdquo;
                </button>
              ))}
            </div>
          </div>
        )}

        {phase === 'parsing' && (
          <Card className="space-y-3">
            <div className="flex items-center gap-2">
              <IconSparkle width={16} height={16} className="animate-pulse text-brand-600" />
              <p className="text-[14px] font-bold">Working out the portions…</p>
            </div>
            <Skeleton className="h-3 w-3/4 rounded" />
            <Skeleton className="h-3 w-1/2 rounded" />
          </Card>
        )}

        {phase === 'error' && error && (
          <p className="mt-3 text-center text-[12.5px] text-red-600">{error}</p>
        )}

        {phase === 'result' && analysis && (
          <>
            <Card className="mb-3 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-[16px] font-bold tracking-tight">{analysis.title}</h2>
                <ScoreCircle score={analysis.healthScore} />
              </div>
              <div className="surface-sunken flex items-center justify-between rounded-xl px-3.5 py-3">
                <span className="text-[13px] font-semibold text-secondary">Calories</span>
                <span className="tabular text-2xl font-extrabold">
                  {Math.round(analysis.totals.kcal)}
                </span>
              </div>
              <p className="text-[12px] text-muted">
                Heard: &ldquo;{transcript.trim()}&rdquo;
              </p>
            </Card>

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
                        {formatPortion(item.qty, item.servingLabel)}
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
              <div className="mt-3 accent-card p-3.5">
                <p className="text-[13px] leading-relaxed text-brand-800/90">{analysis.take}</p>
              </div>
            )}

            <div className="dock inset-x-0 mx-auto flex max-w-lg gap-2 border-t border-[var(--surface-border)] bg-[var(--surface-card)] px-4 pt-3 pb-safe">
              <Button variant="secondary" onClick={() => setPhase('idle')}>
                Redo
              </Button>
              <Button size="lg" full onClick={() => setPickerOpen(true)}>
                Save {Math.round(analysis.totals.kcal)} Cal
              </Button>
            </div>
          </>
        )}
      </div>

      <MealPickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={save}
        date={selectedDate}
      />
    </div>
  );
}
