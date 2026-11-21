import type { DietType, MealSlot } from '@/types';

/**
 * Meals the offline planner composes from — each one a combination of foods
 * from the bundled catalog (`foods.seed.ts`), referenced by exact name and
 * serving label, so every planned meal carries real per-100 g figures and
 * micronutrients and can be logged as-is.
 *
 * Row: [id, name, slots, diet, parts]
 *   - slots: B breakfast, S either snack, M lunch or dinner
 *   - diet: the least restrictive diet the meal fits. `vegan` has no animal
 *     products at all; `veg` may contain dairy; `egg` adds eggs; `nonveg`
 *     adds meat and fish
 *   - parts: "Food name|serving label|qty" or "...|qty|s". `s` marks the parts
 *     scaled to hit the slot's calories — usually the staple (roti, rice,
 *     oats). Unmarked parts keep their portion: nobody wants 0.6 of an egg or
 *     a katori and a half of chutney
 *
 * A name or label that drifts from the catalog makes that meal unusable rather
 * than wrong — the planner drops it — and dev builds warn about it.
 */
type Row = [string, string, string, DietType, string[]];

const ROWS: Row[] = [
  // ------------------------------------------------------------- breakfast
  ['b_poha', 'Poha with peanuts', 'B', 'vegan', ['Poha|1 katori|1.5|s', 'Peanuts|30 g|0.5']],
  ['b_upma', 'Upma with coconut chutney', 'B', 'vegan', ['Upma|1 katori|1.5|s', 'Coconut Chutney|2 tbsp|1']],
  ['b_idli', 'Idli, sambar and chutney', 'B', 'vegan', ['Idli|1 idli|3|s', 'Sambar|1 katori|1', 'Coconut Chutney|2 tbsp|1']],
  ['b_dosa', 'Masala dosa with sambar', 'B', 'vegan', ['Masala Dosa|1 dosa|1|s', 'Sambar|1 katori|1']],
  ['b_uttapam', 'Uttapam with sambar', 'B', 'vegan', ['Uttapam|1 uttapam|1.5|s', 'Sambar|1 katori|1']],
  ['b_sprouts_toast', 'Moong sprouts with whole-wheat toast', 'B', 'vegan', ['Sprouts (moong)|1 katori|1.5', 'Tomato|1 medium|0.5', 'Bread (whole wheat)|1 slice|2|s']],
  ['b_tofu_toast', 'Tofu scramble on toast', 'B', 'vegan', ['Tofu|100 g|1.5', 'Tomato|1 medium|0.5', 'Bread (whole wheat)|1 slice|2|s']],
  ['b_pb_toast', 'Peanut butter toast and a banana', 'B', 'vegan', ['Bread (whole wheat)|1 slice|2|s', 'Peanut Butter|1 tbsp|1', 'Banana|1 medium|1']],
  ['b_oats_milk', 'Oats with milk and banana', 'B', 'veg', ['Oats (dry)|40 g|1|s', 'Milk|1 glass|1', 'Banana|1 medium|1']],
  ['b_yogurt_muesli', 'Greek yogurt with muesli and berries', 'B', 'veg', ['Greek Yogurt|1 katori|1', 'Muesli|40 g|1|s', 'Blueberries|0.25 cup|1']],
  ['b_aloo_paratha', 'Aloo paratha with curd', 'B', 'veg', ['Aloo Paratha|1 paratha|1|s', 'Curd|1 katori|1']],
  ['b_daliya', 'Daliya with milk', 'B', 'veg', ['Daliya (broken wheat)|1 katori|1|s', 'Milk|1 glass|0.75', 'Almond|5.0 almond|1']],
  ['b_paneer_toast', 'Paneer on whole-wheat toast', 'B', 'veg', ['Paneer|40 grams|1.5', 'Bread (whole wheat)|1 slice|2|s', 'Tomato|1 medium|0.5']],
  ['b_dhokla', 'Dhokla with curd', 'B', 'veg', ['Dhokla|2 pieces|1.5|s', 'Curd|0.5 katori|1']],
  ['b_omelette_toast', 'Omelette with whole-wheat toast', 'B', 'egg', ['Omelette (2 eggs)|1 omelette|1', 'Bread (whole wheat)|1 slice|2|s']],
  ['b_eggs_oats', 'Boiled eggs and oats', 'B', 'egg', ['Boiled Egg|1 large|2', 'Oats (cooked)|1 katori|1|s']],
  ['b_bhurji_roti', 'Egg bhurji with roti', 'B', 'egg', ['Egg Bhurji|1 katori|1', 'Roti / Chapati|1 roti|2|s']],

  // ---------------------------------------------------------------- snacks
  ['s_apple_almond', 'Apple and almonds', 'S', 'vegan', ['Apple|1 small (2-3/4" dia)|1', 'Almond|10 almond|1|s']],
  ['s_chana', 'Roasted chana', 'S', 'vegan', ['Roasted Chana|30 g|1|s']],
  ['s_banana_pb', 'Banana with peanut butter', 'S', 'vegan', ['Banana|1 medium|1', 'Peanut Butter|1 tbsp|1|s']],
  ['s_sprouts_chaat', 'Sprouts chaat', 'S', 'vegan', ['Sprouts (moong)|1 katori|1|s', 'Cucumber|1 medium|0.25', 'Tomato|1 medium|0.5']],
  ['s_guava_walnut', 'Guava and walnuts', 'S', 'vegan', ['Guava|1 medium|1', 'Walnut|4.0 piece(half of one)|1|s']],
  ['s_papaya_seeds', 'Papaya with pumpkin seeds', 'S', 'vegan', ['Papaya|1 katori|1', 'Pumpkin Seeds|2 tbsp|0.5|s']],
  ['s_coconut_peanuts', 'Coconut water and peanuts', 'S', 'vegan', ['Coconut Water|1 glass|1', 'Peanuts|30 g|0.5|s']],
  ['s_yogurt_berries', 'Greek yogurt with strawberries', 'S', 'veg', ['Greek Yogurt|1 katori|1|s', 'Strawberries|1 katori|0.5']],
  ['s_buttermilk_makhana', 'Buttermilk and makhana', 'S', 'veg', ['Buttermilk|1 glass|1', 'Makhana (fox nuts)|1 katori|1|s']],
  ['s_shake_banana', 'Protein shake and a banana', 'S', 'veg', ['Protein Shake (whey, water)|1 scoop|1', 'Banana|1 small(4.5" long)|1|s']],
  ['s_tea_biscuit', 'Tea with marie biscuits', 'S', 'veg', ['Tea|1.0 teacup|1', 'Biscuit (marie)|2 biscuits|1|s']],
  ['s_paneer_cubes', 'Paneer cubes with cucumber', 'S', 'veg', ['Paneer|40 grams|1|s', 'Cucumber|1 medium|0.25']],
  ['s_curd_pomegranate', 'Curd with pomegranate', 'S', 'veg', ['Curd|1 katori|1|s', 'Pomegranate|1 katori|0.5']],
  ['s_eggs', 'Boiled eggs', 'S', 'egg', ['Boiled Egg|1 large|2|s']],
  ['s_chicken_strips', 'Grilled chicken strips', 'S', 'nonveg', ['Chicken Breast (grilled)|100 g|0.75|s', 'Cucumber|1 medium|0.25']],

  // --------------------------------------------------------- lunch & dinner
  ['m_dal_rice', 'Dal, rice and sabzi', 'M', 'vegan', ['Dal (cooked)|1 katori|1', 'Rice (cooked)|1 katori|1|s', 'Mixed Veg Sabzi|1 katori|1', 'Salad (green, undressed)|1 katori|1']],
  ['m_roti_dal_bhindi', 'Roti, dal tadka and bhindi', 'M', 'vegan', ['Roti / Chapati|1 roti|2|s', 'Dal Tadka|1 katori|1', 'Bhindi Masala|1 katori|1']],
  ['m_rajma_rice', 'Rajma chawal with salad', 'M', 'vegan', ['Rajma (kidney bean curry)|1 katori|1.5', 'Rice (cooked)|1 katori|1|s', 'Salad (green, undressed)|1 katori|1']],
  ['m_chole_roti', 'Chole with roti', 'M', 'vegan', ['Chole (chickpea curry)|1 katori|1.5', 'Roti / Chapati|1 roti|2|s', 'Onion|1 medium|0.25']],
  ['m_soya_rice', 'Soya chunk curry with rice', 'M', 'vegan', ['Soya Chunks (cooked)|1 katori|1', 'Rice (cooked)|1 katori|1|s', 'Mixed Veg Sabzi|1 katori|1']],
  ['m_tofu_quinoa', 'Tofu, quinoa and broccoli bowl', 'M', 'vegan', ['Tofu|100 g|1.5', 'Quinoa (cooked)|1 katori|1|s', 'Broccoli (cooked)|1 katori|1']],
  ['m_chickpea_salad', 'Chickpea salad bowl', 'M', 'vegan', ['Chickpeas (boiled)|1 katori|1.5|s', 'Cucumber|1 medium|0.5', 'Tomato|1 medium|1', 'Spinach (raw)|1 katori|1']],
  ['m_moong_roti', 'Moong dal, roti and aloo gobi', 'M', 'vegan', ['Green Moong Dal|1 katori|1', 'Roti / Chapati|1 roti|2|s', 'Aloo Gobi|1 katori|1']],
  ['m_baingan_roti', 'Baingan bharta, dal and roti', 'M', 'vegan', ['Baingan Bharta|1 katori|1', 'Dal (cooked)|1 katori|1', 'Roti / Chapati|1 roti|2|s']],
  ['m_pasta_chickpea', 'Pasta with broccoli and chickpeas', 'M', 'vegan', ['Pasta (cooked)|1 katori|1.5|s', 'Broccoli (cooked)|1 katori|1', 'Chickpeas (boiled)|1 katori|0.5']],
  ['m_tofu_stirfry', 'Tofu stir-fry with vegetables', 'M', 'vegan', ['Tofu|100 g|2|s', 'Broccoli (cooked)|1 katori|1', 'Capsicum|1 medium|0.5']],
  ['m_palak_paneer', 'Palak paneer with roti', 'M', 'veg', ['Palak Paneer|1 katori|1', 'Roti / Chapati|1 roti|2|s', 'Salad (green, undressed)|1 katori|1']],
  ['m_paneer_dal', 'Paneer tikka, dal and roti', 'M', 'veg', ['Paneer|40 grams|1.5', 'Dal (cooked)|1 katori|1', 'Roti / Chapati|1 roti|2|s']],
  ['m_sambar_rice', 'Sambar rice with curd', 'M', 'veg', ['Sambar|1 katori|1.5', 'Rice (cooked)|1 katori|1|s', 'Curd|0.5 katori|1']],
  ['m_khichdi', 'Khichdi with curd and papad', 'M', 'veg', ['Khichdi|1 katori|2|s', 'Curd|0.5 katori|1', 'Papad (roasted)|1 papad|1']],
  ['m_pulao_raita', 'Veg pulao with curd', 'M', 'veg', ['Veg Pulao|1 katori|1.5|s', 'Curd|1 katori|1']],
  ['m_soup_sandwich', 'Veg soup and sandwich', 'M', 'veg', ['Soup (veg clear)|1 bowl|1', 'Sandwich (veg)|1 sandwich|1|s']],
  ['m_paneer_salad', 'Paneer tikka salad', 'M', 'veg', ['Paneer|1 katori|1|s', 'Salad (green, undressed)|1 bowl|1', 'Capsicum|1 medium|0.5']],
  ['m_bhurji_roti', 'Egg bhurji, roti and salad', 'M', 'egg', ['Egg Bhurji|1 katori|1', 'Roti / Chapati|1 roti|2|s', 'Salad (green, undressed)|1 katori|1']],
  ['m_omelette_dal', 'Omelette, dal and rice', 'M', 'egg', ['Omelette (2 eggs)|1 omelette|1', 'Dal (cooked)|1 katori|1', 'Rice (cooked)|1 katori|1|s']],
  ['m_omelette_sabzi', 'Omelette with sabzi and salad', 'M', 'egg', ['Omelette (2 eggs)|1 omelette|1|s', 'Mixed Veg Sabzi|1 katori|1', 'Salad (green, undressed)|1 katori|1']],
  ['m_chicken_rice', 'Chicken curry with rice', 'M', 'nonveg', ['Chicken Curry|1 katori|1', 'Rice (cooked)|1 katori|1|s', 'Salad (green, undressed)|1 katori|1']],
  ['m_chicken_roti', 'Chicken curry with roti', 'M', 'nonveg', ['Chicken Curry|1 katori|1', 'Roti / Chapati|1 roti|2|s', 'Cucumber|1 medium|0.5']],
  ['m_chicken_quinoa', 'Grilled chicken, quinoa and broccoli', 'M', 'nonveg', ['Chicken Breast (grilled)|1 piece|1', 'Quinoa (cooked)|1 katori|1|s', 'Broccoli (cooked)|1 katori|1']],
  ['m_chicken_veg', 'Grilled chicken with sabzi', 'M', 'nonveg', ['Chicken Breast (grilled)|1 piece|1|s', 'Mixed Veg Sabzi|1 katori|1', 'Salad (green, undressed)|1 katori|1']],
  ['m_fish_rice', 'Fish curry with rice', 'M', 'nonveg', ['Fish Curry|1 katori|1', 'Rice (cooked)|1 katori|1|s', 'Salad (green, undressed)|1 katori|1']],
  ['m_fish_potato', 'Grilled fish with sweet potato', 'M', 'nonveg', ['Fish (grilled)|100 g|1.5', 'Sweet Potato (boiled)|1 medium|1|s', 'Salad (green, undressed)|1 katori|1']],
  ['m_tandoori_roti', 'Tandoori chicken, roti and salad', 'M', 'nonveg', ['Tandoori Chicken|1 piece|1.5', 'Roti / Chapati|1 roti|1|s', 'Salad (green, undressed)|1 katori|1']],
  ['m_biryani', 'Chicken biryani with curd', 'M', 'nonveg', ['Chicken Biryani|1 plate|1|s', 'Curd|0.5 katori|1']],
  ['m_prawn_rice', 'Prawns with rice and sabzi', 'M', 'nonveg', ['Prawns (cooked)|100 g|1', 'Rice (cooked)|1 katori|1|s', 'Mixed Veg Sabzi|1 katori|1']],
  ['m_mutton_roti', 'Mutton curry with roti', 'M', 'nonveg', ['Mutton Curry|1 katori|1', 'Roti / Chapati|1 roti|2|s', 'Salad (green, undressed)|1 katori|1']],
];

export interface TemplatePart {
  food: string;
  serving: string;
  qty: number;
  scalable: boolean;
}

export interface MealTemplate {
  id: string;
  name: string;
  slots: MealSlot[];
  diet: DietType;
  parts: TemplatePart[];
}

const SLOT_CODES: Record<string, MealSlot[]> = {
  B: ['breakfast'],
  S: ['morning_snack', 'evening_snack'],
  M: ['lunch', 'dinner'],
};

export const MEAL_TEMPLATES: MealTemplate[] = ROWS.map(([id, name, slots, diet, parts]) => ({
  id,
  name,
  slots: [...slots].flatMap((c) => SLOT_CODES[c] ?? []),
  diet,
  parts: parts.map((spec) => {
    const [food, serving, qty, flag] = spec.split('|');
    return { food, serving, qty: Number(qty), scalable: flag === 's' };
  }),
}));
