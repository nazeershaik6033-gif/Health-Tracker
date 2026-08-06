import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { fromISODate } from '@/lib/date';

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

const tickDate = (iso: string) => {
  const d = fromISODate(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
};

export function TrendChart({
  data,
  color,
  kind = 'bar',
  goal,
  unit = '',
  height = 180,
  domainFromData = false,
}: Props) {
  const values = data.map((d) => d.value).filter((v) => v > 0);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const pad = Math.max((max - min) * 0.15, max * 0.02, 1);

  const domain: [number | string, number | string] = domainFromData
    ? [Math.floor(min - pad), Math.ceil(max + pad)]
    : [0, 'auto'];

  const axis = {
    stroke: 'var(--text-muted)',
    fontSize: 10,
    tickLine: false,
    axisLine: false,
  };

  const tooltip = (
    <Tooltip
      cursor={{ fill: 'var(--surface-sunken)', opacity: 0.5 }}
      contentStyle={{
        background: 'var(--surface-card)',
        border: '1px solid var(--surface-border)',
        borderRadius: 12,
        fontSize: 12,
        color: 'var(--text-primary)',
      }}
      labelFormatter={(iso) => fromISODate(String(iso)).toLocaleDateString(undefined, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      })}
      formatter={(v: number | string) => [`${v}${unit}`, '']}
    />
  );

  const goalLine = goal ? (
    <ReferenceLine
      y={goal}
      stroke={color}
      strokeDasharray="4 4"
      strokeOpacity={0.55}
      label={{ value: 'Goal', position: 'right', fontSize: 9, fill: 'var(--text-muted)' }}
    />
  ) : null;

  const grid = <CartesianGrid strokeDasharray="3 3" stroke="var(--surface-border)" vertical={false} />;

  return (
    <ResponsiveContainer width="100%" height={height}>
      {kind === 'bar' ? (
        <BarChart data={data} margin={{ top: 8, right: 12, left: -22, bottom: 0 }}>
          {grid}
          <XAxis dataKey="date" tickFormatter={tickDate} {...axis} minTickGap={18} />
          <YAxis domain={domain} {...axis} width={44} />
          {tooltip}
          {goalLine}
          <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} maxBarSize={22} />
        </BarChart>
      ) : kind === 'line' ? (
        <LineChart data={data} margin={{ top: 8, right: 12, left: -22, bottom: 0 }}>
          {grid}
          <XAxis dataKey="date" tickFormatter={tickDate} {...axis} minTickGap={18} />
          <YAxis domain={domain} {...axis} width={44} />
          {tooltip}
          {goalLine}
          <Line
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2.25}
            dot={{ r: 2.5, fill: color, strokeWidth: 0 }}
            activeDot={{ r: 4.5 }}
            connectNulls
          />
        </LineChart>
      ) : (
        <AreaChart data={data} margin={{ top: 8, right: 12, left: -22, bottom: 0 }}>
          <defs>
            <linearGradient id={`fill-${color.replace(/[^a-z0-9]/gi, '')}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          {grid}
          <XAxis dataKey="date" tickFormatter={tickDate} {...axis} minTickGap={18} />
          <YAxis domain={domain} {...axis} width={44} />
          {tooltip}
          {goalLine}
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2.25}
            fill={`url(#fill-${color.replace(/[^a-z0-9]/gi, '')})`}
          />
        </AreaChart>
      )}
    </ResponsiveContainer>
  );
}
