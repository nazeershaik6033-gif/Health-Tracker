import { useEffect, useMemo, useRef, useState } from 'react';
import { fromISODate } from '@/lib/date';

/**
 * Bar / line / area trends, drawn as plain SVG.
 *
 * This was recharts, which cost 400 KB — larger than the entire rest of the
 * app — to draw five sparkline-sized charts on tracker screens. Everything
 * those charts actually used is here: a value axis with nice round ticks, a
 * date axis, a dashed goal line, and a tooltip that follows touch. Rendering
 * one is now a handful of path strings instead of a React reconciliation pass
 * over several hundred chart-primitive components, which is most of why the
 * tracker screens felt heavy on a phone.
 */

export interface Point {
  date: string;
  value: number;
}

interface Props {
  data: Point[];
  color: string;
  kind?: 'bar' | 'line' | 'area';
  /** Dashed horizontal goal line. */
  goal?: number;
  unit?: string;
  height?: number;
  /** Weight charts read better zoomed to the data than anchored at zero. */
  domainFromData?: boolean;
}

const PAD = { top: 10, right: 10, bottom: 20, left: 36 };

const tickDate = (iso: string) => {
  const d = fromISODate(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
};

const fullDate = (iso: string) =>
  fromISODate(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

/** Round tick values at 1/2/5×10ⁿ, so the axis reads 0, 500, 1000 — not 0, 437. */
function niceTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;

  const ticks: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max + step * 0.001; t += step) {
    ticks.push(Math.round(t * 1000) / 1000);
  }
  return ticks;
}

/**
 * Monotone cubic interpolation (Fritsch–Carlson).
 *
 * Plain cubic splines overshoot: a run of flat weights followed by one drop
 * makes the curve dip below every measurement taken, which reads as a weight
 * the user never recorded. This cannot overshoot the data.
 */
