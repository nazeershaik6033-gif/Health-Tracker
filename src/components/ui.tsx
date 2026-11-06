import { useEffect, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { IconSparkle, IconChevronLeft } from './icons';
import { animateNumber } from '@/lib/motion';
import { useGoBack } from '@/lib/nav';

/* --------------------------------- Button -------------------------------- */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';

const VARIANTS: Record<Variant, string> = {
  primary:
    'brand-gradient shadow-[0_10px_24px_-10px_rgb(14_154_104/0.65)] hover:brightness-[1.06]',
  accent:
    'bg-gradient-to-br from-[#ff9a52] to-accent-500 text-white shadow-[0_10px_24px_-10px_rgb(247_107_28/0.6)] hover:brightness-105',
  secondary:
    'bg-[var(--surface-sunken)] shadow-[inset_0_0_0_1px_var(--surface-border)] hover:brightness-[0.97]',
  ghost: 'hover:bg-[var(--surface-sunken)]',
  danger: 'bg-red-600 text-white hover:bg-red-700',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  full?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export function Button({
  variant = 'primary',
  full,
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonProps) {
  const sizes = {
    sm: 'px-3.5 py-2 text-[13px] rounded-xl',
    md: 'px-4.5 py-3 text-sm rounded-2xl',
    lg: 'px-5 py-4 text-[15px] rounded-[1.15rem]',
  };
  return (
    <button
      className={`pressable inline-flex items-center justify-center gap-2 font-semibold tracking-[-0.01em] transition-[filter,opacity] disabled:pointer-events-none disabled:opacity-40 disabled:shadow-none ${VARIANTS[variant]} ${sizes[size]} ${full ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ---------------------------------- Card --------------------------------- */

export function Card({
  children,
  className = '',
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return <div className={`surface-card ${padded ? 'p-4' : ''} ${className}`}>{children}</div>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-[16px] font-bold tracking-tight">{children}</h2>
      {action}
    </div>
  );
}

/* ---------------------------------- Input -------------------------------- */

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  suffix?: string;
  error?: string;
}

export function Field({ label, hint, suffix, error, className = '', ...rest }: FieldProps) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-[13px] font-semibold text-secondary">{label}</span>}
      <span className="relative block">
        <input
          className={`w-full rounded-2xl border border-transparent bg-[var(--surface-sunken)] px-4 py-3 text-[15px] outline-none transition-[border-color,background-color,box-shadow] duration-200 placeholder:text-[var(--text-muted)] focus:border-brand-500 focus:bg-[var(--surface-card)] focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--brand-500)_16%,transparent)] ${suffix ? 'pr-12' : ''} ${error ? 'border-red-500' : ''} ${className}`}
          {...rest}
        />
        {suffix && (
          <span className="absolute top-1/2 right-3.5 -translate-y-1/2 text-[13px] text-muted">
            {suffix}
          </span>
        )}
      </span>
      {error ? (
        <span className="mt-1 block text-[12px] text-red-600">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-[12px] text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

/* --------------------------------- Chips --------------------------------- */

export function Chip({
  children,
  active,
  onClick,
  icon,
}: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`pressable inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-semibold transition-[background-color,color,box-shadow] duration-300 ${
        active
          ? 'tint-soft tint-brand shadow-[inset_0_0_0_1.5px_var(--brand-500)]'
          : 'surface-card text-secondary'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

/** Small ✨ badge marking anything the AI produced. */
export function AIBadge({ label = 'AI' }: { label?: string }) {
  return (
    <span className="accent-pill inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold">
      <IconSparkle width={11} height={11} />
      {label}
    </span>
  );
}

/* ------------------------------ Empty states ----------------------------- */

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="animate-rise-in flex flex-col items-center px-6 py-10 text-center">
      {icon && (
        <div className="surface-card mb-4 flex h-16 w-16 items-center justify-center rounded-[1.4rem] text-[var(--text-muted)]">
          {icon}
        </div>
      )}
      <p className="text-[15px] font-semibold">{title}</p>
      {body && <p className="mt-1 max-w-xs text-[13px] text-secondary">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ------------------------------- Page header ----------------------------- */

export function PageHeader({
  title,
  back = '/',
  action,
  subtitle,
}: {
  title: string;
  /** A path, -1 for "where the user came from" (falls back to Home), or a handler. */
  back?: string | -1 | (() => void);
  action?: ReactNode;
  subtitle?: string;
}) {
  const goBack = useGoBack();
  // The bar is clear over the top of the page and frosts once content
  // scrolls under it — the same cue native large-title bars give.
  const scrolled = useScrolled();
  return (
    <header
      className={`sticky top-0 z-20 flex items-center gap-1.5 px-2.5 pt-safe pb-2 transition-[background-color,box-shadow] duration-300 ${
        scrolled
          ? 'surface-glass shadow-[0_1px_0_var(--surface-border)]'
          : 'bg-[var(--surface-canvas)]'
      }`}
    >
      <button
        type="button"
        onClick={() => (typeof back === 'function' ? back() : goBack(back))}
        aria-label="Back"
        className="pressable flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-[var(--surface-sunken)]"
      >
        <IconChevronLeft width={22} height={22} strokeWidth={2.1} />
      </button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[18px] font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="truncate text-[12px] font-medium text-secondary">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}

/** True once the window has scrolled past a few pixels. */
export function useScrolled(threshold = 6): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [threshold]);
  return scrolled;
}

/* ---------------------------- Animated number ---------------------------- */

/**
 * A number that counts to its new value instead of snapping. Starts from zero
 * on mount so a screen's headline figures roll up as it arrives.
 */
export function AnimatedNumber({
  value,
  format = (n) => Math.round(n).toLocaleString(),
  duration = 900,
  className = '',
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
  className?: string;
}) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const stop = animateNumber(from.current, value, (n) => {
      from.current = n;
      setShown(n);
    }, duration);
    return stop;
  }, [value, duration]);
  return <span className={`tabular ${className}`}>{format(shown)}</span>;
}

/* ------------------------------ Progress bar ----------------------------- */

export function ProgressBar({
  value,
  color,
  height = 6,
  className = '',
}: {
  /** 0–1; anything above 1 is drawn full in the over colour. */
  value: number;
  color: string;
  height?: number;
  className?: string;
}) {
  const over = value > 1.0001;
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      className={`w-full overflow-hidden rounded-full bg-[var(--surface-sunken)] ${className}`}
      style={{ height }}
    >
      <div
        className="h-full rounded-full transition-[width] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
        style={{
          width: `${pct}%`,
          background: over ? '#ef4444' : `linear-gradient(90deg, color-mix(in srgb, ${color} 70%, white), ${color})`,
        }}
      />
    </div>
  );
}

/* -------------------------------- Skeleton ------------------------------- */

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton rounded-lg ${className}`} />;
}

/* ------------------------------ Score circle ----------------------------- */

/** 0–10 ingredient score, coloured by band — mirrors the Meal Score screen. */
export function ScoreCircle({ score, size = 34 }: { score: number; size?: number }) {
  const color = score >= 8 ? 'var(--color-brand-500)' : score >= 5 ? '#e5a50a' : '#dc2626';
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full border-2 font-bold"
      style={{ width: size, height: size, borderColor: color, color, fontSize: size * 0.4 }}
      aria-label={`Score ${score} out of 10`}
    >
      {score}
    </div>
  );
}
