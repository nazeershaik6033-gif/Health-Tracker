import { Suspense, lazy, useEffect, useRef } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useApp } from '@/stores/useApp';
import { useTheme } from '@/lib/theme';
import { useDayRollover } from '@/lib/dayRollover';
import { routeDirection } from '@/lib/motion';
import { BottomNav, NAV_ORDER } from '@/components/BottomNav';
import { FpsMeter } from '@/components/FpsMeter';
import { Toast } from '@/components/Toast';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Skeleton } from '@/components/ui';

// The daily-use path is eager so the first paint after launch is immediate.
import Home from '@/screens/Home';
import Diet from '@/screens/Diet';
import LogSheet from '@/screens/LogSheet';
import Search from '@/screens/Search';
import Onboarding from '@/screens/Onboarding';

// Everything else is lazy. Two groups dominate the bundle and neither is
// needed to open the app: the charting library behind every tracker and the
// Streaks view, and the camera / wasm-decoder / OCR stack.
const Settings = lazy(() => import('@/screens/Settings'));
// Lazy: it pulls in RingProgress-per-cell and the day bundle, and it is a
// deliberate navigation rather than part of the launch path.
const CalendarScreen = lazy(() => import('@/screens/Calendar'));
// Lazy: reached by tapping a figure on the day summary, never on launch.
const MacroBreakdown = lazy(() => import('@/screens/MacroBreakdown'));
const FoodEditor = lazy(() => import('@/screens/FoodEditor'));
// Lazy: the zip/XML reader is dead weight for everyone who never imports.
const ImportHealth = lazy(() => import('@/screens/ImportHealth'));
const GlobalSearch = lazy(() => import('@/screens/GlobalSearch'));
const RecipeBuilder = lazy(() => import('@/screens/RecipeBuilder'));
const Streaks = lazy(() => import('@/screens/Streaks'));
const Plans = lazy(() => import('@/screens/Plans'));
const Coach = lazy(() => import('@/screens/Coach'));
const MealScore = lazy(() => import('@/screens/MealScore'));
const Water = lazy(() => import('@/screens/trackers/Water'));
const Sleep = lazy(() => import('@/screens/trackers/Sleep'));
const Weight = lazy(() => import('@/screens/trackers/Weight'));
const Workout = lazy(() => import('@/screens/trackers/Workout'));
const Steps = lazy(() => import('@/screens/trackers/Steps'));
const ExerciseDetail = lazy(() => import('@/screens/ExerciseDetail'));
const Snap = lazy(() => import('@/screens/Snap'));
const SnapGallery = lazy(() => import('@/screens/SnapGallery'));
const Scan = lazy(() => import('@/screens/Scan'));
const Voice = lazy(() => import('@/screens/Voice'));
const Label = lazy(() => import('@/screens/Label'));

/** Routes that own the full viewport — no bottom nav, no page padding. */
const FULLSCREEN = [
  '/snap',
  '/scan',
  '/label',
  '/voice',
  '/coach',
  '/onboarding',
  '/log',
  '/search',
  '/find',
  // Has its own sticky action bar; the bottom nav would sit on top of it and
  // swallow the taps on Save. Prefix, so it covers /food/new and
  // /food/:id/edit alike — the matcher appends the slash itself.
  '/food',
];

