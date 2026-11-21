import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useApp } from '@/stores/useApp';
import { deleteFast, endFast, recentFasts, restoreFast, startFast, updateFast } from '@/db/repo';
import {
  DEFAULT_FAST_HOURS,
  FAST_PROTOCOLS,
  FAST_STAGES,
  completed,
  elapsedHours,
  fastHoursByDay,
  fastStats,
  formatClockElapsed,
  formatFastDuration,
  fromLocalInput,
  stageFor,
  toLocalInput,
} from '@/lib/fasting';
import { rangeDays, relativeDayLabel, toISODate, today } from '@/lib/date';
import { HAPTIC, haptic } from '@/lib/motion';
import { RingProgress } from '@/components/RingProgress';
import { TrendChart } from '@/components/TrendChart';
import { Button, Card, Chip, PageHeader, SectionTitle } from '@/components/ui';
import { IconCheck, IconInfo, IconTimer, IconTrash } from '@/components/icons';
import type { FastEntry } from '@/types';

const HOUR = 3_600_000;

const timeLabel = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

const whenLabel = (ms: number) => {
  const day = toISODate(new Date(ms));
  return `${relativeDayLabel(day)}, ${timeLabel(ms)}`;
};

export default function Fasting() {
  const { settings, setSettings, showToast } = useApp();
  const fasts = useLiveQuery(() => recentFasts(60), []);
  const targetHours = settings.fastTargetHours ?? DEFAULT_FAST_HOURS;

  const active = fasts?.[0] && fasts[0].endAt === undefined ? fasts[0] : undefined;
  const finished = useMemo(() => (fasts ?? []).filter((f) => f.endAt !== undefined), [fasts]);
  const stats = useMemo(() => fastStats(finished), [finished]);

  const days = rangeDays(today(), 14);
  const series = useMemo(
    () => (fasts ? fastHoursByDay(fasts, days) : []),
    // `days` is derived from today and only changes at midnight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fasts, days[days.length - 1]],
  );

  async function pickProtocol(hours: number) {
    haptic(HAPTIC.tap);
    await setSettings({ fastTargetHours: hours });
    // The running fast follows the new goal: picking 18:6 mid-fast means
    // "I'm going for 18 today", not "next time".
    if (active) await updateFast(active.id, { targetHours: hours });
  }

  async function start() {
    haptic(HAPTIC.success);
    await startFast(targetHours);
  }

  async function finish(fast: FastEntry) {
    haptic(HAPTIC.success);
    await endFast(fast.id);
    const hours = elapsedHours({ ...fast, endAt: Date.now() });
    showToast({
      message:
        hours >= fast.targetHours
          ? `Fast complete: ${formatFastDuration(hours)}`
          : `Fast ended at ${formatFastDuration(hours)}`,
      actionLabel: 'Undo',
      onAction: () => void restoreFast(fast),
    });
  }

  async function remove(fast: FastEntry) {
    await deleteFast(fast.id);
    showToast({
      message: 'Fast deleted',
      actionLabel: 'Undo',
      onAction: () => void restoreFast(fast),
    });
  }

  const protocol = FAST_PROTOCOLS.find((p) => p.hours === targetHours);

  return (
    <div className="pb-6">
      <PageHeader
        title="Fasting"
        subtitle={`Goal: ${targetHours} h fast · ${24 - targetHours} h eating window`}
      />

      <div className="space-y-3 px-4 pt-3">
        {fasts === undefined ? (
          <Card className="h-[340px]">{null}</Card>
        ) : active ? (
          <ActiveFast fast={active} onEnd={() => void finish(active)} />
        ) : (
          <Card className="flex flex-col items-center gap-4 py-6">
            <RingProgress value={0} size={168} stroke={12} color="var(--color-ring-fast)">
              <div className="text-center">
                <IconTimer width={26} height={26} className="mx-auto text-[var(--color-ring-fast)]" />
                <p className="mt-1 text-[15px] font-bold">Not fasting</p>
                <p className="text-[11.5px] text-muted">{protocol?.label ?? `${targetHours} h`} ready</p>
              </div>
            </RingProgress>
            {finished[0] && (
              <p className="text-[12.5px] text-secondary">
                Eating since {whenLabel(finished[0].endAt!)}
              </p>
            )}
            <Button size="lg" onClick={() => void start()}>
              Start {targetHours} h fast
            </Button>
          </Card>
        )}

        <Card>
          <SectionTitle>Schedule</SectionTitle>
          <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {FAST_PROTOCOLS.map((p) => (
              <Chip key={p.hours} active={p.hours === targetHours} onClick={() => void pickProtocol(p.hours)}>
                {p.label}
              </Chip>
            ))}
          </div>
          <p className="mt-2 text-[12.5px] text-secondary">
            {protocol?.hint ?? 'A custom window.'}{' '}
            {active ? 'Changing it updates the fast in progress.' : ''}
          </p>
        </Card>

        <Card>
          <SectionTitle>Your fasting</SectionTitle>
          <div className="grid grid-cols-4 gap-2 text-center">
            <Stat value={String(stats.completedCount)} label="Goals hit" />
            <Stat value={stats.count ? formatFastDuration(stats.averageHours).replace(/ \d+ m$/, ' h') : '—'} label="Average" />
            <Stat value={stats.count ? `${Math.floor(stats.longestHours)} h` : '—'} label="Longest" />
            <Stat value={String(stats.streak)} label="Streak" />
          </div>
        </Card>

        <Card>
          <SectionTitle>Last 14 days</SectionTitle>
          {fasts ? (
            <TrendChart
              data={days.map((date, i) => ({ date, value: series[i] ?? 0 }))}
              color="var(--color-ring-fast)"
              goal={targetHours}
              unit=" h"
            />
          ) : (
            <div className="h-[180px]" />
          )}
        </Card>

        {finished.length > 0 && (
          <Card className="py-2">
            <div className="px-1 pt-2">
              <SectionTitle>History</SectionTitle>
            </div>
            <ul>
              {finished.slice(0, 20).map((f) => {
                const hours = elapsedHours(f);
                const hit = completed(f);
                return (
                  <li
                    key={f.id}
                    className="flex items-center gap-3 border-t border-[var(--surface-border)] px-1 py-2.5 first:border-t-0"
                  >
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                        hit ? 'tint-brand' : 'surface-sunken text-muted'
                      }`}
                    >
                      {hit ? <IconCheck width={16} height={16} /> : <IconTimer width={16} height={16} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="tabular text-[13.5px] font-semibold">
                        {formatFastDuration(hours)}{' '}
                        <span className="font-normal text-muted">/ {f.targetHours} h</span>
                      </p>
                      <p className="truncate text-[11.5px] text-muted">
                        {whenLabel(f.startAt)} → {timeLabel(f.endAt!)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void remove(f)}
                      aria-label="Delete this fast"
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

        <div className="flex items-start gap-2 px-1 text-[12px] text-muted">
          <IconInfo width={14} height={14} className="mt-0.5 shrink-0" />
          <p>
            The stages are rough, average timings — they shift with what you last ate and how
            active you are. Fasting is not advised if you are pregnant, have diabetes managed with
            medication, or have a history of disordered eating; check with your doctor first.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * The running fast. Its own component so the one-second tick re-renders this
 * card alone, not the history list and chart below it.
 */
function ActiveFast({ fast, onEnd }: { fast: FastEntry; onEnd: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const [editing, setEditing] = useState(false);
  const [startInput, setStartInput] = useState(() => toLocalInput(fast.startAt));
  const [error, setError] = useState('');

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const ms = Math.max(0, now - fast.startAt);
  const hours = ms / HOUR;
  const goalAt = fast.startAt + fast.targetHours * HOUR;
  const done = hours >= fast.targetHours;
  const stage = stageFor(hours);
  const nextStage = FAST_STAGES.find((s) => s.fromHours > hours);

  async function saveStart() {
    const at = fromLocalInput(startInput);
    if (at === undefined) return setError('Pick a valid time.');
    if (at > Date.now()) return setError("A fast can't start in the future.");
    if (Date.now() - at > 72 * HOUR) return setError('That is more than three days ago.');
    await updateFast(fast.id, { startAt: at });
    setError('');
    setEditing(false);
  }

  return (
    <Card className="flex flex-col items-center gap-4 py-6">
      <RingProgress
        // Capped: past the goal is success, not the overshoot the ring's red
        // overflow arc means for calories.
        value={Math.min(1, hours / fast.targetHours)}
        size={168}
        stroke={12}
        color="var(--color-ring-fast)"
        label={`${formatFastDuration(hours)} of ${fast.targetHours} hours`}
      >
        <div className="text-center">
          <p className="text-[11px] font-semibold text-muted">{done ? 'Goal reached' : 'Elapsed'}</p>
          <p className="tabular text-[26px] leading-tight font-extrabold">{formatClockElapsed(ms)}</p>
          <p className="tabular text-[11.5px] text-muted">
            {done
              ? `+${formatFastDuration(hours - fast.targetHours)} over`
              : `${formatFastDuration(fast.targetHours - hours)} to go`}
          </p>
        </div>
      </RingProgress>

      <div className="grid w-full grid-cols-2 gap-2 text-center">
        <div className="surface-sunken rounded-xl px-2 py-2">
          <p className="eyebrow">Started</p>
          <p className="tabular mt-0.5 text-[13px] font-semibold">{whenLabel(fast.startAt)}</p>
        </div>
        <div className="surface-sunken rounded-xl px-2 py-2">
          <p className="eyebrow">{fast.targetHours} h goal</p>
          <p className="tabular mt-0.5 text-[13px] font-semibold">{whenLabel(goalAt)}</p>
        </div>
      </div>

      <div className="accent-card accent-amber w-full rounded-xl px-3 py-2.5">
        <p className="text-[13px] font-bold">{stage.title}</p>
        <p className="mt-0.5 text-[12.5px] leading-relaxed">{stage.body}</p>
        {nextStage && (
          <p className="mt-1 text-[11.5px] opacity-80">
            Next, around {nextStage.fromHours} h: {nextStage.title.toLowerCase()}
          </p>
        )}
      </div>

      {editing ? (
        <div className="w-full space-y-2">
          <label className="block text-[12.5px] font-semibold text-secondary">
            When did you last eat?
            <input
              type="datetime-local"
              value={startInput}
              max={toLocalInput(Date.now())}
              onChange={(e) => setStartInput(e.target.value)}
              className="hairline mt-1 block w-full rounded-xl border bg-transparent px-3 py-2.5 text-[14px]"
            />
          </label>
          {error && <p className="text-[12px] text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button variant="secondary" full onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button full onClick={() => void saveStart()}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex w-full gap-2">
          <Button
            variant="secondary"
            full
            onClick={() => {
              setStartInput(toLocalInput(fast.startAt));
              setEditing(true);
            }}
          >
            Edit start
          </Button>
          <Button full onClick={onEnd}>
            {done ? 'Finish fast' : 'End fast'}
          </Button>
        </div>
      )}
    </Card>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="tabular text-[17px] font-bold tracking-tight">{value}</p>
      <p className="text-[11px] text-muted">{label}</p>
    </div>
  );
}