function monotonePath(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M${pts[0].x},${pts[0].y}`;

  const n = pts.length;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1].x - pts[i].x);
    slope.push((pts[i + 1].y - pts[i].y) / (pts[i + 1].x - pts[i].x));
  }

  const m: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) m.push(0);
    else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      m.push((w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i]));
    }
  }
  m.push(slope[n - 2]);

  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 0; i < n - 1; i++) {
    const third = dx[i] / 3;
    d += ` C${pts[i].x + third},${pts[i].y + m[i] * third} ${pts[i + 1].x - third},${
      pts[i + 1].y - m[i + 1] * third
    } ${pts[i + 1].x},${pts[i + 1].y}`;
  }
  return d;
}

/** Tracks the rendered width so the chart can be drawn in real pixels. */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    // ResizeObserver rather than a resize listener: these live inside cards
    // that change width when a sheet opens, with no window resize involved.
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    setWidth(node.clientWidth);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}

export function TrendChart({
  data,
  color,
  kind = 'bar',
  goal,
  unit = '',
  height = 180,
  domainFromData = false,
}: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = Math.max(0, height - PAD.top - PAD.bottom);

  const geometry = useMemo(() => {
    const values = data.map((d) => d.value).filter((v) => v > 0);
    const dataMin = values.length ? Math.min(...values) : 0;
    const dataMax = values.length ? Math.max(...values) : 1;

    let lo: number;
    let hi: number;
    if (domainFromData) {
      const pad = Math.max((dataMax - dataMin) * 0.15, dataMax * 0.02, 1);
      lo = Math.floor(dataMin - pad);
      hi = Math.ceil(dataMax + pad);
    } else {
      lo = 0;
      // The goal line has to fit inside the plot or it is drawn off the top.
      hi = Math.max(dataMax, goal ?? 0) * 1.08 || 1;
    }
    if (hi <= lo) hi = lo + 1;

    const y = (value: number) => PAD.top + plotH - ((value - lo) / (hi - lo)) * plotH;
    // Bars are centred in equal-width bands; lines sit on the band centres too,
    // so switching `kind` never shifts a point sideways.
    const band = data.length ? plotW / data.length : plotW;
    const x = (index: number) => PAD.left + band * (index + 0.5);

    return { lo, hi, y, x, band, ticks: niceTicks(lo, hi) };
  }, [data, domainFromData, goal, plotW, plotH]);

  const { y, x, band, ticks } = geometry;

  const points = useMemo(
    () => data.map((d, i) => ({ x: x(i), y: y(d.value) })),
    [data, x, y],
  );

  // Enough room for every label, or every other one, and so on.
  const xStep = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(plotW / 34))));

  function pick(clientX: number) {
    const node = ref.current;
    if (!node || !data.length) return;
    const rect = node.getBoundingClientRect();
    const index = Math.floor((clientX - rect.left - PAD.left) / band);
    setActive(index >= 0 && index < data.length ? index : null);
  }

  const gradientId = `trend-${color.replace(/[^a-z0-9]/gi, '')}-${kind}`;
  const linePath = kind === 'bar' ? '' : monotonePath(points);

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${kind} chart of ${data.length} days`}
          onPointerDown={(e) => pick(e.clientX)}
          onPointerMove={(e) => e.buttons > 0 && pick(e.clientX)}
          onPointerLeave={() => setActive(null)}
          className="touch-pan-y overflow-visible"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>

          {/* Value grid + labels */}
          {ticks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={width - PAD.right}
                y1={y(t)}
                y2={y(t)}
                stroke="var(--surface-border)"
                strokeDasharray="3 3"
              />
              <text
                x={PAD.left - 6}
                y={y(t)}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize={10}
                fill="var(--text-muted)"
              >
                {t >= 1000 ? `${Math.round(t / 100) / 10}k` : t}
              </text>
            </g>
          ))}

          {/* Date labels */}
          {data.map((d, i) =>
            i % xStep === 0 ? (
              <text
                key={d.date}
                x={x(i)}
                y={height - 6}
                textAnchor="middle"
                fontSize={10}
                fill="var(--text-muted)"
              >
                {tickDate(d.date)}
              </text>
            ) : null,
          )}

          {goal !== undefined && goal > 0 && (
            <line
              x1={PAD.left}
              x2={width - PAD.right}
              y1={y(goal)}
              y2={y(goal)}
              stroke={color}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              strokeOpacity={0.55}
            />
          )}

          {kind === 'bar' ? (
            data.map((d, i) => {
              const w = Math.min(22, band * 0.62);
              const top = y(d.value);
              const h = Math.max(0, PAD.top + plotH - top);
              return (
                <rect
                  key={d.date}
                  x={x(i) - w / 2}
                  y={top}
                  width={w}
                  height={h}
                  rx={Math.min(4, w / 2)}
                  fill={color}
                  opacity={active === null || active === i ? 1 : 0.45}
                />
              );
            })
          ) : (
            <>
              {kind === 'area' && points.length > 1 && (
                <path
                  d={`${linePath} L${points[points.length - 1].x},${PAD.top + plotH} L${points[0].x},${PAD.top + plotH} Z`}
                  fill={`url(#${gradientId})`}
                />
              )}
              <path d={linePath} fill="none" stroke={color} strokeWidth={2.25} />
              {points.map((p, i) => (
                <circle key={data[i].date} cx={p.x} cy={p.y} r={2.5} fill={color} />
              ))}
            </>
          )}

          {active !== null && data[active] && (
            <>
              <line
                x1={x(active)}
                x2={x(active)}
                y1={PAD.top}
                y2={PAD.top + plotH}
                stroke="var(--text-muted)"
                strokeOpacity={0.4}
              />
              <circle
                cx={x(active)}
                cy={y(data[active].value)}
                r={4.5}
                fill={color}
                stroke="var(--surface-card)"
                strokeWidth={2}
              />
            </>
          )}
        </svg>
      )}

      {active !== null && data[active] && (
        <div
          className="surface-card pointer-events-none absolute z-10 -translate-x-1/2 rounded-xl px-2.5 py-1.5 text-[12px] shadow-sm"
          style={{
            left: Math.min(Math.max(x(active), 54), Math.max(width - 54, 54)),
            top: 0,
          }}
        >
          <p className="font-semibold">{fullDate(data[active].date)}</p>
          <p className="tabular text-secondary">
            {Math.round(data[active].value * 10) / 10}
            {unit}
          </p>
        </div>
      )}
    </div>
  );
}
