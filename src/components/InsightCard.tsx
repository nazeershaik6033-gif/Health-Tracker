import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '@/stores/useApp';
import { useDay } from '@/stores/useDay';
import { dayBundle, insightForDate, saveInsight } from '@/db/repo';
import { dayContext, generateInsight } from '@/ai/service';
import { hasKey } from '@/ai/registry';
import { describeError } from '@/ai/types';
import { isToday } from '@/lib/date';
import { AIBadge, Skeleton } from './ui';
import { IconRefresh, IconSparkle } from './icons';
import type { Insight } from '@/types';

/**
 * The "Boost Energy With Breakfast" card.
 *
 * Generated once per day and cached, because it costs a request and the
 * answer doesn't meaningfully change between page loads. Without an API key
 * it falls back to a locally computed summary rather than disappearing —
 * the card is load-bearing on the Home screen.
 */
export function InsightCard({ date }: { date: string }) {
  const { profile, settings } = useApp();
  const day = useDay(date);
  const [insight, setInsight] = useState<Insight | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const keyed = hasKey(settings);
  const logged = day.meals.length > 0;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const existing = await insightForDate(date);
      if (!cancelled) setInsight(existing ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [date]);

  async function generate() {
    if (!keyed || busy) return;
    setBusy(true);
    setError('');
    try {
      const bundle = await dayBundle(date, profile);
      const result = await generateInsight(settings, dayContext(bundle, profile));
      const saved = await saveInsight({
        ...result,
        id: insight?.id,
        date,
        read: false,
        createdAt: Date.now(),
      });
      setInsight(saved);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  // Auto-generate once the day has something worth commenting on.
  useEffect(() => {
    if (insight === null && keyed && logged && isToday(date) && !busy && !error) {
      void generate();
    }
    // Intentionally narrow: re-running on every render would loop on failure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insight, keyed, logged, date]);

  if (insight === undefined) return <Skeleton className="h-24 w-full rounded-2xl" />;

  if (busy && !insight) {
    return (
      <div className="rounded-2xl bg-brand-50 p-4">
        <div className="mb-2 flex items-center gap-1.5">
          <IconSparkle width={15} height={15} className="text-brand-600" />
          <span className="text-[12px] font-bold text-brand-700">Ria is reading your day…</span>
        </div>
        <Skeleton className="mb-1.5 h-3 w-full rounded" />
        <Skeleton className="h-3 w-2/3 rounded" />
      </div>
    );
  }

  if (!insight) return <LocalSummary date={date} keyed={keyed} onGenerate={generate} />;

  return (
    <div className="rounded-2xl bg-brand-50 p-4">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-[16px] leading-snug font-bold tracking-tight text-brand-900">
          {insight.title}
        </h2>
        <button
          type="button"
          onClick={generate}
          disabled={busy || !keyed}
          aria-label="Regenerate insight"
          className="shrink-0 rounded-lg p-1 text-brand-600 disabled:opacity-40"
        >
          <IconRefresh width={15} height={15} className={busy ? 'animate-spin' : ''} />
        </button>
      </div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-brand-800/90">{insight.body}</p>
      {insight.chips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {insight.chips.map((chip) => (
            <Link
              key={chip}
              to={`/coach?q=${encodeURIComponent(chip)}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/80 px-2.5 py-1.5 text-[12px] font-semibold text-brand-800"
            >
              <IconSparkle width={12} height={12} />
              {chip}
            </Link>
          ))}
        </div>
      )}
      {error && <p className="mt-2 text-[12px] text-red-700">{error}</p>}
    </div>
  );
}

/**
 * No-key (or nothing-logged) state. Computes a genuinely useful line from
 * local data so the card still earns its place on the screen.
 */
function LocalSummary({
  date,
  keyed,
  onGenerate,
}: {
  date: string;
  keyed: boolean;
  onGenerate: () => void;
}) {
  const day = useDay(date);
  const remaining = Math.max(0, day.targets.kcal - day.totals.kcal);
  const proteinLeft = Math.max(0, day.targets.protein - day.totals.protein);

  const body = !day.meals.length
    ? `Nothing logged yet. You have ${day.targets.kcal.toLocaleString()} kcal and ${day.targets.protein} g of protein to work with today.`
    : remaining > 0
      ? `${remaining.toLocaleString()} kcal left today, and ${Math.round(proteinLeft)} g of protein still to go.`
      : `You're ${Math.abs(remaining).toLocaleString()} kcal over target. Worth a lighter evening.`;

  return (
    <div className="rounded-2xl bg-brand-50 p-4">
      <div className="mb-1.5 flex items-center gap-2">
        <h2 className="text-[16px] font-bold tracking-tight text-brand-900">
          {day.meals.length ? 'Where you are today' : 'Your day is open'}
        </h2>
        {keyed && <AIBadge label="Ready" />}
      </div>
      <p className="text-[13px] leading-relaxed text-brand-800/90">{body}</p>
      {keyed ? (
        <button
          type="button"
          onClick={onGenerate}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-white/80 px-2.5 py-1.5 text-[12px] font-semibold text-brand-800"
        >
          <IconSparkle width={12} height={12} />
          Ask Ria for a read on today
        </button>
      ) : (
        <Link
          to="/settings"
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-white/80 px-2.5 py-1.5 text-[12px] font-semibold text-brand-800"
        >
          <IconSparkle width={12} height={12} />
          Add an AI key for daily insights
        </Link>
      )}
    </div>
  );
}
