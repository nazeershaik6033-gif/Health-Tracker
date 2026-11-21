import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useApp } from '@/stores/useApp';
import { addGlucose, deleteGlucose, glucoseForRange, restoreGlucose } from '@/db/repo';
import { addDays, rangeDays, relativeDayLabel, today } from '@/lib/date';
import { fromLocalInput, toLocalInput } from '@/lib/fasting';
import {
  BAND_LABEL,
  BAND_TINT,
  bandFor,
  dailyAverage,
  formatGlucose,
  fromDisplay,
  toDisplay,
  unitLabel,
  type GlucoseUnit,
} from '@/lib/glucose';
import { HAPTIC, haptic } from '@/lib/motion';
import { TrendChart } from '@/components/TrendChart';
import { Button, Card, Chip, Field, PageHeader, SectionTitle } from '@/components/ui';
import { IconGlucose, IconInfo, IconTrash } from '@/components/icons';
import { GLUCOSE_CONTEXT_LABEL, type GlucoseContext, type GlucoseEntry } from '@/types';

const CONTEXTS = Object.keys(GLUCOSE_CONTEXT_LABEL) as GlucoseContext[];

/** Chart filter: fasting readings trend very differently from post-meal ones. */
type ChartFilter = 'fasting' | 'after_meal' | 'all';

/** A guess at the context from the time of day, so most entries need no tap. */
function guessContext(at: number): GlucoseContext {
  const h = new Date(at).getHours();
  if (h >= 5 && h < 9) return 'fasting';
  if (h >= 22 || h < 2) return 'bedtime';
  return 'random';
}

