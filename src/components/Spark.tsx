import { useId } from 'react';

/**
 * Dependency-free micro charts for the Home dashboard. Recharts is lazy and
 * heavy; these are a few hundred bytes of SVG and draw themselves in with a
 * CSS animation, so Home stays fast to open.
 */

/** Monotone-ish smooth path through points, using Catmull-Rom → Bézier. */
function smoothPath(pts: [number, number][]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`;
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? p2;
    const t = 0.18;
    const c1x = p1[0] + (p2[0] - p0[0]) * t;
    const c1y = p1[1] + (p2[1] - p0[1]) * t;
    const c2x = p2[0] - (p3[0] - p1[0]) * t;
    const c2y = p2[1] - (p3[1] - p1[1]) * t;
    d += ` C${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`;
  }
  return d;
}

export function Sparkline({
  data,
  color,
  height = 40,
  className = '',
  fill = true,
}: {
  /** Days with no data (null) are skipped rather than drawn at zero. */
  data: (number | null)[];
  color: string;
  height?: number;
  className?: string;
  fill?: boolean;
}) {
  const id = useId().replace(/:/g, '');
  const W = 100;
  const present = data
    .map((v, i) => (v == null ? null : ([i, v] as [number, number])))
    .filter((p): p is [number, number] => p !== null);

  if (present.length < 2) {
    return (
      <div className={`flex items-center ${className}`} style={{ height }}>
        <div className="h-px w-full border-t border-dashed border-[var(--surface-border)]" />
      </div>
    );
  }

  const values = present.map((p) => p[1]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const padY = 4;
  const stepX = W / Math.max(1, data.length - 1);
  const pts: [number, number][] = present.map(([i, v]) => [
    i * stepX,
    padY + (1 - (v - min) / span) * (height - padY * 2),
  ]);
  const line = smoothPath(pts);
  const area = `${line} L${pts[pts.length - 1][0]},${height} L${pts[0][0]},${height} Z`;
  const last = pts[pts.length - 1];

  return (
    <div className={`relative ${className}`} style={{ height }} aria-hidden="true">
    <svg
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      className="block h-full w-full overflow-visible"
    >
      <defs>
        <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.28 }} />
          <stop offset="100%" style={{ stopColor: color, stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      {fill && (
        <path d={area} fill={`url(#spark-${id})`} className="animate-fade-in" />
      )}
      <path
        d={line}
        fill="none"
        style={{
          stroke: color,
          ['--len' as string]: 1,
          animation: 'draw-line 1.1s cubic-bezier(0.16,1,0.3,1) both',
        }}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        pathLength={1}
        strokeDasharray={1}
      />
    </svg>
      {/* In HTML rather than the SVG: the stretched viewBox would squash it. */}
      <span
        className="animate-pop-in absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[var(--surface-card)]"
        style={{ left: `${(last[0] / W) * 100}%`, top: last[1], background: color, animationDelay: '0.7s' }}
      />
    </div>
  );
}

/**
 * Seven little columns, today last and highlighted. A dashed goal line sits
 * across when a goal is given so "did I hit it" reads without numbers.
 */
export function MiniBars({
  data,
  color,
  goal,
  height = 40,
  className = '',
}: {
  data: number[];
  color: string;
  goal?: number;
  height?: number;
  className?: string;
}) {
  const max = Math.max(goal ?? 0, ...data, 1);
  return (
    <div className={`relative flex items-end gap-[5px] ${className}`} style={{ height }} aria-hidden="true">
      {goal ? (
        <div
          className="pointer-events-none absolute inset-x-0 border-t border-dashed"
          style={{ bottom: `${(goal / max) * 100}%`, borderColor: `color-mix(in srgb, ${color} 45%, transparent)` }}
        />
      ) : null}
      {data.map((v, i) => {
        const isLast = i === data.length - 1;
        const h = v > 0 ? Math.max(8, (v / max) * 100) : 6;
        return (
          <div
            key={i}
            className="flex-1 origin-bottom rounded-[4px]"
            style={{
              height: `${h}%`,
              background:
                v > 0
                  ? isLast
                    ? color
                    : `color-mix(in srgb, ${color} 42%, transparent)`
                  : 'var(--surface-sunken)',
              animation: `grow-y 0.8s cubic-bezier(0.16,1,0.3,1) ${i * 45}ms both`,
            }}
          />
        );
      })}
    </div>
  );
}
