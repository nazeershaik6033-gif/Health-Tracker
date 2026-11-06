import { Suspense, lazy, useEffect, useLayoutEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useApp } from '@/stores/useApp';
import { useTheme } from '@/lib/theme';
import { BottomNav } from '@/components/BottomNav';
import { Toast } from '@/components/Toast';
import { Skeleton } from '@/components/ui';
import { prefetchWhenIdle, useNavDirection } from '@/lib/nav';

// The daily-use path is eager so the first paint after launch is immediate.
import Home from '@/screens/Home';
import Diet from '@/screens/Diet';
import LogSheet from '@/screens/LogSheet';
import Search from '@/screens/Search';
import Onboarding from '@/screens/Onboarding';

// Everything else is lazy. Two groups dominate the bundle and neither is
// needed to open the app: the charting library behind every tracker and the
// Streaks view, and the camera / wasm-decoder / OCR stack.
const loadSettings = () => import('@/screens/Settings');
const Settings = lazy(loadSettings);
// Lazy: it pulls in RingProgress-per-cell and the day bundle, and it is a
// deliberate navigation rather than part of the launch path.
const loadCalendarScreen = () => import('@/screens/Calendar');
const CalendarScreen = lazy(loadCalendarScreen);
const loadFoodEditor = () => import('@/screens/FoodEditor');
const FoodEditor = lazy(loadFoodEditor);
// Lazy: the zip/XML reader is dead weight for everyone who never imports.
const loadImportHealth = () => import('@/screens/ImportHealth');
const ImportHealth = lazy(loadImportHealth);
const loadGlobalSearch = () => import('@/screens/GlobalSearch');
const GlobalSearch = lazy(loadGlobalSearch);
const loadRecipeBuilder = () => import('@/screens/RecipeBuilder');
const RecipeBuilder = lazy(loadRecipeBuilder);
const loadStreaks = () => import('@/screens/Streaks');
const Streaks = lazy(loadStreaks);
const loadPlans = () => import('@/screens/Plans');
const Plans = lazy(loadPlans);
const loadCoach = () => import('@/screens/Coach');
const Coach = lazy(loadCoach);
const loadMealScore = () => import('@/screens/MealScore');
const MealScore = lazy(loadMealScore);
const loadWater = () => import('@/screens/trackers/Water');
const Water = lazy(loadWater);
const loadSleep = () => import('@/screens/trackers/Sleep');
const Sleep = lazy(loadSleep);
const loadWeight = () => import('@/screens/trackers/Weight');
const Weight = lazy(loadWeight);
const loadWorkout = () => import('@/screens/trackers/Workout');
const Workout = lazy(loadWorkout);
const loadSteps = () => import('@/screens/trackers/Steps');
const Steps = lazy(loadSteps);
const loadExerciseDetail = () => import('@/screens/ExerciseDetail');
const ExerciseDetail = lazy(loadExerciseDetail);
const loadSnap = () => import('@/screens/Snap');
const Snap = lazy(loadSnap);
const loadSnapGallery = () => import('@/screens/SnapGallery');
const SnapGallery = lazy(loadSnapGallery);
const loadScan = () => import('@/screens/Scan');
const Scan = lazy(loadScan);
const loadVoice = () => import('@/screens/Voice');
const Voice = lazy(loadVoice);
const loadLabel = () => import('@/screens/Label');
const Label = lazy(loadLabel);

/** Every lazy screen, warmed in the background once the app is up. */
const LAZY_LOADERS = [
  loadSettings,
  loadCalendarScreen,
  loadFoodEditor,
  loadImportHealth,
  loadGlobalSearch,
  loadRecipeBuilder,
  loadStreaks,
  loadPlans,
  loadCoach,
  loadMealScore,
  loadWater,
  loadSleep,
  loadWeight,
  loadWorkout,
  loadSteps,
  loadExerciseDetail,
  loadSnap,
  loadSnapGallery,
  loadScan,
  loadVoice,
  loadLabel,
];

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

  const direction = useNavDirection(location);

  useEffect(() => {
    void init();
  }, [init]);

  // Fetch the rest of the app in the background once launch has settled, so
  // later navigations are instant rather than flashing a skeleton.
  useEffect(() => {
    if (ready) prefetchWhenIdle(LAZY_LOADERS);
  }, [ready]);

  // Reset scroll between screens; without this a deep-scrolled Diet view
  // carries its offset into the next screen. Layout effect so the new screen
  // never paints at the old offset first.
  useLayoutEffect(() => {
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
      <main className={fullscreen ? '' : 'pb-nav'}>
        {/*
          Keyed on the path so each screen replays its entrance, in the
          direction of travel: deeper screens slide in from the trailing edge,
          going back slides from the leading edge, tabs cross-fade. Chosen over
          the View Transitions API because a transition has to wrap the DOM
          change itself, and by the time an effect could call it React has
          committed — and this way Safari and Firefox get the same motion.
        */}
        <Suspense fallback={<RouteFallback />}>
          <div key={location.pathname} className={`route-${direction}`}>
          <Routes>
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/" element={<Home />} />
            <Route path="/diet" element={<Diet />} />
            <Route path="/calendar" element={<CalendarScreen />} />
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
      {!fullscreen && <BottomNav />}
    </div>
  );
}

/** Shown only if a screen's chunk hasn't been prefetched yet — deliberately quiet. */
function RouteFallback() {
  return (
    <div className="mx-auto w-full max-w-lg space-y-3 px-4 pt-safe">
      <Skeleton className="mt-3 h-10 w-40 rounded-xl" />
      <Skeleton className="h-44 w-full rounded-3xl" />
      <Skeleton className="h-28 w-full rounded-3xl" />
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
