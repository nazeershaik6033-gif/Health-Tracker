import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/schema';
import { useApp } from '@/stores/useApp';
import { workoutsForRange } from '@/db/repo';
import { explainExercise } from '@/ai/service';
import { hasKey } from '@/ai/registry';
import { describeError } from '@/ai/types';
import { historyFor, recordsByExercise } from '@/lib/exerciseStats';
import { addDays, today } from '@/lib/date';
import { TrendChart } from '@/components/TrendChart';
import { AIBadge, Button, Card, PageHeader, SectionTitle, Skeleton } from '@/components/ui';
import { IconSparkle } from '@/components/icons';
import { EQUIPMENT_LABEL, MUSCLE_LABEL, type WorkoutEntry } from '@/types';

/** One exercise: what it works, what you've done, and how to do it well. */
export default function ExerciseDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { settings } = useApp();

  const exercise = useLiveQuery(() => db.exercises.get(id), [id]);
  const workouts = useLiveQuery(
    () => workoutsForRange(addDays(today(), -365), today()),
    [],
    [] as WorkoutEntry[],
  );

  const [tips, setTips] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const keyed = hasKey(settings);

  const record = useMemo(
    () => recordsByExercise(workouts ?? []).get(id),
    [workouts, id],
  );
  const history = useMemo(() => historyFor(workouts ?? [], id), [workouts, id]);

  // Volume is the meaningful strength trend; cardio has no load, so it charts
  // duration instead.
  const isStrength = exercise?.kind === 'strength';
  const chart = history.map((h) => ({
    date: h.date,
    value: isStrength ? h.volumeKg : h.durationMin,
  }));

  async function loadTips() {
    if (!exercise || !keyed || busy) return;
    setBusy(true);
    setError('');
    try {
      setTips(await explainExercise(settings, exercise.name));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  if (exercise === undefined) {
    return (
      <div className="pb-6">
        <PageHeader title="Exercise" back={() => navigate(-1)} />
        <div className="space-y-3 px-4 pt-3">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!exercise) {
    return (
      <div className="pb-6">
        <PageHeader title="Exercise" back={() => navigate(-1)} />
        <Card className="mx-4 mt-3">
          <p className="text-[13.5px] text-secondary">
            This exercise is no longer in your catalog. Any sessions you logged with it are
            unaffected.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="pb-6">
      <PageHeader title={exercise.name} back={() => navigate(-1)} />

      <div className="space-y-3 px-4 pt-3">
        <Card className="space-y-1">
          <p className="text-[13px] text-secondary">
            {exercise.muscles.map((m) => MUSCLE_LABEL[m]).join(', ') || 'Custom exercise'} ·{' '}
            {EQUIPMENT_LABEL[exercise.equipment]}
          </p>
          <p className="text-[12px] text-muted">
            {exercise.kind} · MET {exercise.met}
            {exercise.source === 'seed' ? '' : ' · your exercise'}
          </p>
        </Card>

        {record ? (
          <Card className="space-y-2">
            <SectionTitle>Personal records</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              {record.bestWeightKg > 0 && (
                <Stat label="Heaviest set" value={`${record.bestWeightKg} kg`} sub={`× ${record.bestWeightReps}`} />
              )}
              {record.best1RM > 0 && (
                <Stat label="Est. 1RM" value={`${record.best1RM} kg`} sub="Epley" />
              )}
              {record.bestReps > 0 && record.bestWeightKg === 0 && (
                <Stat label="Most reps" value={String(record.bestReps)} sub="in one set" />
              )}
              {record.bestSessionVolumeKg > 0 && (
                <Stat
                  label="Best volume"
                  value={`${record.bestSessionVolumeKg.toLocaleString()} kg`}
                  sub="one session"
                />
              )}
              {record.bestDurationMin > 0 && (
                <Stat label="Longest" value={`${Math.round(record.bestDurationMin)} min`} sub="single bout" />
              )}
              <Stat label="Sessions" value={String(record.sessions)} sub="last 12 months" />
            </div>
          </Card>
        ) : (
          <Card>
            <p className="text-[13.5px] text-secondary">
              You haven&apos;t logged this one yet. Records and a trend appear here once you do.
            </p>
          </Card>
        )}

        {chart.length > 1 && (
          <Card>
            <SectionTitle>{isStrength ? 'Volume per session' : 'Duration per session'}</SectionTitle>
            <TrendChart
              data={chart}
              color="var(--color-ring-workout)"
              unit={isStrength ? ' kg' : ' min'}
            />
          </Card>
        )}

        <Card className="space-y-2">
          <SectionTitle action={keyed && tips ? <AIBadge /> : undefined}>How to do it</SectionTitle>
          {tips ? (
            <p className="text-[13px] leading-relaxed whitespace-pre-line text-secondary">{tips}</p>
          ) : (
            <>
              <p className="text-[13px] leading-relaxed text-secondary">
                {keyed
                  ? 'Ria can talk you through the setup, the common faults and how to scale this movement.'
                  : 'Form tips need an AI key. Everything else on this screen — records, history and the trend — works without one.'}
              </p>
              {keyed ? (
                <Button variant="secondary" onClick={loadTips} disabled={busy}>
                  <IconSparkle width={15} height={15} />
                  {busy ? 'Asking Ria…' : 'Get form tips'}
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => navigate('/settings')}>
                  Add a key in Settings
                </Button>
              )}
            </>
          )}
          {error && <p className="text-[12px] text-red-600">{error}</p>}
          {tips && (
            <p className="text-[11px] text-muted">
              Generated advice, not coaching. Stop if something hurts.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="surface-sunken rounded-xl p-3">
      <p className="text-[11px] text-muted">{label}</p>
      <p className="tabular text-[17px] font-bold">{value}</p>
      {sub && <p className="text-[11px] text-muted">{sub}</p>}
    </div>
  );
}
