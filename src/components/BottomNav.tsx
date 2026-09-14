import { useEffect, useRef } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { HAPTIC, haptic } from '@/lib/motion';
import { useKeyboardOpen } from '@/lib/viewport';
import { IconDiet, IconHome, IconPlans, IconPlus, IconStreak } from './icons';

const ITEMS = [
  { to: '/', label: 'Home', Icon: IconHome, end: true },
  { to: '/diet', label: 'Diet', Icon: IconDiet, end: false },
  { to: '/plans', label: 'Plans', Icon: IconPlans, end: false },
  { to: '/streaks', label: 'Streaks', Icon: IconStreak, end: false },
];

/**
 * Left-to-right order of the tabs, which is what decides which way a screen
 * slides in. Exported so App can ask for the direction without duplicating
 * the list — a tab added here then animates correctly with no other change.
 */
export const NAV_ORDER = ITEMS.map((i) => i.to);

/**
 * Home · Diet · [+] · Plans · Streaks — the [+] is a raised FAB in the middle
 * of the bar, matching the reference app.
 */
export function BottomNav() {
  const navigate = useNavigate();
  const navRef = useRef<HTMLElement>(null);
  const [left, right] = [ITEMS.slice(0, 2), ITEMS.slice(2)];

  // While a field is focused the nav is only in the way: it would either sit
  // under the keyboard or be pushed over the content the user is typing into.
  // Every route that shows the nav reaches its inputs through a sheet, which
  // has its own footer, so nothing is lost by standing down. Read before the
  // effect below, and acted on after it, so the hook order never varies.
  const keyboardOpen = useKeyboardOpen();

  // Mobile Safari can leave `position: fixed; bottom: 0` sitting above the
  // true visible edge while its toolbar shows or hides, because a fixed
  // element doesn't reliably track the *visual* viewport there — which
  // exposes a strip of the page background below the bar exactly while the
  // user is scrolling. Rather than trust the CSS anchor, measure the residual
  // gap and nudge the bar down by it. A no-op wherever the anchor is already
  // right, so nothing changes on Android or desktop.
  useEffect(() => {
    const el = navRef.current;
    const vv = window.visualViewport;
    if (!el || !vv) return;

    // Where the bar's bottom edge sits with no correction applied, in layout
    // coordinates. Cached rather than re-read, because reading it back is a
    // forced synchronous layout and this used to happen on every one of the
    // `scroll` events iOS fires throughout a fling — a layout flush followed
    // immediately by a style write, which is textbook layout thrashing and
    // stalled the main thread for the whole gesture.
    //
    // Caching is sound: the bar is `position: fixed` with fixed padding, so
    // scrolling cannot move its untransformed box. Only a resize, a rotation
    // or the keyboard can, and each of those re-measures below.
    let base: number | null = null;
    let shift = 0;
    let frame = 0;

    // Pure arithmetic on the visual viewport — no layout read, so this is
    // cheap enough to run on every scroll frame.
    const apply = () => {
      if (base === null) return;
      const next = Math.max(0, vv.height + vv.offsetTop - base);
      // Sub-pixel churn would rewrite the transform every frame for no visible
      // change, and each rewrite re-composites the layer.
      if (Math.abs(next - shift) < 0.5) return;
      // Tracks what is actually on the element, not what was computed: below
      // the threshold the transform is cleared, so recording `next` there
      // would leave `remeasure` subtracting an offset that isn't applied.
      shift = next > 0.5 ? next : 0;
      // translate3d rather than translateY: this inline transform overrides
      // `.dock`'s own, and a 2D one would give the compositor a weaker hint
      // than the layer promotion the bar is relying on to scroll smoothly.
      // Clearing it falls back to the class, which keeps that promotion.
      el.style.transform =
        next > 0.5 ? `translate3d(0, ${next.toFixed(2)}px, 0)` : '';
    };

    // The one place that touches layout. `rect.bottom` already includes our
    // own translate, so subtracting it back out recovers the untransformed
    // edge without having to clear the transform and re-read.
    const remeasure = () => {
      const rect = el.getBoundingClientRect();
      // A hidden bar reports an empty rect; measuring against that would
      // compute a bogus shift and translate it off-screen for good.
      if (rect.width === 0 && rect.height === 0) return;
      base = rect.bottom - shift;
      apply();
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        apply();
      });
    };

    remeasure();
    // The viewport settles over about a second after a toolbar or keyboard
    // transition, and fires no event once it lands.
    const timers = [120, 500, 1200].map((ms) => setTimeout(remeasure, ms));
    vv.addEventListener('resize', remeasure);
    vv.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('orientationchange', remeasure);

    return () => {
      timers.forEach(clearTimeout);
      if (frame) cancelAnimationFrame(frame);
      vv.removeEventListener('resize', remeasure);
      vv.removeEventListener('scroll', onScroll);
      window.removeEventListener('orientationchange', remeasure);
    };
  }, [keyboardOpen]);

  if (keyboardOpen) return null;

  return (
    <nav
      ref={navRef}
      className="dock chrome-surface inset-x-0 z-30 border-t border-[var(--surface-border)]"
    >
      <div className="mx-auto flex shell-w items-stretch justify-between px-2 pt-1.5 pb-safe">
        {left.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}

        <div className="flex w-16 shrink-0 justify-center">
          <button
            type="button"
            onClick={() => {
              haptic(HAPTIC.tap);
              navigate('/log');
            }}
            aria-label="Log food"
            className="-mt-5 flex h-13 w-13 items-center justify-center rounded-full bg-brand-500 text-white shadow-lg shadow-brand-500/30 transition-transform active:scale-95"
            style={{ height: '3.25rem', width: '3.25rem' }}
          >
            <IconPlus width={26} height={26} strokeWidth={2.25} />
          </button>
        </div>

        {right.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </div>
    </nav>
  );
}

function NavItem({
  to,
  label,
  Icon,
  end,
}: {
  to: string;
  label: string;
  Icon: typeof IconHome;
  end: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={() => haptic(HAPTIC.tap)}
      className={({ isActive }) =>
        `relative flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10.5px] font-semibold transition-colors ${
          isActive ? 'text-brand-600' : 'text-[var(--text-muted)]'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {/* A short rule above the active tab, scaled in rather than faded so
              the movement reads as travel between tabs. */}
          <span
            aria-hidden="true"
            className="absolute top-0 h-0.5 w-7 origin-center rounded-full bg-brand-500 transition-transform duration-250"
            style={{
              transform: `scaleX(${isActive ? 1 : 0})`,
              transitionTimingFunction: 'var(--ease-spring)',
            }}
          />
          <Icon
            width={22}
            height={22}
            strokeWidth={isActive ? 2.1 : 1.75}
            className="transition-transform duration-200"
            style={{
              transform: `scale(${isActive ? 1.08 : 1})`,
              transitionTimingFunction: 'var(--ease-spring)',
            }}
          />
          {label}
        </>
      )}
    </NavLink>
  );
}