export default function App() {
  const { ready, profile, settings, init } = useApp();
  const location = useLocation();
  useTheme(settings.theme);
  useDayRollover();

  useEffect(() => {
    void init();
  }, [init]);

  // Reset scroll between screens; without this a deep-scrolled Diet view
  // carries its offset into the next screen. Instant rather than smooth: the
  // incoming screen is already animating in, and a smooth scroll racing that
  // slide is what makes a transition read as two separate movements.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  // Screen-transition direction. Moving right along the bottom-nav order
  // slides the incoming screen in from the right, moving left from the left.
  // Everything else — a drill-down into a tracker, an editor, a route that is
  // not a tab — fades up instead, rather than implying a sideways step the
  // navigation didn't take.
  //
  // Resolved during render, not in an effect: the class has to be on the
  // element in the same commit that gives it its new key, or the animation is
  // already a frame late. It is then held until the path changes again — a
  // re-render from anything else (a toast, a settings write) must not swap the
  // class mid-flight, which would restart the animation as a different one.
  // Re-running this on the same path is a no-op, so StrictMode's double render
  // produces the same result.
  const prevPath = useRef(location.pathname);
  const routeClass = useRef('animate-route-in');
  if (prevPath.current !== location.pathname) {
    const direction = routeDirection(prevPath.current, location.pathname, NAV_ORDER);
    routeClass.current =
      direction === 'right'
        ? 'animate-route-right'
        : direction === 'left'
          ? 'animate-route-left'
          : 'animate-route-in';
    prevPath.current = location.pathname;
  }

  if (!ready) return <BootSkeleton />;

  const onboarded = Boolean(profile) && settings.onboardingDone;
  if (!onboarded && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }

  const fullscreen = FULLSCREEN.some(
    (p) => location.pathname === p || location.pathname.startsWith(`${p}/`),
  );

  return (
    <div className="mx-auto min-h-dvh w-full max-w-lg">
      <main className={fullscreen ? '' : 'pb-24'}>
        {/*
          Keyed on the path so each screen replays its entrance. React Router
          already swaps the route component underneath; the key just gives the
          wrapper a new identity so the CSS animation restarts. Chosen over the
          View Transitions API because a transition has to wrap the DOM change
          itself, and by the time an effect could call it React has committed —
          and this way Safari and Firefox get the same motion as Chrome.
        */}
        <Suspense fallback={<BootSkeleton />}>
          {/*
            will-change is set for the transition and dropped on animationend
            rather than left in the stylesheet: a screen sits mounted long
            after its entrance finished, and a permanent hint would have every
            idle screen holding a compositor layer it no longer needs. The
            target check ignores stagger animations bubbling up from rows.
          */}
          <div
            key={location.pathname}
            className={routeClass.current}
            style={{ willChange: 'transform, opacity' }}
            onAnimationEnd={(e) => {
              if (e.target === e.currentTarget) e.currentTarget.style.willChange = 'auto';
            }}
          >
          <Routes>
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/" element={<Home />} />
            <Route path="/diet" element={<Diet />} />
            <Route path="/calendar" element={<CalendarScreen />} />
            <Route path="/macro/:key" element={<MacroBreakdown />} />
            <Route path="/import/health" element={<ImportHealth />} />
            <Route path="/find" element={<GlobalSearch />} />
            <Route path="/food/recipe" element={<RecipeBuilder />} />
            <Route path="/food/new" element={<FoodEditor />} />
            <Route path="/food/:id/edit" element={<FoodEditor />} />
            <Route path="/log" element={<LogSheet />} />
            <Route path="/search" element={<Search />} />
            <Route path="/snap" element={<Snap />} />
            <Route path="/snap/gallery" element={<SnapGallery />} />
            <Route path="/scan" element={<Scan />} />
            <Route path="/label" element={<Label />} />
            <Route path="/voice" element={<Voice />} />
            <Route path="/meal/:id" element={<MealScore />} />
            <Route path="/coach" element={<Coach />} />
            <Route path="/plans" element={<Plans />} />
            <Route path="/streaks" element={<Streaks />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/trackers/water" element={<Water />} />
            <Route path="/trackers/sleep" element={<Sleep />} />
            <Route path="/trackers/weight" element={<Weight />} />
            <Route path="/trackers/workout" element={<Workout />} />
            <Route path="/trackers/steps" element={<Steps />} />
            <Route path="/exercise/:id" element={<ExerciseDetail />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </div>
        </Suspense>
      </main>

      <Toast />
      <ConfirmDialog />
      {!fullscreen && <BottomNav />}
      {settings.showFps && <FpsMeter />}
    </div>
  );
}

function BootSkeleton() {
  return (
    <div className="mx-auto w-full max-w-lg space-y-3 px-4 pt-safe">
      <div className="flex items-center gap-2 pt-3">
        <Skeleton className="h-9 w-9 rounded-full" />
        <div className="flex-1" />
        <Skeleton className="h-8 w-24 rounded-full" />
      </div>
      <Skeleton className="h-28 w-full rounded-2xl" />
      <Skeleton className="h-36 w-full rounded-2xl" />
      <div className="grid grid-cols-5 gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