export default function Glucose() {
  const { settings, setSettings, showToast } = useApp();
  const unit: GlucoseUnit = settings.glucoseUnit ?? 'mgdl';
  const to = today();
  const from = addDays(to, -29);
  const entries = useLiveQuery(() => glucoseForRange(from, to), [from, to]);

  const [value, setValue] = useState('');
  const [context, setContext] = useState<GlucoseContext>(() => guessContext(Date.now()));
  const [atInput, setAtInput] = useState(() => toLocalInput(Date.now()));
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<ChartFilter>('fasting');

  const days = rangeDays(to, 14);
  const chartData = useMemo(() => {
    const list = (entries ?? []).filter((e) =>
      filter === 'all' ? true : filter === 'fasting' ? e.context === 'fasting' || e.context === 'before_meal' : e.context === 'after_meal',
    );
    const avg = dailyAverage(list, days);
    // Only days with a reading: a line through zeroes for the days in between
    // would dive off the bottom of the chart and read as a crash.
    return days.flatMap((date, i) => (avg[i] ? [{ date, value: toDisplay(avg[i], unit) }] : []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, filter, unit, to]);

  const recent = useMemo(() => [...(entries ?? [])].sort((a, b) => b.at - a.at), [entries]);
  const last14 = recent.filter((e) => e.date >= days[0]);
  const inRange = last14.filter((e) => bandFor(e.mgdl, e.context) === 'normal').length;
  const fastingReadings = last14.filter((e) => e.context === 'fasting');
  const fastingAvg = fastingReadings.length
    ? fastingReadings.reduce((s, e) => s + e.mgdl, 0) / fastingReadings.length
    : undefined;

  async function save() {
    const n = Number(value.replace(',', '.'));
    const mgdl = fromDisplay(n, unit);
    // Wide enough for any real meter reading, narrow enough to catch a typo
    // like a missing decimal point in mmol/L.
    if (!Number.isFinite(n) || mgdl < 20 || mgdl > 600) {
      return setError(unit === 'mmol' ? 'Enter a reading between 1.1 and 33.3.' : 'Enter a reading between 20 and 600.');
    }
    const at = fromLocalInput(atInput) ?? Date.now();
    if (at > Date.now() + 60_000) return setError("A reading can't be in the future.");
    haptic(HAPTIC.success);
    await addGlucose({ at, mgdl: Math.round(mgdl * 10) / 10, context, note: note.trim() || undefined });
    setValue('');
    setNote('');
    setError('');
    setAtInput(toLocalInput(Date.now()));
    setContext(guessContext(Date.now()));
  }

  async function remove(entry: GlucoseEntry) {
    await deleteGlucose(entry.id);
    showToast({
      message: 'Reading deleted',
      actionLabel: 'Undo',
      onAction: () => void restoreGlucose(entry),
    });
  }

  return (
    <div className="pb-6">
      <PageHeader
        title="Blood sugar"
        subtitle={`Readings in ${unitLabel(unit)}`}
        action={
          <button
            type="button"
            onClick={() => {
              setError('');
              setValue('');
              void setSettings({ glucoseUnit: unit === 'mgdl' ? 'mmol' : 'mgdl' });
            }}
            className="rounded-lg px-2 py-1.5 text-[12.5px] font-semibold text-brand-600"
          >
            Use {unit === 'mgdl' ? 'mmol/L' : 'mg/dL'}
          </button>
        }
      />

      <div className="space-y-3 px-4 pt-3">
        <Card className="space-y-3">
          <SectionTitle>Add a reading</SectionTitle>
          <Field
            value={value}
            onChange={(e) => setValue(e.target.value.replace(/[^\d.,]/g, ''))}
            inputMode="decimal"
            placeholder={unit === 'mmol' ? 'e.g. 5.4' : 'e.g. 96'}
            suffix={unitLabel(unit)}
            error={error}
            aria-label="Blood glucose reading"
          />
          <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {CONTEXTS.map((c) => (
              <Chip key={c} active={c === context} onClick={() => setContext(c)}>
                {GLUCOSE_CONTEXT_LABEL[c]}
              </Chip>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[12px] font-semibold text-secondary">
              Time
              <input
                type="datetime-local"
                value={atInput}
                max={toLocalInput(Date.now())}
                onChange={(e) => setAtInput(e.target.value)}
                className="hairline mt-1 block w-full rounded-xl border bg-transparent px-2.5 py-2.5 text-[13.5px]"
              />
            </label>
            <label className="block text-[12px] font-semibold text-secondary">
              Note
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional"
                maxLength={80}
                className="hairline mt-1 block w-full rounded-xl border bg-transparent px-2.5 py-2.5 text-[13.5px]"
              />
            </label>
          </div>
          <Button full onClick={() => void save()} disabled={!value}>
            Save reading
          </Button>
        </Card>

        <Card>
          <SectionTitle>Last 14 days</SectionTitle>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="tabular text-[17px] font-bold">{last14.length}</p>
              <p className="text-[11px] text-muted">Readings</p>
            </div>
            <div>
              <p className="tabular text-[17px] font-bold">
                {last14.length ? `${Math.round((inRange / last14.length) * 100)}%` : '—'}
              </p>
              <p className="text-[11px] text-muted">In range</p>
            </div>
            <div>
              <p className="tabular text-[17px] font-bold">
                {fastingAvg ? formatGlucose(fastingAvg, unit) : '—'}
              </p>
              <p className="text-[11px] text-muted">Fasting avg</p>
            </div>
          </div>
          <div className="mt-3 mb-2 flex gap-2">
            {(['fasting', 'after_meal', 'all'] as ChartFilter[]).map((f) => (
              <Chip key={f} active={f === filter} onClick={() => setFilter(f)}>
                {f === 'fasting' ? 'Fasting' : f === 'after_meal' ? 'After meals' : 'All'}
              </Chip>
            ))}
          </div>
          {entries && chartData.length === 0 ? (
            <p className="py-8 text-center text-[12.5px] text-muted">No readings of this kind in the last 14 days.</p>
          ) : entries ? (
            <TrendChart
              data={chartData}
              kind="line"
              domainFromData
              color="var(--color-ring-glucose)"
              goal={
                filter === 'all' ? undefined : toDisplay(filter === 'fasting' ? 100 : 140, unit)
              }
              unit={` ${unitLabel(unit)}`}
            />
          ) : (
            <div className="h-[180px]" />
          )}
          <p className="mt-1 text-[11.5px] text-muted">
            Daily average. The dashed line is the top of the typical range
            {filter === 'fasting' ? ' fasting' : filter === 'after_meal' ? ' two hours after eating' : ''}.
          </p>
        </Card>

        {recent.length > 0 && (
          <Card className="py-2">
            <div className="px-1 pt-2">
              <SectionTitle>Readings</SectionTitle>
            </div>
            <ul>
              {recent.slice(0, 30).map((e) => {
                const band = bandFor(e.mgdl, e.context);
                return (
                  <li
                    key={e.id}
                    className="flex items-center gap-3 border-t border-[var(--surface-border)] px-1 py-2.5 first:border-t-0"
                  >
                    <div className="w-16 shrink-0">
                      <p className="tabular text-[17px] leading-tight font-bold">{formatGlucose(e.mgdl, unit)}</p>
                      <p className="text-[10.5px] text-muted">{unitLabel(unit)}</p>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold">{GLUCOSE_CONTEXT_LABEL[e.context]}</p>
                      <p className="truncate text-[11.5px] text-muted">
                        {relativeDayLabel(e.date)},{' '}
                        {new Date(e.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                        {e.note ? ` · ${e.note}` : ''}
                      </p>
                    </div>
                    <span className={`tint-soft ${BAND_TINT[band]} shrink-0 rounded-lg px-2 py-1 text-[11px] font-bold`}>
                      {BAND_LABEL[band]}
                    </span>
                    <button
                      type="button"
                      onClick={() => void remove(e)}
                      aria-label="Delete this reading"
                      className="rounded-full p-2 text-muted hover:surface-sunken"
                    >
                      <IconTrash width={16} height={16} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        {recent.length === 0 && entries && (
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <IconGlucose width={26} height={26} className="text-[var(--color-ring-glucose)]" />
            <p className="max-w-[18rem] text-[13px] text-secondary">
              Log readings from your meter or sensor. A fasting reading first thing each morning is
              the most useful single number to track.
            </p>
          </div>
        )}

        <div className="flex items-start gap-2 px-1 text-[12px] text-muted">
          <IconInfo width={14} height={14} className="mt-0.5 shrink-0" />
          <p>
            Ranges are the general reference for adults without diabetes (fasting under{' '}
            {formatGlucose(100, unit)}, two hours after a meal under {formatGlucose(140, unit)}{' '}
            {unitLabel(unit)}). They are not a diagnosis — if you manage diabetes, use the targets
            your doctor set. Repeated readings under {formatGlucose(70, unit)} or over{' '}
            {formatGlucose(250, unit)} need medical advice.
          </p>
        </div>
      </div>
    </div>
  );
}
