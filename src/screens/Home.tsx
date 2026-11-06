import { memo, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/schema';
import { useApp } from '@/stores/useApp';
import { useDay, useHistory, useStreak, useWeightHistory } from '@/stores/useDay';
import { TopBar } from '@/components/TopBar';
import { RingProgress } from '@/components/RingProgress';
import { MealPickerSheet } from '@/components/MealPickerSheet';
import { InsightCard } from '@/components/InsightCard';
import { MiniBars, Sparkline } from '@/components/Spark';
import { ProgressBar } from '@/components/ui';
import { CountUp } from '@/components/CountUp';
import {
  IconBarcode,
  IconCamera,
  IconChat,
  IconChevronRight,
  IconClose,
  IconDroplet,
  IconFlame,
  IconGallery,
  IconLeaf,
  IconMic,
  IconMoon,
  IconPlans,
  IconPlus,
  IconScale,
  IconSearch,
  IconSteps,
  IconWarning,
} from '@/components/icons';
import { formatDuration, isToday, relativeDayLabel } from '@/lib/date';
import { backupOverdue, describeLastBackup } from '@/lib/backup';
import { bmr, kgToDisplay, tdee, weightUnit } from '@/lib/nutrition';
import { MICRO_IDS, microRows } from '@/lib/micros';
import {
  age,
  bmi,
  bmiBand,
  bmiGaugePosition,
  scoreDay,
  weeklyWeightTrend,
  weeksToGoal,
} from '@/lib/healthScore';
import { HAPTIC, haptic } from '@/lib/motion';
import { setWater } from '@/db/repo';
import type { MealSlot, Snap } from '@/types';

export default function Home() {
  const navigate = useNavigate();
  const { profile, settings, selectedDate, setPendingSlot, showToast } = useApp();
  const day = useDay();
  const streak = useStreak();
  const week = useHistory(7, selectedDate);
  const weights = useWeightHistory(90);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Dismissal is per-session rather than stored: the nudge should come back
  // tomorrow if the backup still hasn't happened, but never twice in a sitting.
  const [backupDismissed, setBackupDismissed] = useState(false);

  const showBackupNudge = !backupDismissed && backupOverdue(settings, profile?.createdAt);

  const snaps = useLiveQuery(
    async () => db.snaps.orderBy('createdAt').reverse().limit(8).toArray(),
    [],
  );

  const units = profile?.units ?? 'metric';
  // Macros answer "how much"; this answers "of what". Summarised to one line
  // here — the full breakdown lives on its own screen.
  const microsOnTrack = microRows(day.micros, day.microTargets).filter(
    (r) => r.status === 'good',
  ).length;
  const workoutGoal = profile?.workoutKcalGoal || 300;
  const sleepGoal = profile?.sleepGoalMin || 480;

  const score = scoreDay({
    totals: day.totals,
    targets: day.targets,
    glasses: day.glasses,
    waterGoal: day.waterGoal,
    sleepMin: day.sleep?.durationMin,
    sleepGoalMin: sleepGoal,
    steps: day.stepCount,
    stepGoal: day.stepGoal,
    workoutKcal: day.workoutKcal,
    workoutGoal,
  });

  const openSlot = (slot: MealSlot) => {
    setPendingSlot(slot);
    setPickerOpen(false);
    navigate('/search');
  };

  async function addGlass() {
    haptic(HAPTIC.success);
    await setWater(selectedDate, { glasses: day.glasses + 1 }, profile?.waterGoalGlasses ?? 9);
    showToast({
      message: `Water logged — ${day.glasses + 1} of ${day.waterGoal} glasses`,
      actionLabel: 'Undo',
      onAction: () =>
        setWater(selectedDate, { glasses: day.glasses }, profile?.waterGoalGlasses ?? 9),
    });
  }

  let i = 0;
  const next = () => ({ '--i': i++ }) as CSSProperties;

  return (
    <>
      <TopBar streakDays={streak?.streak} />

      <div className="stagger space-y-3.5 px-4 pt-3">
        {showBackupNudge && (
          <div style={next()} className="accent-card accent-amber flex items-center gap-3 p-3.5">
            <IconWarning width={18} height={18} className="accent-rule-fg shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="accent-title text-[13.5px] font-bold">
                {describeLastBackup(settings.lastBackupAt)}
              </p>
              <p className="accent-body text-[12px]">
                Everything is stored in this browser — clearing site data erases it.
              </p>
            </div>
            <Link
              to="/settings"
              className="accent-pill shrink-0 rounded-xl px-2.5 py-1.5 text-[12px] font-semibold"
            >
              Back up
            </Link>
            <button
              type="button"
              onClick={() => setBackupDismissed(true)}
              aria-label="Dismiss backup reminder"
              className="accent-body shrink-0 rounded-lg p-1"
            >
              <IconClose width={15} height={15} />
            </button>
          </div>
        )}

        <div style={next()}>
          <EnergyHero
            eaten={day.totals.kcal}
            target={day.targets.kcal}
            // Workouts plus steps, so moving changes the number people look at most.
            burned={day.burnedKcal}
            totals={day.totals}
            targets={day.targets}
            dateLabel={relativeDayLabel(selectedDate)}
          />
        </div>

        {/* ------------------------- Quick log ------------------------- */}
        <div style={next()} className="grid grid-cols-4 gap-2.5">
          <QuickAction to="/snap" label="Snap" tint="tint-warm" icon={<IconCamera width={21} height={21} />} />
          <QuickAction to="/scan" label="Barcode" tint="tint-blue" icon={<IconBarcode width={21} height={21} />} />
          <QuickAction to="/voice" label="Voice" tint="tint-purple" icon={<IconMic width={21} height={21} />} />
          <QuickAction
            onClick={() => setPickerOpen(true)}
            label="Search"
            tint="tint-brand"
            icon={<IconSearch width={21} height={21} />}
          />
        </div>

        <Link
          style={next()}
          to={`/micros?date=${selectedDate}`}
          className="surface-card flex items-center gap-3 p-3.5"
        >
          <span className="tint-soft tint-brand flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
            <IconLeaf width={19} height={19} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold">Micronutrients</span>
            <span className="block truncate text-[12px] text-secondary">
              {day.meals.length === 0
                ? `${MICRO_IDS.length} micronutrients to hit today`
                : `${microsOnTrack} of ${MICRO_IDS.length} on track${
                    day.microCoverage < 0.95
                      ? ` · ${Math.round(day.microCoverage * 100)}% of the day counted`
                      : ''
                  }`}
            </span>
          </span>
          <IconChevronRight width={18} height={18} className="shrink-0 text-muted" />
        </Link>

        <div style={next()}>
          <ScoreCard score={score} isToday={isToday(selectedDate)} />
        </div>

        <div style={next()}>
          <InsightCard date={selectedDate} />
        </div>

        {/* -------------------------- Trackers ------------------------- */}
        <div style={next()} className="flex items-end justify-between px-1 pt-2">
          <h2 className="text-[19px] font-bold tracking-tight">Trackers</h2>
          <span className="text-[12px] font-medium text-muted">Last 7 days</span>
        </div>

        <div style={next()} className="grid grid-cols-2 gap-3">
          <TrackerCard
            to="/trackers/water"
            label="Water"
            color="var(--color-ring-water)"
            tint="tint-blue"
            icon={<IconDroplet width={17} height={17} />}
            value={`${day.glasses}`}
            unit={`/ ${day.waterGoal} glasses`}
            progress={day.glasses / (day.waterGoal || 9)}
            series={week?.map((d) => d.glasses) ?? []}
            goal={day.waterGoal}
            delta={deltaVsAverage(week?.map((d) => d.glasses))}
            action={
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  void addGlass();
                }}
                aria-label="Add a glass of water"
                className="tint-blue flex h-8 w-8 items-center justify-center rounded-full"
              >
                <IconPlus width={16} height={16} strokeWidth={2.4} />
              </button>
            }
          />
          <TrackerCard
            to="/trackers/sleep"
            label="Sleep"
            color="var(--color-ring-sleep)"
            tint="tint-blue"
            icon={<IconMoon width={17} height={17} />}
            value={day.sleep ? formatDuration(day.sleep.durationMin) : '—'}
            unit={`/ ${formatDuration(sleepGoal)}`}
            progress={(day.sleep?.durationMin ?? 0) / sleepGoal}
            series={week?.map((d) => d.sleepMin) ?? []}
            goal={sleepGoal}
            delta={deltaVsAverage(week?.map((d) => d.sleepMin), (n) => formatDuration(Math.abs(n)))}
          />
          <TrackerCard
            to="/trackers/steps"
            label="Steps"
            color="var(--color-ring-walk)"
            tint="tint-purple"
            icon={<IconSteps width={17} height={17} />}
            value={day.stepCount ? day.stepCount.toLocaleString() : '—'}
            unit={`/ ${(day.stepGoal / 1000).toFixed(day.stepGoal % 1000 ? 1 : 0)}k`}
            progress={day.stepCount / (day.stepGoal || 8000)}
            series={week?.map((d) => d.steps) ?? []}
            goal={day.stepGoal}
            delta={deltaVsAverage(week?.map((d) => d.steps), (n) => Math.abs(Math.round(n)).toLocaleString())}
          />
          <TrackerCard
            to="/trackers/workout"
            label="Workout"
            color="var(--color-ring-workout)"
            tint="tint-danger"
            icon={<IconFlame width={17} height={17} />}
            value={day.workoutKcal ? `${day.workoutKcal}` : '—'}
            unit={`/ ${workoutGoal} kcal`}
            progress={day.workoutKcal / workoutGoal}
            series={week?.map((d) => d.burned) ?? []}
            goal={workoutGoal}
            delta={deltaVsAverage(week?.map((d) => d.burned))}
          />
        </div>

        <div style={next()}>
          <BodyCard
            weights={weights ?? []}
            units={units}
            onboarded={Boolean(profile)}
          />
        </div>

        <div style={next()}>
          <WeekSummary week={week} target={day.targets.kcal} sleepGoal={sleepGoal} />
        </div>

        {/* --------------------------- Snaps --------------------------- */}
        {snaps && snaps.length > 0 && (
          <div style={next()}>
            <div className="mb-2.5 flex items-end justify-between px-1 pt-2">
              <h2 className="text-[19px] font-bold tracking-tight">Recent snaps</h2>
              <Link to="/snap/gallery" className="text-[13px] font-semibold text-brand-600">
                See all
              </Link>
            </div>
            <div className="scroll-x no-scrollbar -mx-4 flex snap-x gap-2.5 px-4 pb-1">
              {snaps.map((s) => (
                <SnapThumb key={s.id} snap={s} />
              ))}
            </div>
          </div>
        )}

        {/* ------------------------ AI coach / plan --------------------- */}
        <div style={next()} className="grid grid-cols-2 gap-3 pt-1">
          <Link to="/coach" className="surface-card flex flex-col gap-3 p-4">
            <span className="tint-brand flex h-10 w-10 items-center justify-center rounded-2xl">
              <IconChat width={19} height={19} />
            </span>
            <span>
              <span className="block text-[15px] font-bold">Ask Ria</span>
              <span className="block text-[12px] leading-snug text-secondary">
                Your AI coach, with today in context
              </span>
            </span>
          </Link>
          <Link to="/plans" className="surface-card flex flex-col gap-3 p-4">
            <span className="tint-warm flex h-10 w-10 items-center justify-center rounded-2xl">
              <IconPlans width={19} height={19} />
            </span>
            <span>
              <span className="block text-[15px] font-bold">Diet plan</span>
              <span className="block text-[12px] leading-snug text-secondary">
                Built from your goal and targets
              </span>
            </span>
          </Link>
        </div>

        {snaps && snaps.length === 0 && (
          <Link
            style={next()}
            to="/snap/gallery"
            className="surface-card flex items-center gap-3 p-3.5"
          >
            <span className="tint-warm flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl">
              <IconGallery width={19} height={19} />
            </span>
            <span className="flex-1 text-[13.5px] font-semibold">Your meal photos live here</span>
            <IconChevronRight width={18} height={18} className="text-muted" />
          </Link>
        )}

        <MetabolismNote />
      </div>

      <MealPickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={openSlot}
        date={selectedDate}
      />
    </>
  );
}

