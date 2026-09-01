import { useEffect, useRef } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { HAPTIC, haptic } from '@/lib/motion';
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

    const sync = () => {
      const rect = el.getBoundingClientRect();
      // A hidden bar reports an empty rect; measuring against that would
      // compute a bogus shift and translate it off-screen for good.
      if (rect.width === 0 && rect.height === 0) return;
      const shift = Math.max(0, vv.height + vv.offsetTop - rect.bottom);
      el.style.transform = shift > 0.5 ? `translateY(${shift.toFixed(2)}px)` : '';
    };

    sync();
    // The viewport settles over about a second after a toolbar or keyboard
    // transition, and fires no event once it lands.
    const timers = [120, 500, 1200].map((ms) => setTimeout(sync, ms));
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    window.addEventListener('orientationchange', sync);

    return () => {
      timers.forEach(clearTimeout);
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
      window.removeEventListener('orientationchange', sync);
    };
  }, []);

  return (
    <nav
      ref={navRef}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--surface-border)] bg-[var(--surface-card)]/95 backdrop-blur"
    >
      <div className="mx-auto flex max-w-lg items-stretch justify-between px-2 pt-1.5 pb-safe">
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
