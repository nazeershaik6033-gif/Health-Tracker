import type { Equipment, Exercise, ExerciseKind, MuscleGroup } from '@/types';

/**
 * Bundled offline exercise catalog.
 *
 * Stored as tuples for the same reason as the food seed: this ships in the
 * precache, and the object form roughly triples the payload for no readability
 * gain at this scale. Expanded once at startup by `seedExercises()`.
 *
 * Row: [name, kind, met, equipment, muscles, tags, defaults]
 *   - muscles: comma-separated, primary first
 *   - tags:    search aliases; the name itself is always searched
 *   - defaults: "3x10" sets×reps · "3x45s" sets×seconds · "20m" minutes
 *
 * MET values are from the 2011 Compendium of Physical Activities (Ainsworth
 * et al.). Where the Compendium has no entry for a specific lift, the value of
 * its movement class is used — 3.5 for isolation work, 5.0 for compound
 * pressing and pulling, 6.0 for heavy multi-joint work. Calories derived from
 * these are estimates; resistance-training expenditure varies far more between
 * people than steady-state cardio does.
 */
type Row = [string, ExerciseKind, number, Equipment, string, string, string];

const ROWS: Row[] = [
  // ------------------------------------------------------------------ chest
  ['Barbell Bench Press', 'strength', 5, 'barbell', 'chest,triceps,shoulders', 'bench,press,flat', '4x8'],
  ['Incline Barbell Bench Press', 'strength', 5, 'barbell', 'chest,shoulders,triceps', 'incline,press', '4x8'],
  ['Decline Barbell Bench Press', 'strength', 5, 'barbell', 'chest,triceps', 'decline,press', '3x10'],
  ['Dumbbell Bench Press', 'strength', 5, 'dumbbell', 'chest,triceps,shoulders', 'db,press,flat', '4x10'],
  ['Incline Dumbbell Press', 'strength', 5, 'dumbbell', 'chest,shoulders,triceps', 'incline,db,press', '4x10'],
  ['Decline Dumbbell Press', 'strength', 5, 'dumbbell', 'chest,triceps', 'decline,db', '3x10'],
  ['Dumbbell Fly', 'strength', 3.5, 'dumbbell', 'chest', 'fly,flye,pec', '3x12'],
  ['Incline Dumbbell Fly', 'strength', 3.5, 'dumbbell', 'chest,shoulders', 'fly,flye,incline', '3x12'],
  ['Cable Crossover', 'strength', 3.5, 'cable', 'chest', 'crossover,fly,pec', '3x15'],
  ['Cable Chest Press', 'strength', 4.5, 'cable', 'chest,triceps', 'press', '3x12'],
  ['Pec Deck Machine', 'strength', 3.5, 'machine', 'chest', 'pec deck,fly,butterfly', '3x12'],
  ['Chest Press Machine', 'strength', 4.5, 'machine', 'chest,triceps', 'press', '3x12'],
  ['Push-up', 'strength', 3.8, 'bodyweight', 'chest,triceps,core', 'pushup,press up', '3x15'],
  ['Wide-Grip Push-up', 'strength', 3.8, 'bodyweight', 'chest,shoulders', 'pushup,wide', '3x15'],
  ['Diamond Push-up', 'strength', 4, 'bodyweight', 'triceps,chest', 'pushup,close grip', '3x12'],
  ['Decline Push-up', 'strength', 4, 'bodyweight', 'chest,shoulders', 'pushup,feet elevated', '3x12'],
  ['Incline Push-up', 'strength', 3.5, 'bodyweight', 'chest,triceps', 'pushup,easy', '3x15'],
  ['Chest Dip', 'strength', 5, 'bodyweight', 'chest,triceps', 'dip,parallel bars', '3x10'],
  ['Svend Press', 'strength', 3.5, 'dumbbell', 'chest', 'plate press,squeeze', '3x15'],
  ['Landmine Press', 'strength', 4.5, 'barbell', 'chest,shoulders', 'landmine', '3x10'],

  // ------------------------------------------------------------------- back
  ['Deadlift', 'strength', 6, 'barbell', 'hamstrings,back,glutes', 'dl,conventional,pull', '4x5'],
  ['Sumo Deadlift', 'strength', 6, 'barbell', 'glutes,quads,back', 'dl,sumo', '4x5'],
  ['Trap Bar Deadlift', 'strength', 6, 'barbell', 'quads,glutes,back', 'hex bar,dl', '4x6'],
  ['Rack Pull', 'strength', 6, 'barbell', 'back,glutes', 'partial deadlift', '3x6'],
  ['Barbell Row', 'strength', 5, 'barbell', 'back,biceps', 'row,bent over,bor', '4x10'],
  ['Pendlay Row', 'strength', 5.5, 'barbell', 'back,biceps', 'row,explosive', '4x6'],
  ['T-Bar Row', 'strength', 5, 'machine', 'back,biceps', 'row,tbar', '3x10'],
  ['Dumbbell Row', 'strength', 5, 'dumbbell', 'back,biceps', 'row,one arm,single arm', '3x12'],
  ['Chest-Supported Row', 'strength', 4.5, 'machine', 'back,biceps', 'row,incline', '3x12'],
  ['Seated Cable Row', 'strength', 4.5, 'cable', 'back,biceps', 'row,seated', '3x12'],
  ['Lat Pulldown', 'strength', 4.5, 'cable', 'back,biceps', 'pulldown,lats', '3x12'],
  ['Close-Grip Lat Pulldown', 'strength', 4.5, 'cable', 'back,biceps', 'pulldown,v bar', '3x12'],
  ['Straight-Arm Pulldown', 'strength', 3.5, 'cable', 'back', 'pullover,lats', '3x15'],
  ['Pull-up', 'strength', 8, 'bodyweight', 'back,biceps', 'pullup,chin,overhand', '3x8'],
  ['Chin-up', 'strength', 8, 'bodyweight', 'biceps,back', 'chinup,underhand', '3x8'],
  ['Neutral-Grip Pull-up', 'strength', 8, 'bodyweight', 'back,biceps', 'pullup,hammer grip', '3x8'],
  ['Assisted Pull-up', 'strength', 5, 'machine', 'back,biceps', 'pullup,assisted', '3x10'],
  ['Inverted Row', 'strength', 4.5, 'bodyweight', 'back,biceps', 'row,australian pullup', '3x12'],
  ['Face Pull', 'strength', 3.5, 'cable', 'shoulders,back', 'rear delt,rope', '3x15'],
  ['Barbell Shrug', 'strength', 4, 'barbell', 'back,shoulders', 'shrug,traps', '3x15'],
  ['Dumbbell Shrug', 'strength', 4, 'dumbbell', 'back,shoulders', 'shrug,traps', '3x15'],
  ['Dumbbell Pullover', 'strength', 4, 'dumbbell', 'back,chest', 'pullover', '3x12'],
  ['Good Morning', 'strength', 5, 'barbell', 'hamstrings,back,glutes', 'gm,hinge', '3x10'],
  ['Back Extension', 'strength', 4, 'bodyweight', 'back,glutes,hamstrings', 'hyperextension,45 degree', '3x15'],

  // -------------------------------------------------------------- shoulders
  ['Overhead Press', 'strength', 5, 'barbell', 'shoulders,triceps', 'ohp,military,strict press', '4x8'],
  ['Push Press', 'strength', 6, 'barbell', 'shoulders,triceps,quads', 'push,overhead', '4x6'],
  ['Seated Dumbbell Press', 'strength', 5, 'dumbbell', 'shoulders,triceps', 'db press,overhead', '3x10'],
  ['Arnold Press', 'strength', 5, 'dumbbell', 'shoulders,triceps', 'arnold,rotate', '3x10'],
  ['Shoulder Press Machine', 'strength', 4.5, 'machine', 'shoulders,triceps', 'press,overhead', '3x12'],
  ['Lateral Raise', 'strength', 3.5, 'dumbbell', 'shoulders', 'side raise,lat raise,delt', '3x15'],
  ['Cable Lateral Raise', 'strength', 3.5, 'cable', 'shoulders', 'side raise,delt', '3x15'],
  ['Front Raise', 'strength', 3.5, 'dumbbell', 'shoulders', 'front delt', '3x12'],
  ['Rear Delt Fly', 'strength', 3.5, 'dumbbell', 'shoulders,back', 'reverse fly,rear delt', '3x15'],
  ['Reverse Pec Deck', 'strength', 3.5, 'machine', 'shoulders,back', 'rear delt,reverse fly', '3x15'],
  ['Upright Row', 'strength', 4, 'barbell', 'shoulders,back', 'upright,traps', '3x12'],
  ['Landmine Lateral Raise', 'strength', 3.5, 'barbell', 'shoulders', 'landmine,delt', '3x12'],
  ['Handstand Push-up', 'strength', 8, 'bodyweight', 'shoulders,triceps', 'hspu,handstand', '3x6'],
  ['Pike Push-up', 'strength', 5, 'bodyweight', 'shoulders,triceps', 'pike,shoulder pushup', '3x10'],
  ['Cuban Press', 'strength', 3.5, 'dumbbell', 'shoulders', 'rotator cuff,cuban', '3x12'],
  ['Bradford Press', 'strength', 4.5, 'barbell', 'shoulders', 'bradford,overhead', '3x10'],
  ['Behind-the-Neck Press', 'strength', 5, 'barbell', 'shoulders,triceps', 'btn press', '3x8'],
  ['Z Press', 'strength', 5, 'barbell', 'shoulders,core', 'seated overhead', '3x8'],
  ['Kettlebell Overhead Press', 'strength', 5, 'kettlebell', 'shoulders,triceps', 'kb press', '3x10'],
  ['Band Pull-Apart', 'strength', 3, 'band', 'shoulders,back', 'band,rear delt', '3x20'],

  // ----------------------------------------------------------------- biceps
  ['Barbell Curl', 'strength', 3.5, 'barbell', 'biceps', 'curl,bicep', '3x10'],
  ['EZ-Bar Curl', 'strength', 3.5, 'barbell', 'biceps', 'curl,ez bar', '3x12'],
  ['Dumbbell Curl', 'strength', 3.5, 'dumbbell', 'biceps', 'curl,bicep', '3x12'],
  ['Alternating Dumbbell Curl', 'strength', 3.5, 'dumbbell', 'biceps', 'curl,alternate', '3x12'],
  ['Hammer Curl', 'strength', 3.5, 'dumbbell', 'biceps', 'curl,neutral,brachialis', '3x12'],
  ['Incline Dumbbell Curl', 'strength', 3.5, 'dumbbell', 'biceps', 'curl,incline', '3x12'],
  ['Preacher Curl', 'strength', 3.5, 'barbell', 'biceps', 'curl,preacher,scott', '3x12'],
  ['Concentration Curl', 'strength', 3.5, 'dumbbell', 'biceps', 'curl,concentration', '3x12'],
  ['Cable Curl', 'strength', 3.5, 'cable', 'biceps', 'curl,cable', '3x15'],
  ['Spider Curl', 'strength', 3.5, 'dumbbell', 'biceps', 'curl,spider', '3x12'],
  ['Zottman Curl', 'strength', 3.5, 'dumbbell', 'biceps', 'curl,zottman', '3x12'],
  ['Band Curl', 'strength', 3, 'band', 'biceps', 'curl,band', '3x20'],

  // ---------------------------------------------------------------- triceps
  ['Close-Grip Bench Press', 'strength', 5, 'barbell', 'triceps,chest', 'cgbp,press', '3x10'],
  ['Skull Crusher', 'strength', 3.5, 'barbell', 'triceps', 'lying extension,skullcrusher', '3x12'],
  ['Triceps Pushdown', 'strength', 3.5, 'cable', 'triceps', 'pushdown,rope,cable', '3x15'],
  ['Rope Pushdown', 'strength', 3.5, 'cable', 'triceps', 'pushdown,rope', '3x15'],
  ['Overhead Triceps Extension', 'strength', 3.5, 'dumbbell', 'triceps', 'french press,overhead', '3x12'],
  ['Cable Overhead Extension', 'strength', 3.5, 'cable', 'triceps', 'overhead,rope', '3x15'],
  ['Triceps Kickback', 'strength', 3.5, 'dumbbell', 'triceps', 'kickback', '3x15'],
  ['Triceps Dip', 'strength', 5, 'bodyweight', 'triceps,chest', 'dip,parallel bars', '3x12'],
  ['Bench Dip', 'strength', 4, 'bodyweight', 'triceps', 'dip,bench', '3x15'],
  ['JM Press', 'strength', 4.5, 'barbell', 'triceps', 'jm press', '3x10'],
  ['Tate Press', 'strength', 3.5, 'dumbbell', 'triceps', 'tate', '3x12'],
  ['Single-Arm Pushdown', 'strength', 3.5, 'cable', 'triceps', 'pushdown,one arm', '3x15'],
  ['Machine Triceps Extension', 'strength', 3.5, 'machine', 'triceps', 'extension,machine', '3x12'],
  ['Band Pushdown', 'strength', 3, 'band', 'triceps', 'pushdown,band', '3x20'],

  // --------------------------------------------------------------- forearms
  ['Wrist Curl', 'strength', 3, 'barbell', 'biceps', 'forearm,wrist', '3x20'],
  ['Reverse Wrist Curl', 'strength', 3, 'barbell', 'biceps', 'forearm,wrist,extensor', '3x20'],
  ['Reverse Curl', 'strength', 3.5, 'barbell', 'biceps', 'forearm,reverse', '3x15'],
  ['Farmer Walk', 'strength', 6, 'dumbbell', 'fullbody,core', 'carry,farmers,grip', '3x60s'],
  ['Dead Hang', 'strength', 4, 'bodyweight', 'back,biceps', 'hang,grip', '3x45s'],

  // ------------------------------------------------------------------ quads
  ['Barbell Squat', 'strength', 6, 'barbell', 'quads,glutes,core', 'squat,back squat', '4x8'],
  ['Front Squat', 'strength', 6, 'barbell', 'quads,core,glutes', 'squat,front', '4x6'],
  ['Box Squat', 'strength', 5.5, 'barbell', 'quads,glutes', 'squat,box', '4x8'],
  ['Pause Squat', 'strength', 6, 'barbell', 'quads,glutes', 'squat,pause', '3x6'],
  ['Goblet Squat', 'strength', 5, 'dumbbell', 'quads,glutes,core', 'squat,goblet', '3x12'],
  ['Hack Squat', 'strength', 5.5, 'machine', 'quads,glutes', 'squat,hack', '3x10'],
  ['Leg Press', 'strength', 5, 'machine', 'quads,glutes', 'press,leg', '3x12'],
  ['Bulgarian Split Squat', 'strength', 5.5, 'dumbbell', 'quads,glutes', 'split squat,rear foot elevated', '3x10'],
  ['Walking Lunge', 'strength', 5, 'dumbbell', 'quads,glutes', 'lunge,walking', '3x12'],
  ['Reverse Lunge', 'strength', 5, 'dumbbell', 'quads,glutes', 'lunge,reverse', '3x12'],
  ['Forward Lunge', 'strength', 5, 'dumbbell', 'quads,glutes', 'lunge', '3x12'],
  ['Lateral Lunge', 'strength', 5, 'dumbbell', 'quads,glutes', 'lunge,side', '3x12'],
  ['Step-up', 'strength', 5, 'dumbbell', 'quads,glutes', 'step up,box', '3x12'],
  ['Leg Extension', 'strength', 3.5, 'machine', 'quads', 'extension,quad', '3x15'],
  ['Sissy Squat', 'strength', 4.5, 'bodyweight', 'quads', 'sissy', '3x12'],
  ['Wall Sit', 'strength', 4, 'bodyweight', 'quads', 'wall sit,isometric', '3x45s'],
  ['Bodyweight Squat', 'strength', 4, 'bodyweight', 'quads,glutes', 'air squat,squat', '3x20'],
  ['Jump Squat', 'strength', 7, 'bodyweight', 'quads,glutes', 'plyo,jump', '3x12'],
  ['Pistol Squat', 'strength', 6, 'bodyweight', 'quads,glutes,core', 'single leg squat', '3x6'],
  ['Zercher Squat', 'strength', 6, 'barbell', 'quads,core', 'zercher', '3x8'],

  // ------------------------------------------------------------- hamstrings
  ['Romanian Deadlift', 'strength', 5.5, 'barbell', 'hamstrings,glutes,back', 'rdl,hinge', '4x10'],
  ['Dumbbell Romanian Deadlift', 'strength', 5, 'dumbbell', 'hamstrings,glutes', 'rdl,db', '3x12'],
  ['Stiff-Leg Deadlift', 'strength', 5.5, 'barbell', 'hamstrings,glutes', 'sldl,straight leg', '3x10'],
  ['Single-Leg Romanian Deadlift', 'strength', 5, 'dumbbell', 'hamstrings,glutes', 'sl rdl,balance', '3x10'],
  ['Lying Leg Curl', 'strength', 3.5, 'machine', 'hamstrings', 'curl,leg curl', '3x15'],
  ['Seated Leg Curl', 'strength', 3.5, 'machine', 'hamstrings', 'curl,leg curl', '3x15'],
  ['Nordic Hamstring Curl', 'strength', 5, 'bodyweight', 'hamstrings', 'nordic,eccentric', '3x6'],
  ['Glute Ham Raise', 'strength', 5, 'machine', 'hamstrings,glutes', 'ghr,ghd', '3x10'],
  ['Cable Pull-Through', 'strength', 4, 'cable', 'glutes,hamstrings', 'pull through,hinge', '3x15'],
  ['Kettlebell Swing', 'strength', 6, 'kettlebell', 'glutes,hamstrings,core', 'swing,kb,hinge', '3x20'],
  ['Slider Leg Curl', 'strength', 4, 'bodyweight', 'hamstrings', 'slider,curl', '3x12'],
  ['Back Extension (Hamstring Bias)', 'strength', 4, 'bodyweight', 'hamstrings,glutes', 'hyperextension', '3x15'],

  // ----------------------------------------------------------------- glutes
  ['Hip Thrust', 'strength', 5, 'barbell', 'glutes,hamstrings', 'thrust,bridge', '4x12'],
  ['Barbell Glute Bridge', 'strength', 5, 'barbell', 'glutes,hamstrings', 'bridge', '3x15'],
  ['Single-Leg Hip Thrust', 'strength', 4.5, 'bodyweight', 'glutes', 'thrust,single leg', '3x12'],
  ['Glute Bridge', 'strength', 3.5, 'bodyweight', 'glutes,hamstrings', 'bridge', '3x20'],
  ['Cable Kickback', 'strength', 3.5, 'cable', 'glutes', 'kickback,glute', '3x15'],
  ['Hip Abduction Machine', 'strength', 3.5, 'machine', 'glutes', 'abduction,seated', '3x20'],
  ['Banded Lateral Walk', 'strength', 3.5, 'band', 'glutes', 'monster walk,crab walk', '3x20'],
  ['Clamshell', 'strength', 3, 'band', 'glutes', 'clamshell,hip', '3x20'],
  ['Frog Pump', 'strength', 3.5, 'bodyweight', 'glutes', 'frog,pump', '3x25'],
  ['Sumo Squat', 'strength', 5.5, 'dumbbell', 'glutes,quads', 'squat,sumo,wide', '3x12'],
  ['Curtsy Lunge', 'strength', 5, 'dumbbell', 'glutes,quads', 'lunge,curtsy', '3x12'],
  ['Step-up (Glute Bias)', 'strength', 5, 'dumbbell', 'glutes,quads', 'step up,high box', '3x12'],
  ['Donkey Kick', 'strength', 3, 'bodyweight', 'glutes', 'kickback,donkey', '3x20'],
  ['Fire Hydrant', 'strength', 3, 'bodyweight', 'glutes', 'hydrant,hip', '3x20'],

  // ----------------------------------------------------------------- calves
  ['Standing Calf Raise', 'strength', 3.5, 'machine', 'calves', 'calf,raise,standing', '4x15'],
  ['Seated Calf Raise', 'strength', 3.5, 'machine', 'calves', 'calf,raise,seated,soleus', '4x15'],
  ['Dumbbell Calf Raise', 'strength', 3.5, 'dumbbell', 'calves', 'calf,raise', '3x20'],
  ['Smith Machine Calf Raise', 'strength', 3.5, 'machine', 'calves', 'calf,raise,smith', '4x15'],
  ['Single-Leg Calf Raise', 'strength', 3.5, 'bodyweight', 'calves', 'calf,raise,single', '3x15'],
  ['Leg Press Calf Raise', 'strength', 3.5, 'machine', 'calves', 'calf,raise,leg press', '4x15'],
  ['Donkey Calf Raise', 'strength', 3.5, 'machine', 'calves', 'calf,raise,donkey', '3x15'],
  ['Jump Rope Calf Bounce', 'cardio', 8, 'bodyweight', 'calves', 'skipping,bounce', '5m'],

  // ------------------------------------------------------------------- core
  ['Plank', 'strength', 3, 'bodyweight', 'core', 'plank,hold,front plank', '3x45s'],
  ['Side Plank', 'strength', 3, 'bodyweight', 'core', 'plank,side,oblique', '3x30s'],
  ['RKC Plank', 'strength', 4, 'bodyweight', 'core', 'plank,hard style', '3x20s'],
  ['Crunch', 'strength', 3, 'bodyweight', 'core', 'crunch,abs,sit up', '3x20'],
  ['Sit-up', 'strength', 3.8, 'bodyweight', 'core', 'situp,abs', '3x20'],
  ['Bicycle Crunch', 'strength', 3.8, 'bodyweight', 'core', 'crunch,bicycle,oblique', '3x20'],
  ['Reverse Crunch', 'strength', 3.5, 'bodyweight', 'core', 'crunch,reverse,lower abs', '3x15'],
  ['Leg Raise', 'strength', 3.5, 'bodyweight', 'core', 'leg raise,lying', '3x15'],
  ['Hanging Leg Raise', 'strength', 5, 'bodyweight', 'core', 'hanging,leg raise,abs', '3x12'],
  ['Hanging Knee Raise', 'strength', 4.5, 'bodyweight', 'core', 'hanging,knee raise', '3x15'],
  ['Toes to Bar', 'strength', 6, 'bodyweight', 'core', 't2b,crossfit,hanging', '3x10'],
  ['Cable Crunch', 'strength', 3.5, 'cable', 'core', 'crunch,kneeling,cable', '3x15'],
  ['Ab Wheel Rollout', 'strength', 4.5, 'other', 'core', 'ab wheel,rollout', '3x12'],
  ['Russian Twist', 'strength', 3.5, 'bodyweight', 'core', 'twist,oblique', '3x20'],
  ['Mountain Climber', 'cardio', 8, 'bodyweight', 'core,fullbody', 'climber,cardio', '3x30s'],
  ['Dead Bug', 'strength', 3, 'bodyweight', 'core', 'dead bug,stability', '3x12'],
  ['Bird Dog', 'strength', 3, 'bodyweight', 'core,back', 'bird dog,stability', '3x12'],
  ['Hollow Body Hold', 'strength', 3.5, 'bodyweight', 'core', 'hollow,hold,gymnastics', '3x30s'],
  ['V-up', 'strength', 4, 'bodyweight', 'core', 'v up,abs', '3x15'],
  ['Flutter Kick', 'strength', 3.5, 'bodyweight', 'core', 'flutter,kick', '3x30s'],
  ['Pallof Press', 'strength', 3.5, 'cable', 'core', 'pallof,anti rotation', '3x12'],
  ['Woodchopper', 'strength', 4, 'cable', 'core', 'chop,rotation', '3x15'],
  ['Landmine Twist', 'strength', 4.5, 'barbell', 'core', 'landmine,twist,rotation', '3x12'],
  ['Suitcase Carry', 'strength', 5, 'dumbbell', 'core,fullbody', 'carry,suitcase', '3x45s'],

  // ------------------------------------------------- full body / functional
  ['Clean and Jerk', 'strength', 8, 'barbell', 'fullbody', 'olympic,clean,jerk', '5x3'],
  ['Power Clean', 'strength', 8, 'barbell', 'fullbody', 'olympic,clean', '5x3'],
  ['Hang Clean', 'strength', 7.5, 'barbell', 'fullbody', 'olympic,clean,hang', '4x4'],
  ['Snatch', 'strength', 8, 'barbell', 'fullbody', 'olympic,snatch', '5x3'],
  ['Power Snatch', 'strength', 8, 'barbell', 'fullbody', 'olympic,snatch', '5x3'],
  ['Thruster', 'strength', 8, 'barbell', 'fullbody,quads,shoulders', 'thruster,crossfit', '3x10'],
  ['Burpee', 'cardio', 8, 'bodyweight', 'fullbody', 'burpee,conditioning', '3x15'],
  ['Burpee Box Jump', 'cardio', 9, 'bodyweight', 'fullbody', 'burpee,box jump', '3x10'],
  ['Box Jump', 'strength', 7, 'bodyweight', 'quads,glutes', 'plyo,box jump', '4x8'],
  ['Battle Ropes', 'cardio', 8, 'other', 'fullbody,shoulders', 'ropes,conditioning', '5m'],
  ['Sled Push', 'strength', 8, 'machine', 'fullbody,quads', 'prowler,sled', '5x20s'],
  ['Sled Pull', 'strength', 8, 'machine', 'fullbody,back', 'sled,drag', '5x20s'],
  ['Tire Flip', 'strength', 8, 'other', 'fullbody', 'tire,strongman', '4x8'],
  ['Turkish Get-up', 'strength', 5, 'kettlebell', 'fullbody,core', 'tgu,get up', '3x5'],
  ['Kettlebell Clean and Press', 'strength', 6, 'kettlebell', 'fullbody,shoulders', 'kb,clean press', '3x10'],
  ['Kettlebell Snatch', 'strength', 8, 'kettlebell', 'fullbody', 'kb,snatch', '3x10'],
  ['Man Maker', 'strength', 8, 'dumbbell', 'fullbody', 'man maker,complex', '3x8'],
  ['Wall Ball', 'cardio', 8, 'other', 'fullbody,quads', 'wall ball,crossfit', '3x20'],

  // -------------------------------------------------------- cardio machines
  ['Treadmill Run', 'cardio', 9.8, 'machine', 'fullbody', 'run,jog,treadmill', '20m'],
  ['Treadmill Walk', 'cardio', 3.5, 'machine', 'fullbody', 'walk,treadmill', '30m'],
  ['Treadmill Incline Walk', 'cardio', 6, 'machine', 'quads,glutes', 'incline,walk,hill', '25m'],
  ['Stationary Bike', 'cardio', 7.5, 'machine', 'quads,calves', 'bike,cycling,spin', '30m'],
  ['Spin Class', 'cardio', 8.5, 'machine', 'quads,glutes', 'spin,rpm,cycling', '45m'],
  ['Rowing Machine', 'cardio', 7, 'machine', 'fullbody,back', 'row,erg,concept2', '20m'],
  ['Elliptical', 'cardio', 6.5, 'machine', 'fullbody', 'elliptical,cross trainer', '25m'],
  ['Stair Climber', 'cardio', 9, 'machine', 'quads,glutes', 'stairmaster,stairs', '20m'],
  ['Ski Erg', 'cardio', 7, 'machine', 'fullbody,back', 'ski,erg', '15m'],
  ['Assault Bike', 'cardio', 9, 'machine', 'fullbody', 'air bike,assault,echo', '15m'],
  ['Arm Ergometer', 'cardio', 5, 'machine', 'shoulders,back', 'arm bike,upper body', '15m'],
  ['Versaclimber', 'cardio', 9, 'machine', 'fullbody', 'climber,vertical', '15m'],
  ['Jacob’s Ladder', 'cardio', 9, 'machine', 'fullbody', 'ladder,climb', '15m'],
  ['Recumbent Bike', 'cardio', 5.5, 'machine', 'quads', 'bike,recumbent', '30m'],

  // ----------------------------------------------------------- outdoor cardio
  ['Running (easy)', 'cardio', 8.3, 'bodyweight', 'fullbody', 'run,jog,easy pace', '30m'],
  ['Running (moderate)', 'cardio', 9.8, 'bodyweight', 'fullbody', 'run,jog', '30m'],
  ['Running (fast)', 'cardio', 11.8, 'bodyweight', 'fullbody', 'run,tempo,fast', '25m'],
  ['Sprinting', 'cardio', 14, 'bodyweight', 'fullbody', 'sprint,intervals', '15m'],
  ['Trail Running', 'cardio', 10, 'bodyweight', 'fullbody', 'trail,run,offroad', '40m'],
  ['Walking', 'cardio', 3.5, 'bodyweight', 'fullbody', 'walk,stroll', '30m'],
  ['Brisk Walking', 'cardio', 4.3, 'bodyweight', 'fullbody', 'walk,brisk,power walk', '30m'],
  ['Hiking', 'cardio', 6, 'bodyweight', 'fullbody,quads', 'hike,trek', '60m'],
  ['Cycling (leisure)', 'cardio', 5.8, 'other', 'quads', 'bike,cycle,leisure', '40m'],
  ['Cycling (moderate)', 'cardio', 7.5, 'other', 'quads,calves', 'bike,cycle', '40m'],
  ['Cycling (vigorous)', 'cardio', 10, 'other', 'quads,glutes', 'bike,cycle,fast', '40m'],
  ['Stair Climbing', 'cardio', 8, 'bodyweight', 'quads,glutes', 'stairs,steps', '15m'],

  // ---------------------------------------------------- swimming & water
  ['Swimming (freestyle)', 'cardio', 8.3, 'bodyweight', 'fullbody', 'swim,front crawl', '30m'],
  ['Swimming (breaststroke)', 'cardio', 8.3, 'bodyweight', 'fullbody', 'swim,breast', '30m'],
  ['Swimming (backstroke)', 'cardio', 7, 'bodyweight', 'fullbody,back', 'swim,back', '30m'],
  ['Swimming (butterfly)', 'cardio', 13.8, 'bodyweight', 'fullbody', 'swim,fly', '20m'],
  ['Aqua Aerobics', 'cardio', 5.5, 'bodyweight', 'fullbody', 'water aerobics,pool', '45m'],

  // --------------------------------------------------------- calisthenics
  ['Muscle-up', 'strength', 8, 'bodyweight', 'back,chest,triceps', 'muscle up,bar', '3x5'],
  ['Ring Dip', 'strength', 6, 'bodyweight', 'chest,triceps', 'rings,dip', '3x8'],
  ['Ring Row', 'strength', 4.5, 'bodyweight', 'back,biceps', 'rings,row', '3x12'],
  ['L-Sit', 'strength', 4, 'bodyweight', 'core', 'l sit,hold', '3x20s'],
  ['Front Lever Hold', 'strength', 6, 'bodyweight', 'back,core', 'front lever,hold', '3x10s'],
  ['Back Lever Hold', 'strength', 6, 'bodyweight', 'back,chest', 'back lever,hold', '3x10s'],
  ['Planche Lean', 'strength', 5, 'bodyweight', 'shoulders,core', 'planche,lean', '3x20s'],
  ['Handstand Hold', 'strength', 4, 'bodyweight', 'shoulders,core', 'handstand,hold', '3x30s'],
  ['Archer Push-up', 'strength', 5, 'bodyweight', 'chest,triceps', 'archer,pushup', '3x10'],
  ['Explosive Push-up', 'strength', 6, 'bodyweight', 'chest,triceps', 'clap pushup,plyo', '3x10'],
  ['Bar Hang Knee Tuck', 'strength', 4.5, 'bodyweight', 'core', 'tuck,hanging', '3x15'],
  ['Skin the Cat', 'strength', 5, 'bodyweight', 'back,core', 'rings,skin the cat', '3x5'],
  ['Bear Crawl', 'cardio', 6, 'bodyweight', 'fullbody,core', 'crawl,bear', '3x30s'],
  ['Crab Walk', 'cardio', 5, 'bodyweight', 'fullbody', 'crab,walk', '3x30s'],

  // ------------------------------------------------------- yoga & mobility
  ['Surya Namaskar', 'flexibility', 4, 'bodyweight', 'fullbody', 'yoga,sun salutation', '15m'],
  ['Hatha Yoga', 'flexibility', 2.5, 'bodyweight', 'fullbody', 'yoga,hatha,gentle', '45m'],
  ['Vinyasa Yoga', 'flexibility', 4, 'bodyweight', 'fullbody', 'yoga,flow,vinyasa', '45m'],
  ['Power Yoga', 'flexibility', 4, 'bodyweight', 'fullbody', 'yoga,power,ashtanga', '45m'],
  ['Yin Yoga', 'flexibility', 2.3, 'bodyweight', 'fullbody', 'yoga,yin,restorative', '45m'],
  ['Pilates', 'flexibility', 3, 'bodyweight', 'core', 'pilates,mat', '45m'],
  ['Static Stretching', 'flexibility', 2.3, 'bodyweight', 'fullbody', 'stretch,cooldown', '10m'],
  ['Dynamic Warm-up', 'flexibility', 3.5, 'bodyweight', 'fullbody', 'warmup,mobility,dynamic', '10m'],
  ['Foam Rolling', 'flexibility', 2.3, 'other', 'fullbody', 'foam roll,myofascial,smr', '10m'],
  ['Hip Flexor Stretch', 'flexibility', 2.3, 'bodyweight', 'quads', 'stretch,hip flexor', '3x30s'],
  ['Hamstring Stretch', 'flexibility', 2.3, 'bodyweight', 'hamstrings', 'stretch,hamstring', '3x30s'],
  ['Pigeon Pose', 'flexibility', 2.3, 'bodyweight', 'glutes', 'yoga,pigeon,stretch', '3x45s'],
  ['Downward Dog', 'flexibility', 2.5, 'bodyweight', 'fullbody', 'yoga,down dog', '3x30s'],
  ['Child’s Pose', 'flexibility', 2, 'bodyweight', 'back', 'yoga,balasana,rest', '3x45s'],
  ['Cat-Cow', 'flexibility', 2.3, 'bodyweight', 'back,core', 'yoga,spine,mobility', '3x30s'],
  ['Thoracic Rotation', 'flexibility', 2.3, 'bodyweight', 'back', 'mobility,t spine', '3x30s'],
  ['Shoulder Dislocate', 'flexibility', 2.3, 'band', 'shoulders', 'mobility,pass through', '3x15'],
  ['90/90 Hip Stretch', 'flexibility', 2.3, 'bodyweight', 'glutes', 'mobility,hip,9090', '3x45s'],

  // ----------------------------------------------------------------- sports
  ['Cricket', 'sport', 5, 'other', 'fullbody', 'cricket,batting,bowling', '60m'],
  ['Football (soccer)', 'sport', 7, 'other', 'fullbody', 'football,soccer', '60m'],
  ['Badminton', 'sport', 5.5, 'other', 'fullbody', 'badminton,shuttle', '45m'],
  ['Tennis', 'sport', 7.3, 'other', 'fullbody', 'tennis', '60m'],
  ['Table Tennis', 'sport', 4, 'other', 'fullbody', 'ping pong,tt', '45m'],
  ['Basketball', 'sport', 6.5, 'other', 'fullbody', 'basketball,hoops', '45m'],
  ['Volleyball', 'sport', 4, 'other', 'fullbody', 'volleyball', '45m'],
  ['Squash', 'sport', 7.3, 'other', 'fullbody', 'squash', '45m'],
  ['Hockey', 'sport', 7.8, 'other', 'fullbody', 'hockey,field hockey', '60m'],
  ['Kabaddi', 'sport', 7, 'other', 'fullbody', 'kabaddi', '45m'],
  ['Boxing (bag work)', 'sport', 7.8, 'other', 'fullbody,shoulders', 'boxing,punching bag', '30m'],
  ['Boxing (sparring)', 'sport', 9, 'other', 'fullbody', 'boxing,spar', '30m'],
  ['Kickboxing', 'sport', 7.8, 'other', 'fullbody', 'kickboxing,martial arts', '45m'],
  ['Martial Arts', 'sport', 7.8, 'other', 'fullbody', 'karate,judo,taekwondo,mma', '60m'],
  ['Dancing', 'sport', 5.5, 'bodyweight', 'fullbody', 'dance,zumba', '45m'],
  ['Zumba', 'sport', 6.5, 'bodyweight', 'fullbody', 'zumba,dance fitness', '45m'],
  ['Golf (walking)', 'sport', 4.8, 'other', 'fullbody', 'golf', '120m'],
  ['Rock Climbing', 'sport', 8, 'other', 'back,biceps,core', 'climbing,bouldering', '60m'],
  ['Skipping Rope', 'cardio', 11, 'other', 'fullbody,calves', 'jump rope,skipping', '10m'],
  ['Rowing (on water)', 'sport', 7, 'other', 'fullbody,back', 'rowing,kayak', '45m'],

  // ------------------------------------------------------- daily activities
  ['Gardening', 'sport', 3.8, 'other', 'fullbody', 'garden,yard work', '45m'],
  ['House Cleaning', 'sport', 3.3, 'other', 'fullbody', 'cleaning,chores,housework', '45m'],
  ['Mopping / Sweeping', 'sport', 3.5, 'other', 'fullbody', 'mop,sweep,jhadu', '30m'],
  ['Cooking', 'sport', 2.5, 'other', 'fullbody', 'cooking,kitchen', '45m'],
  ['Grocery Shopping', 'sport', 2.3, 'other', 'fullbody', 'shopping,groceries', '45m'],
  ['Climbing Stairs (home)', 'cardio', 8, 'bodyweight', 'quads,glutes', 'stairs,steps', '10m'],
  ['Playing with Children', 'sport', 4, 'other', 'fullbody', 'kids,play', '30m'],
  ['Washing the Car', 'sport', 3.5, 'other', 'fullbody', 'car wash', '30m'],
  ['Carrying Groceries', 'sport', 4, 'other', 'fullbody', 'carry,shopping bags', '15m'],
  ['Standing Desk Work', 'sport', 1.8, 'other', 'fullbody', 'standing,desk', '60m'],
  ['Manual Labour', 'sport', 5.5, 'other', 'fullbody', 'construction,lifting,work', '60m'],
  ['Cycling to Work', 'cardio', 6.8, 'other', 'quads', 'commute,bike', '25m'],
];

