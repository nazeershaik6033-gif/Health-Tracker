import { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useApp } from '@/stores/useApp';
import { useTheme } from '@/lib/theme';
import { BottomNav } from '@/components/BottomNav';
import { Toast } from '@/components/Toast';
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
const FoodEditor = lazy(() => import('@/screens/FoodEditor'));
const Streaks = lazy(() => import('@/screens/Streaks'));
const Plans = lazy(() => import('@/screens/Plans'));
const Coach = lazy(() => import('@/screens/Coach'));
const MealScore = lazy(() => import('@/screens/MealScore'));
const Water = lazy(() => import('@/screens/trackers/Water'));
const Sleep = lazy(() => import('@/screens/trackers/Sleep'));
const Weight = lazy(() => import('@/screens/trackers/Weight'));
const Workout = lazy(() => import('@/screens/trackers/Workout'));
const Steps = lazy(() => import('@/screens/trackers/Steps'));
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
  // Has its own sticky action bar; the bottom nav would sit on top of it and
  // swallow the taps on Save.
  '/food/new',
];

export default function App() {
  const { ready, profile, settings, init } = useApp();
  const location = useLocation();
  useTheme(settings.theme);

  useEffect(() => {
    void init();
  }, [init]);

  // Reset scroll between screens; without this a deep-scrolled Diet view
  // carries its offset into the next screen.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

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
        <Suspense fallback={<BootSkeleton />}>
          <Routes>
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/" element={<Home />} />
            <Route path="/diet" element={<Diet />} />
            <Route path="/calendar" element={<CalendarScreen />} />
            <Route path="/food/new" element={<FoodEditor />} />
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
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>

      <Toast />
      {!fullscreen && <BottomNav />}
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