/* ================================================================ pieces */

/**
 * Today's change against the average of the earlier days in the window that
 * have any data — so a week with two logged days compares against those two,
 * not against five zeros.
 */
function deltaVsAverage(
  series: number[] | undefined,
  fmt: (n: number) => string = (n) => Math.abs(Math.round(n)).toLocaleString(),
): { text: string; up: boolean } | undefined {
  if (!series || series.length < 2) return undefined;
  const current = series[series.length - 1];
  const earlier = series.slice(0, -1).filter((v) => v > 0);
  if (!earlier.length || current <= 0) return undefined;
  const avg = earlier.reduce((a, b) => a + b, 0) / earlier.length;
  const diff = current - avg;
  if (Math.abs(diff) < avg * 0.03) return { text: 'On your average', up: true };
  return { text: `${diff > 0 ? '▲' : '▼'} ${fmt(diff)} vs avg`, up: diff > 0 };
}

function EnergyHero({
  eaten,
  target,
  burned,
  totals,
  targets,
  dateLabel,
}: {
  eaten: number;
  target: number;
  burned: number;
  totals: { protein: number; carbs: number; fat: number; fibre: number };
  targets: { protein: number; carbs: number; fat: number; fibre: number };
  dateLabel: string;
}) {
  // Net of what was burned, so the ring unwinds when you train or walk —
  // the same reading the Diet screen gives.
  const net = eaten - burned;
  const left = Math.round(target - net);
  const over = left < 0;
  const macros = [
    { label: 'Protein', v: totals.protein, t: targets.protein, color: '#fbbf24' },
    { label: 'Carbs', v: totals.carbs, t: targets.carbs, color: '#a78bfa' },
    { label: 'Fat', v: totals.fat, t: targets.fat, color: '#fb7185' },
    { label: 'Fibre', v: totals.fibre, t: targets.fibre, color: '#34d399' },
  ];

  return (
    <Link
      to="/diet"
      className="hero-gradient relative block overflow-hidden rounded-[1.75rem] p-5"
    >
      {/* Soft orb for depth */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-16 -right-10 h-48 w-48 rounded-full bg-emerald-300/15 blur-3xl"
      />
      <div className="relative flex items-center justify-between">
        <span className="text-[11px] font-bold tracking-[0.12em] text-white/60 uppercase">
          Energy · {dateLabel}
        </span>
        <IconChevronRight width={18} height={18} className="text-white/50" />
      </div>

      <div className="relative mt-3 flex items-center gap-5">
        <RingProgress
          value={target > 0 ? Math.max(0, net) / target : 0}
          size={132}
          stroke={11}
          color="#ff8a3d"
          trackColor="rgb(255 255 255 / 0.1)"
          label={`${Math.round(net)} net of ${target} calories: ${Math.round(eaten)} eaten, ${Math.round(burned)} burned`}
        >
          <div className="text-center">
            <CountUp
              value={Math.abs(left)}
              format={(n) => Math.round(n).toLocaleString()}
              className="block text-[30px] leading-none font-bold tracking-tight"
            />
            <span className="mt-1 block text-[11px] font-semibold text-white/65">
              {over ? 'kcal over' : 'kcal left'}
            </span>
          </div>
        </RingProgress>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <HeroStat label="Eaten" value={eaten} dot="#ff8a3d" />
          <HeroStat label="Burned" value={burned} dot="#f472b6" />
          <HeroStat label="Target" value={target} dot="rgb(255 255 255 / 0.5)" />
        </div>
      </div>

      <div className="relative mt-5 grid grid-cols-4 gap-3 border-t border-white/10 pt-4">
        {macros.map((m) => {
          const pct = m.t > 0 ? m.v / m.t : 0;
          return (
            <div key={m.label} className="min-w-0">
              <p className="text-[11px] font-semibold text-white/60">{m.label}</p>
              <p className="tabular mt-0.5 truncate text-[13.5px] font-bold">
                {Math.round(m.v)}
                <span className="text-[11px] font-medium text-white/50">/{m.t}g</span>
              </p>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/12">
                <div
                  className="h-full rounded-full transition-[width] duration-1000 ease-[cubic-bezier(0.16,1,0.3,1)]"
                  style={{
                    width: `${Math.min(100, pct * 100)}%`,
                    background: pct > 1.05 ? '#f87171' : m.color,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </Link>
  );
}

function HeroStat({ label, value, dot }: { label: string; value: number; dot: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />
      <span className="flex-1 text-[12.5px] font-medium text-white/70">{label}</span>
      <CountUp
        value={Math.round(value)}
        format={(n) => Math.round(n).toLocaleString()}
        className="tabular text-[16px] font-bold"
      />
    </div>
  );
}

function QuickAction({
  to,
  onClick,
  label,
  icon,
  tint,
}: {
  to?: string;
  onClick?: () => void;
  label: string;
  icon: ReactNode;
  tint: string;
}) {
  const body = (
    <>
      <span className={`${tint} flex h-11 w-11 items-center justify-center rounded-2xl`}>{icon}</span>
      <span className="text-[12px] font-semibold">{label}</span>
    </>
  );
  const cls = 'surface-card flex flex-col items-center gap-2 py-3.5';
  return to ? (
    <Link to={to} className={cls}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {body}
    </button>
  );
}

function ScoreCard({ score, isToday: today }: { score: ReturnType<typeof scoreDay>; isToday: boolean }) {
  const [open, setOpen] = useState(false);
  const color =
    score.score >= 85 ? '#10b981' : score.score >= 70 ? '#22c55e' : score.score >= 45 ? '#f5a524' : '#f97316';
  const weakest = [...score.pillars].sort((a, b) => a.score * a.weight - b.score * b.weight)[0];

  return (
    <div className="surface-card p-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-4 text-left"
      >
        <RingProgress value={score.score / 100} size={64} stroke={6} color={color} label={`Health score ${score.score}`}>
          <CountUp
            value={score.score}
            format={(n) => String(Math.round(n))}
            className="tabular text-[19px] font-bold"
          />
        </RingProgress>
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Health score</p>
          <p className="text-[17px] font-bold tracking-tight" style={{ color }}>
            {score.band}
          </p>
          <p className="truncate text-[12.5px] text-secondary">
            {score.score >= 95
              ? 'Every pillar covered. Lovely.'
              : `${today ? 'Biggest lift left' : 'Weakest pillar'}: ${weakest.label.toLowerCase()}`}
          </p>
        </div>
        <IconChevronRight
          width={18}
          height={18}
          className={`shrink-0 text-muted transition-transform duration-300 ${open ? 'rotate-90' : ''}`}
        />
      </button>

      {/* grid-rows trick: animates to the content's natural height */}
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">
          <div className="hairline mt-4 space-y-3 border-t pt-4">
            {score.pillars.map((p) => (
              <div key={p.key}>
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <span className="text-[13px] font-semibold">
                    {p.label}
                    {p.weight > 1 && <span className="ml-1 text-[11px] font-medium text-muted">×{p.weight}</span>}
                  </span>
                  <span className="tabular truncate text-[12px] text-secondary">{p.detail}</span>
                </div>
                <ProgressBar value={p.score} color={p.color} />
              </div>
            ))}
            <p className="pt-1 text-[11.5px] leading-relaxed text-muted">
              Calories count double. Each pillar scores against your own goals — full marks for
              calories within 10% of target.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function TrackerCard({
  to,
  label,
  icon,
  color,
  tint,
  value,
  unit,
  progress,
  series,
  goal,
  delta,
  action,
}: {
  to: string;
  label: string;
  icon: ReactNode;
  color: string;
  tint: string;
  value: string;
  unit: string;
  progress: number;
  series: number[];
  goal?: number;
  delta?: { text: string; up: boolean };
  action?: ReactNode;
}) {
  return (
    <Link to={to} className="surface-card flex flex-col p-3.5">
      <div className="flex items-center gap-2">
        <span className={`${tint} flex h-8 w-8 items-center justify-center rounded-xl`} style={{ color }}>
          {icon}
        </span>
        <span className="flex-1 text-[13.5px] font-semibold">{label}</span>
        {action ?? (
          <RingProgress value={progress} size={26} stroke={3} color={color} />
        )}
      </div>
      <p className="mt-3 flex items-baseline gap-1">
        <span className="tabular text-[22px] leading-none font-bold tracking-tight">{value}</span>
        <span className="truncate text-[11.5px] font-medium text-muted">{unit}</span>
      </p>
      <p
        className={`mt-1 h-4 truncate text-[11px] font-semibold ${
          delta ? (delta.up ? 'text-brand-600' : 'text-secondary') : 'text-muted'
        }`}
      >
        {delta?.text ?? `${Math.round(Math.min(progress, 9.99) * 100)}% of goal`}
      </p>
      <MiniBars data={series} color={color} goal={goal} height={34} className="mt-2.5" />
    </Link>
  );
}

function BodyCard({
  weights,
  units,
  onboarded,
}: {
  weights: { date: string; kg: number }[];
  units: 'metric' | 'imperial';
  onboarded: boolean;
}) {
  const profile = useApp((s) => s.profile);
  if (!onboarded || !profile) return null;

  const latest = weights.length ? weights[weights.length - 1].kg : profile.startWeightKg;
  const u = weightUnit(units);
  const fmt = (kg: number) => kgToDisplay(kg, units).toFixed(1);
  const change = latest - profile.startWeightKg;
  const b = bmi(latest, profile.heightCm);
  const band = bmiBand(b);
  const trend = weeklyWeightTrend(weights.slice(-30));
  const target = profile.targetWeightKg;
  const eta = target ? weeksToGoal(latest, target, trend) : undefined;
  const goalProgress =
    target && target !== profile.startWeightKg
      ? Math.max(0, Math.min(1, (profile.startWeightKg - latest) / (profile.startWeightKg - target)))
      : undefined;
  const burnRest = Math.round(bmr(profile.sex, latest, profile.heightCm, age(profile)));
  const burnDay = Math.round(tdee(burnRest, profile.activity));

  return (
    <Link to="/trackers/weight" className="surface-card block p-4">
      <div className="flex items-center gap-2">
        <span className="tint-brand flex h-8 w-8 items-center justify-center rounded-xl">
          <IconScale width={17} height={17} />
        </span>
        <span className="flex-1 text-[13.5px] font-semibold">Body</span>
        <IconChevronRight width={18} height={18} className="text-muted" />
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <p className="flex items-baseline gap-1">
            <span className="tabular text-[30px] leading-none font-bold tracking-tight">{fmt(latest)}</span>
            <span className="text-[13px] font-semibold text-muted">{u}</span>
          </p>
          <p className="mt-1.5 text-[12px] font-semibold text-secondary">
            {Math.abs(change) < 0.05
              ? 'Same as your start'
              : `${change < 0 ? '▼' : '▲'} ${fmt(Math.abs(change))} ${u} since start`}
            {trend !== undefined && Math.abs(trend) >= 0.05 && (
              <span className="text-muted"> · {trend > 0 ? '+' : '−'}{fmt(Math.abs(trend))}/wk</span>
            )}
          </p>
        </div>
        <div className="w-[42%]">
          <Sparkline data={weights.slice(-30).map((w) => w.kg)} color="var(--color-ring-weight)" height={44} />
        </div>
      </div>

      {target && goalProgress !== undefined && (
        <div className="mt-4">
          <div className="mb-1.5 flex justify-between text-[11.5px] font-semibold">
            <span className="text-secondary">Goal {fmt(target)} {u}</span>
            <span className="text-muted">
              {eta ? `~${Math.ceil(eta)} wk at this pace` : `${Math.round(goalProgress * 100)}%`}
            </span>
          </div>
          <ProgressBar value={goalProgress} color="var(--color-ring-weight)" />
        </div>
      )}

      <div className="hairline mt-4 grid grid-cols-3 gap-3 border-t pt-3.5">
        <div>
          <p className="eyebrow">BMI</p>
          <p className="tabular text-[16px] font-bold">{b ? b.toFixed(1) : '—'}</p>
          <p className="text-[11px] font-semibold" style={{ color: band.color }}>
            {band.label}
          </p>
        </div>
        <div>
          <p className="eyebrow">At rest</p>
          <p className="tabular text-[16px] font-bold">{burnRest.toLocaleString()}</p>
          <p className="text-[11px] text-muted">kcal / day</p>
        </div>
        <div>
          <p className="eyebrow">Daily burn</p>
          <p className="tabular text-[16px] font-bold">{burnDay.toLocaleString()}</p>
          <p className="text-[11px] text-muted">with activity</p>
        </div>
      </div>
      {b > 0 && (
        <div className="relative mt-3 h-1.5 rounded-full bg-[linear-gradient(90deg,#3b82f6_0%,#3b82f6_17.5%,#10b981_17.5%,#10b981_50%,#f5a524_50%,#f5a524_75%,#ef4444_75%)] opacity-80">
          <span
            className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-[var(--surface-card)] bg-[var(--text-primary)] transition-[left] duration-700"
            style={{ left: `${bmiGaugePosition(b) * 100}%` }}
          />
        </div>
      )}
    </Link>
  );
}

function WeekSummary({
  week,
  target,
  sleepGoal,
}: {
  week: ReturnType<typeof useHistory>;
  target: number;
  sleepGoal: number;
}) {
  const stats = useMemo(() => {
    if (!week) return undefined;
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const logged = week.filter((d) => d.logged);
    const kcal = avg(logged.map((d) => d.kcal));
    const onTarget = logged.filter((d) => target > 0 && Math.abs(d.kcal / target - 1) <= 0.1).length;
    const sleeps = week.filter((d) => d.sleepMin > 0).map((d) => d.sleepMin);
    const steps = week.filter((d) => d.steps > 0).map((d) => d.steps);
    const water = week.filter((d) => d.glasses > 0).map((d) => d.glasses);
    const protein = avg(logged.map((d) => d.protein));
    return {
      loggedDays: logged.length,
      kcal,
      onTarget,
      sleep: avg(sleeps),
      sleepDebt: sleeps.reduce((s, m) => s + Math.max(0, sleepGoal - m), 0),
      steps: avg(steps),
      water: avg(water),
      protein,
      burned: week.reduce((s, d) => s + d.burned, 0),
      kcalSeries: week.map((d) => (d.logged ? d.kcal : null)),
    };
  }, [week, target, sleepGoal]);

  if (!stats) return <div className="skeleton h-56 rounded-[var(--radius-card)]" />;

  const cells: { label: string; value: string; sub?: string }[] = [
    {
      label: 'Avg intake',
      value: stats.kcal ? Math.round(stats.kcal).toLocaleString() : '—',
      sub: stats.kcal ? `kcal · target ${target.toLocaleString()}` : 'no meals logged',
    },
    {
      label: 'On target',
      value: `${stats.onTarget}/${stats.loggedDays || 0}`,
      sub: 'logged days within 10%',
    },
    {
      label: 'Avg protein',
      value: stats.protein ? `${Math.round(stats.protein)} g` : '—',
      sub: 'per logged day',
    },
    {
      label: 'Avg sleep',
      value: stats.sleep ? formatDuration(stats.sleep) : '—',
      sub: stats.sleepDebt > 0 ? `${formatDuration(stats.sleepDebt)} short this week` : 'no sleep debt',
    },
    {
      label: 'Avg steps',
      value: stats.steps ? Math.round(stats.steps).toLocaleString() : '—',
      sub: 'on days logged',
    },
    {
      label: 'Exercise',
      value: stats.burned ? `${stats.burned.toLocaleString()}` : '—',
      sub: 'kcal burned in total',
    },
  ];

  return (
    <div className="surface-card p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="eyebrow">7-day summary</p>
          <p className="text-[17px] font-bold tracking-tight">
            {stats.loggedDays === 0
              ? 'Start your week'
              : `${stats.loggedDays} of 7 days logged`}
          </p>
        </div>
        <Link to="/streaks" className="text-[12.5px] font-semibold text-brand-600">
          History
        </Link>
      </div>
      <div className="mt-3">
        <Sparkline data={stats.kcalSeries} color="var(--color-ring-calorie)" height={48} />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-x-3 gap-y-4">
        {cells.map((c) => (
          <div key={c.label} className="min-w-0">
            <p className="eyebrow truncate">{c.label}</p>
            <p className="tabular mt-0.5 truncate text-[17px] font-bold tracking-tight">{c.value}</p>
            {c.sub && <p className="truncate text-[11px] text-muted">{c.sub}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * One thumbnail in the snaps rail.
 *
 * The URL is minted in an effect keyed on the blob, not during render. Doing it
 * inline created a fresh object URL on *every* render, so any re-render — a
 * water tap, a live-query tick — reloaded the images and leaked the old URL.
 */
const SnapThumb = memo(function SnapThumb({ snap }: { snap: Snap }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    const u = URL.createObjectURL(snap.thumb);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [snap.thumb]);

  const kcal = snap.analysis?.totals.kcal;
  return (
    <Link
      to={snap.mealId ? `/meal/${snap.mealId}` : `/snap?id=${snap.id}`}
      className="relative h-28 w-24 shrink-0 snap-start overflow-hidden rounded-2xl bg-[var(--surface-sunken)]"
    >
      {url && (
        <img
          src={url}
          alt={snap.analysis?.title ?? 'Meal snap'}
          className="animate-fade-in h-full w-full object-cover"
        />
      )}
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pt-6 pb-1.5 text-[11px] font-bold text-white">
        {kcal ? `${Math.round(kcal)} kcal` : snap.status === 'failed' ? 'Not analysed' : ' '}
      </span>
      {snap.autoTracked && (
        <span className="absolute top-1.5 left-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[9px] font-bold text-white backdrop-blur">
          ✦ Auto
        </span>
      )}
    </Link>
  );
});

function MetabolismNote() {
  return (
    <p className="px-4 pt-2 pb-2 text-center text-[11px] leading-relaxed text-muted">
      Estimates use the Mifflin-St Jeor equation and your activity level. Not medical advice.
    </p>
  );
}
