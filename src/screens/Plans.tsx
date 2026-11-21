import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/stores/useApp';
import { allFoods, dayBundle, latestPlan, logPlannedMeals, savePlan, updatePlan } from '@/db/repo';
import { dayContext, generateDietPlan, generateWorkoutPlan } from '@/ai/service';
import { hasKey } from '@/ai/registry';
import { describeError } from '@/ai/types';
import { buildDietPlan, describeItems, plannerContext, shoppingList, swapMeal } from '@/lib/dietPlanner';
import { daysBetween, relativeDayLabel, toISODate, today } from '@/lib/date';
import { HAPTIC, haptic } from '@/lib/motion';
import { AIBadge, Button, Card, Chip, EmptyState, Skeleton } from '@/components/ui';
import {
  IconCheck,
  IconChevronDown,
  IconDumbbell,
  IconPlans,
  IconPlus,
  IconRefresh,
  IconSparkle,
} from '@/components/icons';
import {
  DEFAULT_DIET_PREFS,
  DIET_FOCUS_LABEL,
  DIET_TYPE_LABEL,
  MEAL_SLOT_LABEL,
  type DietFocus,
  type DietPrefs,
  type DietType,
  type Plan,
  type PlanDay,
} from '@/types';

type Tab = 'diet' | 'workout';

const DIETS = Object.keys(DIET_TYPE_LABEL) as DietType[];
const FOCUSES = Object.keys(DIET_FOCUS_LABEL) as DietFocus[];

const parseAvoid = (text: string) =>
  text
    .split(/[,;\n]/)
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 12);

