import { memo, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/schema';
import { useApp } from '@/stores/useApp';
import { useDay, useStreak } from '@/stores/useDay';
import { TopBar } from '@/components/TopBar';
import { RingProgress } from '@/components/RingProgress';
import { CountUp } from '@/components/CountUp';
import { MacroBar } from '@/components/MacroBar';
import { TrackerTile, TrackerRow } from '@/components/TrackerTile';
import { MealPickerSheet } from '@/components/MealPickerSheet';
import { InsightCard } from '@/components/InsightCard';
import { Card } from '@/components/ui';
import {
  IconCameraPlus,
  IconChevronRight,
  IconClose,
  IconDroplet,
  IconFlame,
  IconGallery,
  IconLeaf,
  IconMoon,
  IconPlus,
  IconScale,
  IconSparkle,
  IconSteps,
  IconWarning,
} from '@/components/icons';
import { formatDuration, relativeDayLabel } from '@/lib/date';
import { backupOverdue, describeLastBackup } from '@/lib/backup';
import { formatKcal, kgToDisplay, weightUnit } from '@/lib/nutrition';
import { MICRO_IDS, microRows } from '@/lib/micros';
import { setWater } from '@/db/repo';
import type { MealSlot, Snap as SnapRow } from '@/types';

export default function Home() {
  const navigate = useNavigate();
  const { profile, settings, selectedDate, setPendingSlot, showToast } = useApp();
  const day = useDay();
  const streak = useStreak();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showAllTrackers, setShowAllTrackers] = useState(false);
  // Dismissal is per-session rather than stored: the nudge should come back
  // tomorrow if the backup still hasn't happened, but never twice in a sitting.
  const [backupDismissed, setBackupDismissed] = useState(false);

  const showBackupNudge =
    !backupDismissed && backupOverdue(settings, profile?.createdAt);

  const snaps = useLiveQuery(
    async () => db.snaps.orderBy('createdAt').reverse().limit(6).toArray(),
    [],
  );
  const latestWeight = useLiveQuery(async () => db.weight.orderBy('date').reverse().first(), []);

  const units = profile?.units ?? 'metric';
  // Macros answer "how much"; this answers "of what". Summarised to one line
  // here — the full breakdown lives on its own screen.
  const microsOnTrack = microRows(day.micros, day.microTargets).filter(
    (r) => r.status === 'good',
  ).length;
  const eaten = day.totals.kcal;
  const target = day.targets.kcal || 1;
  // What moving actually earns you. Home showed calories eaten against the
  // target and nothing else, so an hour in the gym changed no number on the
  // screen the user looks at most — and walking changed nothing anywhere.
  // Workouts plus steps; the workout tile below keeps its own figure, because
  // that one is measured against the workout goal.
  const burned = day.burnedKcal;
  const net = eaten - burned;
  const lostKg = profile ? profile.startWeightKg - (latestWeight?.kg ?? profile.startWeightKg) : 0;

  const openSlot = (slot: MealSlot) => {
    setPendingSlot(slot);
    setPickerOpen(false);
    navigate('/search');
  };

  async function addGlass() {
    await setWater(
      selectedDate,
      { glasses: day.glasses + 1 },
      profile?.waterGoalGlasses ?? 9,
    );
    showToast({
      message: `Water logged — ${day.glasses + 1} of ${day.waterGoal} glasses`,
      actionLabel: 'Undo',
      onAction: () =>
        setWater(selectedDate, { glasses: day.glasses }, profile?.waterGoalGlasses ?? 9),
    });
  }

  return (
    <>
      <TopBar streakDays={streak?.streak} />

      <div className="space-y-3 px-4 pt-1">
        {showBackupNudge && (
          <div className="accent-card accent-amber flex items-center gap-3 p-3.5">
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
              className="accent-pill shrink-0 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition-transform active:scale-95"
            >
              Back up
            </Link>
            <button
              type="button"
              onClick={() => setBackupDismissed(true)}
              aria-label="Dismiss backup reminder"
              className="accent-body shrink-0 rounded-lg p-1 transition-transform active:scale-90"
            >
              <IconClose width={15} height={15} />
            </button>
          </div>
        )}

        <InsightCard date={selectedDate} />

        {/* -------------------------- Track Food ------------------------- */}
        <Card className="space-y-3.5">
          <div className="flex items-center gap-3">
            <RingProgress
              // The ring tracks net intake, so it unwinds when you train.
              value={net / target}
              size={52}
              stroke={4}
              color="var(--color-ring-calorie)"
              label={
                burned > 0
                  ? `${formatKcal(net)} net of ${formatKcal(target)} calories, ${formatKcal(eaten)} eaten and ${formatKcal(burned)} burned`
                  : `${formatKcal(eaten)} of ${formatKcal(target)} calories`
              }
            >
              <IconFlame width={20} height={20} className="text-accent-500" />
            </RingProgress>

            <Link to="/diet" className="min-w-0 flex-1">
              <p className="text-[16px] font-bold tracking-tight">Track Food</p>
              <p className="tabular text-[13px] text-secondary">
                {eaten > 0 ? (
                  <>
                    <CountUp value={net} format={formatKcal} /> of {formatKcal(target)} Cal
                    Net
                  </>
                ) : (
                  `Eat ${formatKcal(target)} Cal`
                )}
              </p>
              {burned > 0 && (
                <p className="tabular text-[11.5px] text-muted">
                  {formatKcal(eaten)} eaten − {formatKcal(burned)} burned
                </p>
              )}
            </Link>

            <button
              type="button"
              onClick={() => navigate('/snap')}
              aria-label="Track with a photo"
              className="rounded-lg p-2 text-secondary transition-colors hover:text-brand-600"
            >
              <IconCameraPlus width={22} height={22} />
            </button>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              aria-label="Add food"
              className="flex h-8 w-8 items-center justify-center rounded-lg border-2 border-accent-500 text-accent-500 transition-transform active:scale-90"
            >
              <IconPlus width={17} height={17} strokeWidth={2.25} />
            </button>
          </div>

          <Link
            to="/snap/gallery"
            className="surface-sunken flex items-center gap-3 rounded-xl p-2.5 transition-colors hover:brightness-95"
          >
            <div className="tint-warm flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
              <IconGallery width={20} height={20} />
            </div>
            <p className="flex-1 text-[13px] leading-snug font-semibold">
              Browse all your past snaps
              <br />
              in one place
            </p>
            <IconChevronRight width={18} height={18} className="text-muted" />
          </Link>

          <div className="hairline grid grid-cols-2 gap-x-5 gap-y-3 border-t pt-3.5">
            <MacroBar
              label="Protein"
              value={day.totals.protein}
              target={day.targets.protein}
              color="var(--color-macro-protein)"
            />
            <MacroBar
              label="Fats"
              value={day.totals.fat}
              target={day.targets.fat}
              color="var(--color-macro-fat)"
            />
            <MacroBar
              label="Carbs"
              value={day.totals.carbs}
              target={day.targets.carbs}
              color="var(--color-macro-carb)"
            />
            <MacroBar
              label="Fibre"
              value={day.totals.fibre}
              target={day.targets.fibre}
              color="var(--color-macro-fibre)"
            />
          </div>

          <Link
            to={`/micros?date=${selectedDate}`}
            className="hairline flex items-center gap-3 border-t pt-3.5 transition-transform active:scale-[0.99]"
          >
            <div className="tint-soft tint-brand flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
              <IconLeaf width={18} height={18} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-semibold">Micronutrients</p>
              <p className="text-[12px] text-secondary">
                {day.meals.length === 0
                  ? `${MICRO_IDS.length} vitamins and minerals to hit today`
                  : `${microsOnTrack} of ${MICRO_IDS.length} on track${
                      day.microCoverage < 0.95
                        ? ` · ${Math.round(day.microCoverage * 100)}% of the day counted`
                        : ''
                    }`}
              </p>
            </div>
            <IconChevronRight width={18} height={18} className="shrink-0 text-muted" />
          </Link>
        </Card>

        {/* --------------------------- Snaps rail ------------------------ */}
        {snaps && snaps.length > 0 && (
          <div className="scroll-x no-scrollbar -mx-4 flex gap-2 px-4">
            {snaps.map((s) => (
              <SnapThumb key={s.id} snap={s} />
            ))}
          </div>
        )}

        {/* -------------------------- Your Trackers ---------------------- */}
        <div>
          <div className="mb-2 flex items-center justify-between px-0.5">
            <h2 className="text-[15px] font-bold tracking-tight">Your Trackers</h2>
            <button
              type="button"
              onClick={() => setShowAllTrackers((v) => !v)}
              className="text-[13px] font-semibold text-brand-600"
            >
              {showAllTrackers ? 'Show less' : 'Track More'}
            </button>
          </div>

          {showAllTrackers ? (
            <Card className="divide-y divide-[var(--surface-border)] py-0">
              <TrackerRow
                to="/trackers/weight"
                label="Weight"
                color="var(--color-ring-weight)"
                icon={<IconScale width={20} height={20} />}
                status={
                  latestWeight
                    ? lostKg > 0
                      ? `${Math.abs(kgToDisplay(lostKg, units)).toFixed(1)} ${weightUnit(units)} lost`
                      : `${kgToDisplay(latestWeight.kg, units).toFixed(1)} ${weightUnit(units)}`
                    : 'Set Up Weight Goal'
                }
              />
              <TrackerRow
                to="/trackers/workout"
                label="Workout"
                color="var(--color-ring-workout)"
                icon={<IconFlame width={20} height={20} />}
                status={
                  day.workoutKcal > 0
                    ? `${day.workoutKcal} of ${profile?.workoutKcalGoal ?? 300} cal burned`
                    : `Goal: ${profile?.workoutKcalGoal ?? 300} cal`
                }
              />
              <TrackerRow
                to="/trackers/steps"
                label="Steps"
                color="var(--color-ring-walk)"
                icon={<IconSteps width={20} height={20} />}
                status={
                  day.stepCount > 0
                    ? `${day.stepCount.toLocaleString()} of ${day.stepGoal.toLocaleString()}`
                    : 'Set Up Step Goal'
                }
              />
              <TrackerRow
                to="/trackers/sleep"
                label="Sleep"
                color="var(--color-ring-sleep)"
                icon={<IconMoon width={20} height={20} />}
                status={
                  day.sleep
                    ? formatDuration(day.sleep.durationMin)
                    : 'Set Up Sleep Goal'
                }
              />
              <TrackerRow
                to="/trackers/water"
                label="Water"
                color="var(--color-ring-water)"
                icon={<IconDroplet width={20} height={20} />}
                status={
                  day.glasses > 0
                    ? `${day.glasses} of ${day.waterGoal} glasses`
                    : `Goal: ${day.waterGoal} glasses`
                }
                onQuickAdd={addGlass}
              />
            </Card>
          ) : (
            <div className="grid grid-cols-5 gap-2">
              <TrackerTile
                to="/trackers/weight"
                label="Weight"
                color="var(--color-ring-weight)"
                icon={<IconScale width={17} height={17} />}
                // With no target weight there is nothing to be progressing
                // toward, so the ring stays empty rather than reading as
                // "goal met" — the caption carries the actual number.
                value={
                  profile?.targetWeightKg && latestWeight
                    ? clampProgress(
                        profile.startWeightKg,
                        latestWeight.kg,
                        profile.targetWeightKg,
                      )
                    : 0
                }
                caption={
                  latestWeight ? `${kgToDisplay(latestWeight.kg, units).toFixed(0)}` : '—'
                }
              />
              <TrackerTile
                to="/trackers/workout"
                label="Workout"
                color="var(--color-ring-workout)"
                icon={<IconFlame width={17} height={17} />}
                value={day.workoutKcal / (profile?.workoutKcalGoal || 300)}
                caption={`${day.workoutKcal}`}
              />
              <TrackerTile
                to="/trackers/steps"
                label="Walk"
                color="var(--color-ring-walk)"
                icon={<IconSteps width={17} height={17} />}
                value={day.stepCount / (day.stepGoal || 8000)}
                caption={day.stepCount ? `${(day.stepCount / 1000).toFixed(1)}k` : '—'}
              />
              <TrackerTile
                to="/trackers/sleep"
                label="Sleep"
                color="var(--color-ring-sleep)"
                icon={<IconMoon width={17} height={17} />}
                value={(day.sleep?.durationMin ?? 0) / (profile?.sleepGoalMin || 480)}
                caption={day.sleep ? formatDuration(day.sleep.durationMin) : '—'}
              />
              <TrackerTile
                to="/trackers/water"
                label="Hydrate"
                color="var(--color-ring-water)"
                icon={<IconDroplet width={17} height={17} />}
                value={day.glasses / (day.waterGoal || 9)}
                caption={`${day.glasses}/${day.waterGoal}`}
              />
            </div>
          )}
        </div>

        {/* ----------------------- AI plan / coach ----------------------- */}
        <Link
          to="/plans"
          className="accent-card flex items-center gap-3 p-3.5 transition-transform active:scale-[0.99]"
        >
          <IconSparkle width={20} height={20} className="accent-rule-fg shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="accent-title text-[14px] font-bold">Your AI Diet Plan is Ready!</p>
            <p className="accent-body text-[12px]">
              Built from your goal, targets and what you've logged
            </p>
          </div>
          <IconChevronRight width={18} height={18} className="accent-rule-fg shrink-0" />
        </Link>

        <p className="pb-2 text-center text-[11px] text-muted">
          Showing {relativeDayLabel(selectedDate)}
        </p>
      </div>

      {/* Floating coach button, mirroring the reference app's sparkle FAB */}
      <Link
        to="/coach"
        aria-label="Ask Ria, your AI coach"
        className="fixed right-4 bottom-[calc(5.5rem+var(--safe-bottom,0px))] z-30 flex h-13 w-13 items-center justify-center rounded-2xl bg-brand-500 text-white shadow-lg shadow-brand-500/30 transition-transform active:scale-95"
        style={{ height: '3.25rem', width: '3.25rem' }}
      >
        <IconSparkle width={24} height={24} />
      </Link>

      <MealPickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={openSlot}
        date={selectedDate}
      />
    </>
  );
}

/**
 * One thumbnail in the snaps rail.
 *
 * The URL is minted in an effect keyed on the blob, not during render. Doing it
 * inline created a fresh object URL on *every* render and revoked it in
 * `onLoad`, so any re-render — a water tap, a live-query tick — leaked the
 * previous one for the lifetime of the page.
 */
const SnapThumb = memo(function SnapThumb({ snap }: { snap: SnapRow }) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    const next = URL.createObjectURL(snap.thumb);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [snap.thumb]);

  return (
    <Link
      to={snap.mealId ? `/meal/${snap.mealId}` : `/snap?id=${snap.id}`}
      className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl"
    >
      {url && (
        <img
          src={url}
          alt={snap.analysis?.title ?? 'Meal snap'}
          className="h-full w-full object-cover"
        />
      )}
      {snap.autoTracked && (
        <span className="absolute top-1 left-1 rounded bg-black/55 px-1 py-0.5 text-[8.5px] font-bold text-white">
          ✦ Auto
        </span>
      )}
    </Link>
  );
});

/** Weight-goal ring: 0 at the starting weight, 1 at the target. */
function clampProgress(start: number, current: number, target: number): number {
  if (start === target) return 1;
  return Math.max(0, Math.min(1, (start - current) / (start - target)));
}
