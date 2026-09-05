import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/schema';
import { useApp } from '@/stores/useApp';
import { useDay } from '@/stores/useDay';
import { MicroBar } from '@/components/MicroBar';
import { RingProgress } from '@/components/RingProgress';
import { Card, EmptyState, PageHeader, SectionTitle } from '@/components/ui';
import { IconLeaf, IconWarning } from '@/components/icons';
import { relativeDayLabel } from '@/lib/date';
import {
  biggestGaps,
  contributors,
  formatMicro,
  microRows,
  suggestFoods,
  type MicroGroup,
  type MicroRow,
} from '@/lib/micros';
import type { Food, MicroId } from '@/types';

/**
 * The day's micronutrients.
 *
 * The hard part is not the arithmetic, it is honesty. Micronutrient data is
 * patchy everywhere — a barcode may declare calcium and nothing else, a photo
 * analysis declares none at all — so a bare "42% of your iron" is a claim the
 * data cannot support. Everything here is framed against coverage: what share
 * of the day's calories the figures actually saw, and which items they missed.
 */
export default function Micros() {
  const navigate = useNavigate();
  const { selectedDate } = useApp();
  const day = useDay();
  const [open, setOpen] = useState<MicroId | null>(null);

  const rows = useMemo(
    () => microRows(day.micros, day.microTargets),
    [day.micros, day.microTargets],
  );
  const gaps = useMemo(() => biggestGaps(rows), [rows]);
  const onTrack = rows.filter((r) => r.status === 'good').length;
  const coveragePct = Math.round(day.microCoverage * 100);

  // The whole catalog, for "what would close this gap". Cheap: a few hundred
  // rows, and Dexie keeps it live so a food added mid-session appears here.
  const foods = useLiveQuery(async () => db.foods.toArray(), []);

  const logged = day.meals.length > 0;

  return (
    <>
      <PageHeader title="Micronutrients" subtitle={relativeDayLabel(selectedDate)} back="/" />

      <div className="px-4 pt-3 pb-6">
      {!logged ? (
        <EmptyState
          icon={<IconLeaf width={22} height={22} />}
          title="Nothing logged for this day"
          body="Micronutrients are counted from what you eat. Log a meal and the vitamins and minerals appear here."
        />
      ) : (
        <div className="space-y-3">
          {/* ---------------------------- summary --------------------------- */}
          <Card className="space-y-3.5">
            <div className="flex items-center gap-3">
              <RingProgress
                value={onTrack / rows.length}
                size={52}
                stroke={4}
                color="var(--color-macro-fibre)"
                label={`${onTrack} of ${rows.length} micronutrients on track`}
              >
                <div className="text-center leading-none">
                  <p className="tabular text-[13px] font-extrabold">{onTrack}</p>
                  <p className="text-[8px] text-muted">of {rows.length}</p>
                </div>
              </RingProgress>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-bold tracking-tight">
                  {onTrack === rows.length
                    ? 'Every micro on track'
                    : `${rows.length - onTrack} still short today`}
                </p>
                <p className="text-[12.5px] text-secondary">
                  Targets are ICMR-NIN 2020 for your age and sex.
                </p>
              </div>
            </div>

            <CoverageNote
              pct={coveragePct}
              unknown={day.microUnknown.map((i) => i.name)}
            />
          </Card>

          {/* ----------------------------- gaps ----------------------------- */}
          {gaps.length > 0 && foods && (
            <Card className="space-y-3">
              <SectionTitle>Close today&apos;s gaps</SectionTitle>
              {gaps.map((row) => {
                const picks = suggestFoods(foods, row.def.id, row.target, 3).filter(
                  // Suggesting more of something already eaten today is advice
                  // they have already taken.
                  (p) => !day.meals.some((m) => m.items.some((i) => i.foodId === p.foodId)),
                );
                return (
                  <div key={row.def.id}>
                    <p className="text-[13px] font-semibold">
                      {row.def.label}
                      <span className="ml-1.5 font-normal text-secondary">
                        {formatMicro(row.def.id, Math.max(0, row.target - row.value))} to go
                      </span>
                    </p>
                    {picks.length ? (
                      <div className="no-scrollbar -mx-1 mt-1.5 flex gap-1.5 overflow-x-auto px-1">
                        {picks.map((p) => (
                          <button
                            key={p.foodId}
                            type="button"
                            onClick={() => navigate(`/search?q=${encodeURIComponent(p.name)}`)}
                            className="surface-sunken shrink-0 rounded-lg px-2.5 py-1.5 text-left transition-transform active:scale-95"
                          >
                            <span className="block text-[12.5px] font-semibold">{p.name}</span>
                            <span className="block text-[11px] text-secondary">
                              {p.servingLabel} · {Math.round(p.share * 100)}% of the day
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-1 text-[12px] text-muted">
                        Nothing in your food list is a strong source — worth adding one.
                      </p>
                    )}
                  </div>
                );
              })}
            </Card>
          )}

          {/* --------------------------- the nutrients ---------------------- */}
          <MicroGroupCard
            title="Vitamins"
            group="vitamin"
            rows={rows}
            open={open}
            onToggle={(id) => setOpen((cur) => (cur === id ? null : id))}
            day={day}
            foods={foods}
          />
          <MicroGroupCard
            title="Minerals"
            group="mineral"
            rows={rows}
            open={open}
            onToggle={(id) => setOpen((cur) => (cur === id ? null : id))}
            day={day}
            foods={foods}
          />

          <p className="px-1 text-center text-[11px] leading-relaxed text-muted">
            Reference intakes are for a healthy adult and are not medical advice. Supplements,
            pregnancy and diagnosed deficiencies all change these numbers — a doctor or dietitian
            should set them, not an app.
          </p>
        </div>
      )}
      </div>
    </>
  );
}

/* -------------------------------- coverage -------------------------------- */

/**
 * Says out loud how much of the day these numbers are built on.
 *
 * Without this the screen would read as a complete picture of the day, when a
 * photo-logged lunch contributes nothing to it. Under-reporting a nutrient as
 * "low" when the data is simply absent is the failure worth designing against.
 */
function CoverageNote({ pct, unknown }: { pct: number; unknown: string[] }) {
  if (pct >= 95) {
    return (
      <p className="hairline border-t pt-3 text-[12px] text-secondary">
        Counted across everything you logged today.
      </p>
    );
  }

  const names = [...new Set(unknown)];
  return (
    <div className="accent-card accent-amber flex items-start gap-2.5 p-3">
      <IconWarning width={16} height={16} className="accent-rule-fg mt-0.5 shrink-0" />
      <div className="min-w-0">
        <p className="accent-title text-[12.5px] font-bold">
          Based on {pct}% of today&apos;s calories
        </p>
        <p className="accent-body text-[11.5px] leading-relaxed">
          {names.length > 0 && (
            <>
              No micronutrient data for {names.slice(0, 3).join(', ')}
              {names.length > 3 && ` and ${names.length - 3} more`}.{' '}
            </>
          )}
          Treat every figure below as a floor — you have had at least this much.
        </p>
      </div>
    </div>
  );
}

/* --------------------------------- groups --------------------------------- */

function MicroGroupCard({
  title,
  group,
  rows,
  open,
  onToggle,
  day,
  foods,
}: {
  title: string;
  group: MicroGroup;
  rows: MicroRow[];
  open: MicroId | null;
  onToggle: (id: MicroId) => void;
  day: ReturnType<typeof useDay>;
  foods: Food[] | undefined;
}) {
  const shown = rows.filter((r) => r.def.group === group);

  return (
    <Card className="py-2">
      <div className="px-1 pt-1 pb-0.5">
        <SectionTitle>{title}</SectionTitle>
      </div>
      <ul className="divide-y divide-[var(--surface-border)]">
        {shown.map((row) => (
          <li key={row.def.id}>
            <MicroBar
              row={row}
              expanded={open === row.def.id}
              onToggle={() => onToggle(row.def.id)}
            />
            {open === row.def.id && (
              <MicroDetail row={row} day={day} foods={foods} />
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function MicroDetail({
  row,
  day,
  foods,
}: {
  row: MicroRow;
  day: ReturnType<typeof useDay>;
  foods: Food[] | undefined;
}) {
  const navigate = useNavigate();
  const from = contributors(day.meals, row.def.id);
  const picks =
    foods && row.status !== 'good' ? suggestFoods(foods, row.def.id, row.target, 3) : [];

  return (
    <div className="space-y-2.5 px-1 pb-3">
      <p className="text-[12px] leading-relaxed text-secondary">{row.def.why}</p>

      {from.length > 0 ? (
        <div>
          <p className="text-[11.5px] font-semibold text-muted uppercase">Where it came from</p>
          <ul className="mt-1 space-y-1">
            {from.map((c) => (
              <li key={c.name} className="flex items-baseline gap-2 text-[12.5px]">
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="tabular shrink-0 text-secondary">
                  {formatMicro(row.def.id, c.amount)}
                </span>
                <span className="tabular w-9 shrink-0 text-right text-muted">
                  {Math.round(c.share * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-[12px] text-muted">
          Nothing you logged today carries {row.def.label.toLowerCase()}.
        </p>
      )}

      {row.def.limit && row.status === 'over' && (
        <p className="text-[12px] leading-relaxed text-secondary">
          Salt added at the table, pickles, papad and packaged snacks are usually where the
          difference sits — the cooking itself is rarely the whole story.
        </p>
      )}

      {picks.length > 0 && (
        <div>
          <p className="text-[11.5px] font-semibold text-muted uppercase">Good sources</p>
          <div className="no-scrollbar -mx-1 mt-1 flex gap-1.5 overflow-x-auto px-1">
            {picks.map((p) => (
              <button
                key={p.foodId}
                type="button"
                onClick={() => navigate(`/search?q=${encodeURIComponent(p.name)}`)}
                className="surface-sunken shrink-0 rounded-lg px-2.5 py-1.5 text-left transition-transform active:scale-95"
              >
                <span className="block text-[12.5px] font-semibold">{p.name}</span>
                <span className="block text-[11px] text-secondary">
                  {p.servingLabel} · {formatMicro(row.def.id, p.amount)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
