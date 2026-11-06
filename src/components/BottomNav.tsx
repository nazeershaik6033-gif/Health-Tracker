import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { HAPTIC, haptic } from '@/lib/motion';
import { IconDiet, IconHome, IconPlans, IconPlus, IconStreak } from './icons';

const ITEMS = [
  { to: '/', label: 'Home', Icon: IconHome, end: true },
  { to: '/diet', label: 'Diet', Icon: IconDiet, end: false },
  { to: '/plans', label: 'Plans', Icon: IconPlans, end: false },
  { to: '/streaks', label: 'Streaks', Icon: IconStreak, end: false },
];

/** Slot order in the bar: two tabs, the log button, two tabs. */
const SLOTS = [0, 1, -1, 2, 3];

/**
 * Floating, frosted tab bar. The active pill is one element that slides
 * between slots on a spring rather than each tab lighting up on its own, so a
 * tab change reads as movement. The raised [+] in the middle opens the log
 * sheet.
 */
export function BottomNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const active = ITEMS.findIndex((item) =>
    item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`),
  );
  const activeSlot = SLOTS.indexOf(active);

  return (
    <nav
      className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-4"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.75rem)' }}
    >
      <div className="surface-glass shadow-float pointer-events-auto relative mx-auto flex h-[4.25rem] max-w-md items-center rounded-[1.75rem] px-1.5">
        {/* Sliding highlight. Each slot is a fifth of the bar. */}
        {activeSlot >= 0 && (
          <span
            aria-hidden="true"
            className="absolute top-1.5 bottom-1.5 left-1.5 rounded-[1.35rem] bg-[color-mix(in_srgb,var(--brand-500)_13%,transparent)] transition-transform duration-500 ease-[cubic-bezier(0.34,1.3,0.64,1)]"
            style={{
              width: 'calc((100% - 0.75rem) / 5)',
              transform: `translateX(${activeSlot * 100}%)`,
            }}
          />
        )}

        {SLOTS.map((slot) =>
          slot === -1 ? (
            <div key="log" className="relative flex flex-1 justify-center">
              <button
                type="button"
                onClick={() => {
                  haptic(HAPTIC.tap);
                  navigate('/log');
                }}
                aria-label="Log food"
                className="pressable brand-gradient flex h-[3.4rem] w-[3.4rem] items-center justify-center rounded-[1.25rem] shadow-[0_12px_28px_-10px_rgb(14_154_104/0.8)]"
              >
                <IconPlus width={26} height={26} strokeWidth={2.4} />
              </button>
            </div>
          ) : (
            <NavItem key={ITEMS[slot].to} {...ITEMS[slot]} />
          ),
        )}
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
        `relative z-10 flex flex-1 flex-col items-center gap-0.5 py-2 text-[10.5px] font-semibold transition-colors duration-300 ${
          isActive ? 'text-brand-600' : 'text-[var(--text-muted)]'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            width={22}
            height={22}
            strokeWidth={isActive ? 2.2 : 1.8}
            className="transition-transform duration-500 ease-[cubic-bezier(0.34,1.5,0.64,1)]"
            style={{ transform: `translateY(${isActive ? -1 : 0}px) scale(${isActive ? 1.1 : 1})` }}
          />
          {label}
        </>
      )}
    </NavLink>
  );
}