/** Parses "3x10" | "3x45s" | "20m" into the default fields. */
function parseDefaults(spec: string): Pick<
  Exercise,
  'defaultSets' | 'defaultReps' | 'defaultDurationMin' | 'repUnit'
> {
  const minutes = /^(\d+)m$/.exec(spec);
  if (minutes) return { defaultDurationMin: Number(minutes[1]) };

  const held = /^(\d+)x(\d+)s$/.exec(spec);
  if (held) {
    return { defaultSets: Number(held[1]), defaultReps: Number(held[2]), repUnit: 'sec' };
  }

  const reps = /^(\d+)x(\d+)$/.exec(spec);
  if (reps) {
    return { defaultSets: Number(reps[1]), defaultReps: Number(reps[2]), repUnit: 'reps' };
  }
  return {};
}

/** Stable id from the name, so re-seeding never duplicates a row. */
export function exerciseId(name: string): string {
  return `ex_${name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')}`;
}

export function seedExercises(): Exercise[] {
  return ROWS.map(([name, kind, met, equipment, muscles, tags, defaults]) => ({
    id: exerciseId(name),
    name,
    kind,
    met,
    muscles: muscles.split(',').filter(Boolean) as MuscleGroup[],
    equipment,
    tags: tags.split(',').filter(Boolean),
    source: 'seed' as const,
    useCount: 0,
    ...parseDefaults(defaults),
  }));
}

/**
 * Shown before the user has any history, so the picker opens on something
 * useful rather than an empty list. Deliberately spread across movement
 * patterns and equipment.
 */
export const STARTER_FREQUENT = [
  'Barbell Squat',
  'Barbell Bench Press',
  'Deadlift',
  'Pull-up',
  'Overhead Press',
  'Barbell Row',
  'Push-up',
  'Plank',
  'Treadmill Run',
  'Walking',
  'Cycling (moderate)',
  'Surya Namaskar',
].map(exerciseId);