export default function Plans() {
  const navigate = useNavigate();
  const { profile, settings, setSettings, selectedDate, showToast } = useApp();
  const keyed = hasKey(settings);

  const [tab, setTab] = useState<Tab>('diet');
  const [plans, setPlans] = useState<Record<Tab, Plan | null | undefined>>({
    diet: undefined,
    workout: undefined,
  });
  const [busy, setBusy] = useState<'' | 'local' | 'ai'>('');
  const [error, setError] = useState('');
  const [prefs, setPrefs] = useState<DietPrefs>(() => ({ ...DEFAULT_DIET_PREFS, ...settings.dietPrefs }));
  const [avoidText, setAvoidText] = useState(() => prefs.avoid.join(', '));
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [logged, setLogged] = useState<Set<string>>(new Set());

  useEffect(() => {
    void (async () => {
      const [diet, workout] = await Promise.all([latestPlan('diet'), latestPlan('workout')]);
      setPlans({ diet: diet ?? null, workout: workout ?? null });
      if (!diet) setPrefsOpen(true);
    })();
  }, []);

  const plan = plans[tab];
  const targets = profile?.targets;

  function currentPrefs(): DietPrefs {
    return { ...prefs, avoid: parseAvoid(avoidText) };
  }

  async function buildDiet(source: 'local' | 'ai') {
    if (busy || !targets) return;
    const chosen = currentPrefs();
    setBusy(source);
    setError('');
    try {
      await setSettings({ dietPrefs: chosen });
      const foods = await allFoods();
      let built: { title: string; summary: string; days: PlanDay[] };
      if (source === 'ai') {
        const context = dayContext(await dayBundle(selectedDate, profile), profile);
        built = await generateDietPlan(settings, context, chosen, foods);
      } else {
        built = buildDietPlan(plannerContext(targets, chosen, foods));
        if (!built.days.some((d) => d.meals.length)) {
          throw new Error('Nothing in the food database fits those choices. Try removing some foods to avoid.');
        }
      }
      const saved = await savePlan({ kind: 'diet', source, prefs: chosen, ...built });
      setPlans((p) => ({ ...p, diet: saved }));
      setLogged(new Set());
      setPrefsOpen(false);
      haptic(HAPTIC.success);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy('');
    }
  }

  async function buildWorkout() {
    if (!keyed || busy) return;
    setBusy('ai');
    setError('');
    try {
      const context = dayContext(await dayBundle(selectedDate, profile), profile);
      const saved = await savePlan({ kind: 'workout', days: [], source: 'ai', ...(await generateWorkoutPlan(settings, context)) });
      setPlans((p) => ({ ...p, workout: saved }));
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy('');
    }
  }

  async function logMeals(dayIndex: number, mealIndexes: number[]) {
    const day = plan?.days[dayIndex];
    if (!day) return;
    const meals = mealIndexes.map((i) => day.meals[i]).filter((m) => m?.items?.length);
    if (!meals.length) return;
    haptic(HAPTIC.success);
    const undo = await logPlannedMeals(selectedDate, meals);
    const keys = mealIndexes.map((i) => `${dayIndex}:${i}`);
    setLogged((prev) => new Set([...prev, ...keys]));
    const when = relativeDayLabel(selectedDate);
    showToast({
      message:
        meals.length === 1
          ? `${MEAL_SLOT_LABEL[meals[0].slot]} logged to ${when}`
          : `${meals.length} meals logged to ${when}`,
      actionLabel: 'Undo',
      onAction: async () => {
        await undo();
        setLogged((prev) => new Set([...prev].filter((k) => !keys.includes(k))));
      },
    });
  }

  async function swap(dayIndex: number, mealIndex: number) {
    if (!plan || !targets) return;
    const ctx = plannerContext(targets, plan.prefs ?? currentPrefs(), await allFoods());
    const day = plan.days[dayIndex];
    const next = swapMeal(ctx, day, mealIndex, Date.now());
    if (!next) {
      showToast({ message: 'No other meal fits this slot with those choices.', tone: 'warn' });
      return;
    }
    haptic(HAPTIC.tap);
    const days = plan.days.map((d, i) =>
      i === dayIndex ? { ...d, meals: d.meals.map((m, j) => (j === mealIndex ? next : m)) } : d,
    );
    await updatePlan(plan.id, { days });
    setPlans((p) => ({ ...p, diet: { ...plan, days } }));
    setLogged((prev) => {
      const copy = new Set(prev);
      copy.delete(`${dayIndex}:${mealIndex}`);
      return copy;
    });
  }

  // Which plan day is "today": day 1 is the day it was made, cycling after.
  const todayIndex = plan?.days.length
    ? ((daysBetween(toISODate(new Date(plan.createdAt)), today()) % plan.days.length) + plan.days.length) %
      plan.days.length
    : -1;

  return (
    <div className="px-4 pt-safe pb-6">
      <div className="flex items-center justify-between py-3">
        <h1 className="text-[22px] font-extrabold tracking-tight">Plans</h1>
        {tab === 'workout' && plan && keyed && (
          <button
            type="button"
            onClick={() => void buildWorkout()}
            disabled={Boolean(busy)}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] font-semibold text-brand-600 disabled:opacity-50"
          >
            <IconRefresh width={14} height={14} className={busy ? 'animate-spin' : ''} />
            Regenerate
          </button>
        )}
      </div>

      <div className="surface-sunken mb-4 flex gap-1 rounded-xl p-1">
        {(['diet', 'workout'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 rounded-lg py-2 text-[13px] font-semibold transition-colors ${
              tab === t ? 'bg-[var(--surface-card)] shadow-sm' : 'text-secondary'
            }`}
          >
            {t === 'diet' ? 'Diet' : 'Workout'}
          </button>
        ))}
      </div>

      {tab === 'diet' ? (
        <div className="space-y-3">
          <PrefsCard
            open={prefsOpen || !plan}
            onToggle={() => setPrefsOpen((v) => !v)}
            collapsible={Boolean(plan)}
            prefs={prefs}
            setPrefs={setPrefs}
            avoidText={avoidText}
            setAvoidText={setAvoidText}
            busy={busy}
            keyed={keyed}
            hasTargets={Boolean(targets)}
            onBuild={(source) => void buildDiet(source)}
          />

          {error && <p className="text-center text-[12.5px] text-red-600">{error}</p>}

          {plan === undefined ? (
            <Skeleton className="h-40 rounded-2xl" />
          ) : busy && !plan ? (
            <Card className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 rounded-xl" />
              ))}
            </Card>
          ) : plan ? (
            <DietPlanView
              plan={plan}
              targets={targets}
              todayIndex={todayIndex}
              logged={logged}
              onLog={(d, idx) => void logMeals(d, idx)}
              onSwap={(d, i) => void swap(d, i)}
            />
          ) : null}
        </div>
      ) : !keyed ? (
        <EmptyState
          icon={<IconSparkle width={22} height={22} />}
          title="Workout plans are AI-generated"
          body="Add an API key and Ria will build a week of training from your goal and what you actually log."
          action={<Button onClick={() => navigate('/settings')}>Open Settings</Button>}
        />
      ) : busy && !plan ? (
        <Card className="space-y-3">
          <div className="flex items-center gap-2">
            <IconSparkle width={16} height={16} className="animate-pulse text-brand-600" />
            <p className="text-[14px] font-bold">Building your plan…</p>
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-xl" />
          ))}
        </Card>
      ) : plan === undefined ? (
        <Skeleton className="h-40 rounded-2xl" />
      ) : plan === null ? (
        <EmptyState
          icon={<IconDumbbell width={22} height={22} />}
          title="No workout plan yet"
          body="Ria will build a week of training matched to your goal and current activity level."
          action={
            <Button onClick={() => void buildWorkout()} disabled={Boolean(busy)}>
              <IconSparkle width={16} height={16} />
              {busy ? 'Building…' : 'Generate a plan'}
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          <Card>
            <h2 className="text-[16px] font-bold tracking-tight">{plan.title}</h2>
            {plan.summary && <p className="mt-1.5 text-[13px] leading-relaxed text-secondary">{plan.summary}</p>}
          </Card>
          {(plan.workouts ?? []).map((w, i) => (
            <Card key={`${w.day}-${i}`} className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-ring-workout)]/12 text-[var(--color-ring-workout)]">
                <IconDumbbell width={19} height={19} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[14px] font-bold">{w.day}</p>
                  <span className="tabular shrink-0 text-[12px] text-secondary">{w.minutes} min</span>
                </div>
                <p className="text-[12.5px] font-semibold text-brand-600">{w.focus}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-secondary">{w.detail}</p>
              </div>
            </Card>
          ))}
        </div>
      )}

      {tab === 'workout' && error && <p className="mt-3 text-center text-[12.5px] text-red-600">{error}</p>}

      <p className="mt-4 px-1 text-center text-[11px] text-muted">
        A plan is a starting point, not a prescription. Adjust it to how you actually eat and train.
      </p>
    </div>
  );
}

function PrefsCard({
  open,
  onToggle,
  collapsible,
  prefs,
  setPrefs,
  avoidText,
  setAvoidText,
  busy,
  keyed,
  hasTargets,
  onBuild,
}: {
  open: boolean;
  onToggle: () => void;
  collapsible: boolean;
  prefs: DietPrefs;
  setPrefs: (p: DietPrefs) => void;
  avoidText: string;
  setAvoidText: (t: string) => void;
  busy: '' | 'local' | 'ai';
  keyed: boolean;
  hasTargets: boolean;
  onBuild: (source: 'local' | 'ai') => void;
}) {
  return (
    <Card>
      <button
        type="button"
        onClick={collapsible ? onToggle : undefined}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={open}
      >
        <span className="tint-brand flex h-8 w-8 items-center justify-center rounded-xl">
          <IconPlans width={17} height={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-bold">{collapsible ? 'New diet plan' : 'Build a diet plan'}</span>
          <span className="block truncate text-[12px] text-secondary">
            {DIET_TYPE_LABEL[prefs.diet]} · {DIET_FOCUS_LABEL[prefs.focus]} · {prefs.days} days
          </span>
        </span>
        {collapsible && (
          <IconChevronDown width={18} height={18} className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
        )}
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          <div>
            <p className="eyebrow mb-1.5">Diet</p>
            <div className="flex flex-wrap gap-2">
              {DIETS.map((d) => (
                <Chip key={d} active={prefs.diet === d} onClick={() => setPrefs({ ...prefs, diet: d })}>
                  {DIET_TYPE_LABEL[d]}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <p className="eyebrow mb-1.5">Focus</p>
            <div className="flex flex-wrap gap-2">
              {FOCUSES.map((f) => (
                <Chip key={f} active={prefs.focus === f} onClick={() => setPrefs({ ...prefs, focus: f })}>
                  {DIET_FOCUS_LABEL[f]}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <p className="eyebrow mb-1.5">Length</p>
            <div className="flex gap-2">
              {[3, 7].map((n) => (
                <Chip key={n} active={prefs.days === n} onClick={() => setPrefs({ ...prefs, days: n })}>
                  {n === 7 ? 'A week' : `${n} days`}
                </Chip>
              ))}
            </div>
          </div>
          <label className="block">
            <span className="eyebrow">Leave out</span>
            <input
              value={avoidText}
              onChange={(e) => setAvoidText(e.target.value)}
              placeholder="e.g. peanuts, paneer, mutton"
              className="hairline mt-1.5 block w-full rounded-xl border bg-transparent px-3 py-2.5 text-[14px]"
            />
          </label>

          {!hasTargets && (
            <p className="text-[12.5px] text-secondary">Finish your profile so plans can be sized to your targets.</p>
          )}
          <div className="flex gap-2">
            <Button full onClick={() => onBuild('local')} disabled={Boolean(busy) || !hasTargets}>
              <IconPlans width={16} height={16} />
              {busy === 'local' ? 'Building…' : 'Build plan'}
            </Button>
            {keyed && (
              <Button variant="secondary" full onClick={() => onBuild('ai')} disabled={Boolean(busy) || !hasTargets}>
                <IconSparkle width={16} height={16} />
                {busy === 'ai' ? 'Asking Ria…' : 'Ask Ria'}
              </Button>
            )}
          </div>
          <p className="text-[11.5px] text-muted">
            {keyed
              ? 'Build plan works offline from the food database. Ria reads your log and can suggest dishes outside it.'
              : 'Built offline from the food database. Add an AI key in Settings to have Ria tailor one to your log.'}
          </p>
        </div>
      )}
    </Card>
  );
}

function DietPlanView({
  plan,
  targets,
  todayIndex,
  logged,
  onLog,
  onSwap,
}: {
  plan: Plan;
  targets?: { kcal: number; protein: number };
  todayIndex: number;
  logged: Set<string>;
  onLog: (day: number, meals: number[]) => void;
  onSwap: (day: number, meal: number) => void;
}) {
  const [showList, setShowList] = useState(false);
  const list = useMemo(() => shoppingList(plan.days), [plan.days]);

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex items-start gap-2">
          <h2 className="min-w-0 flex-1 text-[16px] font-bold tracking-tight">{plan.title}</h2>
          {plan.source !== 'local' && <AIBadge label="Ria" />}
        </div>
        {plan.summary && <p className="mt-1.5 text-[13px] leading-relaxed text-secondary">{plan.summary}</p>}
      </Card>

      {plan.days.map((day, d) => {
        const kcal = Math.round(day.meals.reduce((s, m) => s + m.kcal, 0));
        const protein = Math.round(day.meals.reduce((s, m) => s + (m.protein ?? 0), 0));
        const loggable = day.meals.map((m, i) => (m.items?.length ? i : -1)).filter((i) => i >= 0);
        const pending = loggable.filter((i) => !logged.has(`${d}:${i}`));
        return (
          <Card key={`${day.label}-${d}`} className="py-3">
            <div className="flex items-center gap-2 px-1">
              <h3 className="text-[14px] font-bold">{day.label}</h3>
              {d === todayIndex && (
                <span className="tint-soft tint-brand rounded-md px-1.5 py-0.5 text-[10.5px] font-bold">Today</span>
              )}
              <span className="tabular ml-auto text-[12px] font-semibold text-secondary">
                {kcal.toLocaleString()} Cal{protein ? ` · ${protein} g protein` : ''}
              </span>
            </div>
            {targets && (
              <p className="tabular px-1 text-[11px] text-muted">
                {Math.round((kcal / targets.kcal) * 100)}% of calories
                {protein ? ` · ${Math.round((protein / targets.protein) * 100)}% of protein` : ''}
              </p>
            )}
            <ul className="mt-1">
              {day.meals.map((meal, i) => {
                const key = `${d}:${i}`;
                const done = logged.has(key);
                const name = meal.items?.length ? meal.name : undefined;
                return (
                  <li key={`${meal.slot}-${i}`} className="border-t border-[var(--surface-border)] px-1 py-2.5">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-bold tracking-wide text-brand-600 uppercase">
                          {MEAL_SLOT_LABEL[meal.slot]}
                        </p>
                        {name ? (
                          <>
                            <p className="mt-0.5 text-[13.5px] leading-snug font-semibold">{name}</p>
                            <p className="mt-0.5 text-[12px] leading-snug text-secondary">{describeItems(meal.items!)}</p>
                          </>
                        ) : (
                          <p className="mt-0.5 text-[13.5px] leading-snug">{meal.suggestion}</p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="tabular text-[12.5px] font-semibold text-secondary">{Math.round(meal.kcal)} Cal</p>
                        {meal.protein !== undefined && (
                          <p className="tabular text-[11px] text-muted">{Math.round(meal.protein)} g P</p>
                        )}
                      </div>
                    </div>
                    {meal.items?.length ? (
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => onLog(d, [i])}
                          disabled={done}
                          className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold ${
                            done ? 'tint-soft tint-brand' : 'surface-sunken'
                          }`}
                        >
                          {done ? <IconCheck width={13} height={13} /> : <IconPlus width={13} height={13} />}
                          {done ? 'Logged' : 'Log'}
                        </button>
                        <button
                          type="button"
                          onClick={() => onSwap(d, i)}
                          className="surface-sunken flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold"
                        >
                          <IconRefresh width={13} height={13} />
                          Swap
                        </button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {pending.length > 1 && (
              <div className="border-t border-[var(--surface-border)] px-1 pt-2.5">
                <Button size="sm" variant="secondary" full onClick={() => onLog(d, pending)}>
                  Log the rest of {day.label}
                </Button>
              </div>
            )}
          </Card>
        );
      })}

      {list.length > 0 && (
        <Card>
          <button
            type="button"
            onClick={() => setShowList((v) => !v)}
            className="flex w-full items-center justify-between text-left"
            aria-expanded={showList}
          >
            <span className="text-[14px] font-bold">Grocery list · {list.length} items</span>
            <IconChevronDown width={18} height={18} className={`text-muted transition-transform ${showList ? 'rotate-180' : ''}`} />
          </button>
          {showList && (
            <>
              <ul className="mt-2">
                {list.map((line) => (
                  <li
                    key={line.key}
                    className="flex items-baseline justify-between gap-3 border-t border-[var(--surface-border)] py-2 text-[13px]"
                  >
                    <span className="min-w-0 truncate">{line.name}</span>
                    <span className="tabular shrink-0 text-secondary">{line.portion}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[11px] text-muted">
                Amounts are as eaten, for the whole plan — cooked rice and dal, not raw.
              </p>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
