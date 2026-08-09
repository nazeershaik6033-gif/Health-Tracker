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
 * Home · Diet · [+] · Plans · Streaks — the [+] is a raised FAB in the middle
 * of the bar, matching the reference app.
 */
export function BottomNav() {
  const navigate = useNavigate();
  const [left, right] = [ITEMS.slice(0, 2), ITEMS.slice(2)];

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--surface-border)] bg-[var(--surface-card)]/95 backdrop-blur">
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
            className="absolute top-0 h-0.5 w-7 origin-center rounded-full bg-brand-500 transition-transform duration-250 ease-out"
            style={{ transform: `scaleX(${isActive ? 1 : 0})` }}
          />
          <Icon
            width={22}
            height={22}
            strokeWidth={isActive ? 2.1 : 1.75}
            className="transition-transform duration-200 ease-out"
            style={{ transform: `scale(${isActive ? 1.08 : 1})` }}
          />
          {label}
        </>
      )}
    </NavLink>
  );
}
