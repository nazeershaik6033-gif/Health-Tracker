import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, Ref } from 'react';
import { Link } from 'react-router-dom';
import { IconSparkle, IconChevronLeft } from './icons';

/* --------------------------------- Button -------------------------------- */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700',
  accent: 'bg-accent-500 text-white hover:bg-accent-600',
  secondary: 'surface-sunken hairline border hover:brightness-95',
  ghost: 'hover:surface-sunken',
  danger: 'bg-red-600 text-white hover:bg-red-700',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  full?: boolean;
  size?: 'sm' | 'md' | 'lg';
  /** React 19 takes a ref as an ordinary prop — no forwardRef wrapper needed. */
  ref?: Ref<HTMLButtonElement>;
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
    sm: 'px-3 py-1.5 text-[13px] rounded-lg',
    md: 'px-4 py-2.5 text-sm rounded-xl',
    lg: 'px-5 py-3.5 text-[15px] rounded-2xl',
  };
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${VARIANTS[variant]} ${sizes[size]} ${full ? 'w-full' : ''} ${className}`}
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
    <div className="mb-2.5 flex items-center justify-between">
      <h2 className="text-[15px] font-bold tracking-tight">{children}</h2>
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
      {label && <span className="mb-1.5 block text-[13px] font-medium text-secondary">{label}</span>}
      <span className="relative block">
        <input
          className={`hairline w-full rounded-xl border bg-transparent px-3.5 py-2.5 text-[15px] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-brand-500 ${suffix ? 'pr-12' : ''} ${error ? 'border-red-500' : ''} ${className}`}
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
      className={`hairline inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors ${
        active ? 'border-brand-500 tint-soft tint-brand' : 'hover:surface-sunken'
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
    <div className="flex flex-col items-center px-6 py-10 text-center">
      {icon && (
        <div className="surface-sunken mb-3 flex h-14 w-14 items-center justify-center rounded-full text-[var(--text-muted)]">
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
  back?: string | (() => void);
  action?: ReactNode;
  subtitle?: string;
}) {
  return (
    <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-[var(--surface-border)] chrome-canvas px-3 pt-safe pb-2">
      {typeof back === 'string' ? (
        <Link to={back} aria-label="Back" className="rounded-full p-2 hover:surface-sunken">
          <IconChevronLeft width={22} height={22} />
        </Link>
      ) : (
        <button
          type="button"
          onClick={back}
          aria-label="Back"
          className="rounded-full p-2 hover:surface-sunken"
        >
          <IconChevronLeft width={22} height={22} />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[17px] font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="truncate text-[12px] text-secondary">{subtitle}</p>}
      </div>
      {action}
    </header>
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
