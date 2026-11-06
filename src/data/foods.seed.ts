import type { Food, Serving } from '@/types';
import { seedMicroNames, seedMicrosFor } from './micros.seed';

/**
 * Bundled offline food database — Indian staples first, then global basics.
 *
 * Stored as tuples rather than objects because this ships in the precache and
 * the object form roughly triples the payload for no readability gain at this
 * scale. Expanded once at startup by `seedFoods()`.
 *
 * Row: [name, kcal, protein, fat, carbs, fibre, servings, tags]
 *   - nutrients are per 100 g
 *   - servings: "label:grams" pipe-separated; the first is the default
 *
 * Figures are drawn from IFCT (Indian Food Composition Tables) and USDA
 * FoodData Central, rounded to whole numbers. Cooked weights are used for
 * dishes served cooked, which is why e.g. rice reads ~130 kcal not ~360.
 */
type Row = [string, number, number, number, number, number, string, string];

const ROWS: Row[] = [
  // ---------------------------------------------------------------- breads
  ['Roti / Chapati', 297, 9.6, 7.4, 49, 4.9, '1 roti:40|2 roti/chapati:80', 'indian,veg,staple,grain'],
  ['Phulka', 280, 9.2, 3.8, 53, 5.1, '1 phulka:35|2 phulka:70', 'indian,veg,staple,grain'],
  ['Tandoori Roti', 310, 9.8, 8.2, 51, 4.6, '1 roti:55', 'indian,veg,grain'],
  ['Naan', 320, 8.8, 8.4, 52, 2.3, '1 naan:90', 'indian,veg,grain'],
  ['Butter Naan', 356, 8.5, 13.2, 50, 2.1, '1 naan:95', 'indian,veg,grain'],
  ['Paratha (plain)', 330, 7.2, 14.5, 43, 3.4, '1 paratha:70', 'indian,veg,grain'],
  ['Aloo Paratha', 285, 6.1, 11.8, 39, 3.6, '1 paratha:110', 'indian,veg,grain'],
  ['Puri', 385, 7.4, 20.6, 43, 2.8, '1 puri:25|2 puri:50', 'indian,veg,fried'],
  ['Bhatura', 350, 7.8, 15.2, 46, 2.2, '1 bhatura:80', 'indian,veg,fried'],
  ['Bread (white)', 265, 9, 3.2, 49, 2.7, '1 slice:28|2 slices:56', 'global,veg,grain'],
  ['Bread (whole wheat)', 247, 13, 3.4, 41, 6.8, '1 slice:32|2 slices:64', 'global,veg,grain'],
  ['Pav', 275, 8.4, 3.6, 52, 2.2, '1 pav:45', 'indian,veg,grain'],

  // ------------------------------------------------------------ rice & grains
  ['Rice (cooked)', 130, 2.7, 0.3, 28, 0.4, '1 katori:120|2 katori:240|1 cup:180', 'indian,veg,staple,grain'],
  ['Brown Rice (cooked)', 123, 2.7, 1, 26, 1.8, '1 katori:120|1 cup:180', 'indian,veg,grain'],
  ['Jeera Rice', 165, 3.1, 4.6, 28, 0.8, '1 katori:120', 'indian,veg,grain'],
  ['Veg Pulao', 152, 3.4, 4.2, 25, 1.9, '1 katori:150', 'indian,veg,grain'],
  ['Veg Biryani', 168, 4.1, 5.4, 26, 2.1, '1 plate:250', 'indian,veg,grain'],
  ['Chicken Biryani', 195, 9.2, 7.1, 23, 1.4, '1 plate:280', 'indian,nonveg,grain'],
  ['Fried Rice', 186, 4.2, 6.4, 27, 1.3, '1 katori:150', 'indian,veg,grain'],
  ['Lemon Rice', 172, 3.2, 5.8, 27, 1.5, '1 katori:150', 'indian,veg,grain'],
  ['Curd Rice', 128, 3.6, 3.1, 21, 0.6, '1 katori:150', 'indian,veg,grain'],
  ['Khichdi', 118, 4.3, 2.4, 19, 2.2, '1 katori:150', 'indian,veg,grain'],
  ['Poha', 130, 2.6, 3.4, 23, 1.2, '1 katori:120|0.5 katori:60', 'indian,veg,breakfast'],
  ['Upma', 145, 3.4, 5.2, 21, 1.8, '1 katori:130', 'indian,veg,breakfast'],
  ['Oats (cooked)', 71, 2.5, 1.5, 12, 1.7, '1 katori:150|1 cup:180', 'global,veg,breakfast'],
  ['Oats (dry)', 389, 16.9, 6.9, 66, 10.6, '40 g:40|1 cup:80', 'global,veg,breakfast'],
  ['Muesli', 375, 10.1, 8.4, 63, 7.8, '40 g:40', 'global,veg,breakfast'],
  ['Cornflakes', 357, 7.5, 0.4, 84, 3.3, '30 g:30', 'global,veg,breakfast'],
  ['Quinoa (cooked)', 120, 4.4, 1.9, 21, 2.8, '1 katori:120', 'global,veg,grain'],
  ['Daliya (broken wheat)', 118, 3.8, 0.6, 25, 3.2, '1 katori:150', 'indian,veg,grain'],

  // ------------------------------------------------------------- south indian
  ['Idli', 146, 4.2, 0.4, 30, 1.4, '1 idli:45|2 idli (regular):90|3 idli:135', 'indian,veg,breakfast'],
  ['Dosa', 168, 3.9, 5.1, 27, 1.3, '1 medium:80|1.5 medium:120', 'indian,veg,breakfast'],
  ['Masala Dosa', 186, 4.2, 7.2, 27, 2.1, '1 dosa:150', 'indian,veg,breakfast'],
  ['Uttapam', 158, 4.4, 4.6, 25, 1.8, '1 uttapam:120', 'indian,veg,breakfast'],
  ['Medu Vada', 285, 7.2, 14.8, 31, 3.4, '1 vada:45|2 vada:90', 'indian,veg,fried'],
  ['Sambar', 85, 3.8, 2.6, 11, 3.1, '1 katori:150|1.5 katori:225', 'indian,veg,curry'],
  ['Rasam', 42, 1.6, 1.4, 6, 1.2, '1 katori:150', 'indian,veg,curry'],
  ['Coconut Chutney', 165, 3.1, 13.8, 8, 4.2, '2 tbsp:30', 'indian,veg,side'],
  ['Appam', 152, 2.8, 3.4, 28, 1.1, '1 appam:70', 'indian,veg,breakfast'],

  // --------------------------------------------------------------- dals
  ['Dal (cooked)', 116, 7.2, 2.4, 16, 4.8, '1 katori:150|1.5 katori:225|3 katori:450', 'indian,veg,protein'],
  ['Dal Fry', 143, 6.8, 5.9, 16, 4.5, '1 katori:150', 'indian,veg,protein'],
  ['Dal Tadka', 138, 6.6, 5.4, 16, 4.4, '1 katori:150', 'indian,veg,protein'],
  ['Dal Makhani', 178, 6.4, 9.8, 16, 5.1, '1 katori:150', 'indian,veg,protein'],
  ['Sambhar Dal / Toor Dal (dry)', 343, 22.3, 1.7, 57, 15.5, '30 g:30', 'indian,veg,protein'],
  ['Rajma (kidney bean curry)', 127, 6.8, 3.4, 18, 6.2, '1 katori:150', 'indian,veg,protein'],
  ['Chole (chickpea curry)', 148, 7.1, 5.2, 19, 6.8, '1 katori:150', 'indian,veg,protein'],
  ['Kidney Beans (boiled)', 127, 8.7, 0.5, 23, 6.4, '1 katori:120', 'global,veg,protein'],
  ['Chickpeas (boiled)', 164, 8.9, 2.6, 27, 7.6, '1 katori:120', 'global,veg,protein'],
  ['Roasted Chana', 364, 22.5, 5.2, 55, 17.8, '30 g:30|1 katori:60', 'indian,veg,snack,protein'],
  ['Sprouts (moong)', 96, 8.2, 0.5, 16, 5.4, '1 katori:100', 'indian,veg,protein'],
  ['Green Moong Dal', 105, 7.0, 0.4, 19, 7.6, '1 katori:150', 'indian,veg,protein'],

  // ------------------------------------------------------------- vegetables
  ['Mixed Veg Sabzi', 96, 2.6, 5.4, 10, 3.4, '1 katori:150', 'indian,veg'],
  ['Aloo Sabzi', 118, 2.1, 5.8, 15, 2.2, '1 katori:150', 'indian,veg'],
  ['Bhindi Masala', 105, 2.4, 6.8, 9, 3.9, '1 katori:150', 'indian,veg'],
  ['Baingan Bharta', 88, 1.8, 5.6, 8, 3.4, '1 katori:150', 'indian,veg'],
  ['Palak Paneer', 152, 7.4, 10.8, 6, 2.4, '1 katori:150', 'indian,veg,protein'],
  ['Aloo Gobi', 102, 2.6, 5.4, 12, 3.1, '1 katori:150', 'indian,veg'],
  ['Cucumber', 15, 0.7, 0.1, 3.6, 0.5, '1 large (8-1/4" long):300|1 medium:200', 'global,veg,salad'],
  ['Tomato', 18, 0.9, 0.2, 3.9, 1.2, '1 medium:120', 'global,veg,salad'],
  ['Onion', 40, 1.1, 0.1, 9.3, 1.7, '1 medium:110', 'global,veg,salad'],
  ['Carrot', 41, 0.9, 0.2, 9.6, 2.8, '1 medium:60', 'global,veg,salad'],
  ['Spinach (raw)', 23, 2.9, 0.4, 3.6, 2.2, '1 katori:60', 'global,veg'],
  ['Broccoli (cooked)', 35, 2.4, 0.4, 7.2, 3.3, '1 katori:100', 'global,veg'],
  ['Salad (green, undressed)', 22, 1.2, 0.2, 4.1, 1.8, '1 katori:100|1 bowl:150', 'global,veg,salad'],
  ['Cabbage', 25, 1.3, 0.1, 5.8, 2.5, '1 katori:90', 'global,veg'],
  ['Cauliflower', 25, 1.9, 0.3, 5, 2, '1 katori:100', 'global,veg'],
  ['Capsicum', 26, 1, 0.3, 6, 2.1, '1 medium:120', 'global,veg'],
  ['Potato (boiled)', 87, 1.9, 0.1, 20, 1.8, '1 medium:150', 'global,veg'],
  ['Sweet Potato (boiled)', 76, 1.4, 0.1, 18, 2.5, '1 medium:130', 'global,veg'],
  ['Corn (boiled)', 96, 3.4, 1.5, 21, 2.4, '1 cup:160', 'global,veg'],

  // --------------------------------------------------------------- proteins
  ['Paneer', 265, 18.3, 20.8, 1.2, 0, '40 grams:40|1 katori:100', 'indian,veg,protein,dairy'],
  ['Tofu', 76, 8.1, 4.8, 1.9, 0.3, '100 g:100', 'global,veg,protein'],
  ['Boiled Egg', 155, 12.6, 10.6, 1.1, 0, '1 large:50|2 large:100', 'global,nonveg,protein'],
  ['Egg White (boiled)', 52, 10.9, 0.2, 0.7, 0, '1 large:33|2 large:66', 'global,nonveg,protein'],
  ['Omelette (2 eggs)', 196, 13.6, 15.1, 1.4, 0, '1 omelette:120', 'global,nonveg,protein'],
  ['Egg Bhurji', 185, 12.4, 13.8, 3.2, 0.6, '1 katori:120', 'indian,nonveg,protein'],
  ['Chicken Breast (grilled)', 165, 31, 3.6, 0, 0, '100 g:100|1 piece:120', 'global,nonveg,protein'],
  ['Chicken Curry', 160, 14.2, 9.8, 4.1, 1.1, '0.5 katori:75|1 katori:150', 'indian,nonveg,protein'],
  ['Butter Chicken', 205, 14.8, 14.2, 5.2, 0.9, '1 katori:150', 'indian,nonveg,protein'],
  ['Tandoori Chicken', 175, 26.4, 6.8, 2.1, 0.4, '1 piece:100', 'indian,nonveg,protein'],
  ['Fish Curry', 135, 15.6, 6.4, 3.2, 0.8, '1 katori:150', 'indian,nonveg,protein'],
  ['Fish (grilled)', 148, 22.6, 5.8, 0, 0, '100 g:100', 'global,nonveg,protein'],
  ['Prawns (cooked)', 99, 24, 0.3, 0.2, 0, '100 g:100', 'global,nonveg,protein'],
  ['Mutton Curry', 215, 16.8, 15.2, 3.4, 0.7, '1 katori:150', 'indian,nonveg,protein'],
  ['Soya Chunks (cooked)', 118, 15.2, 0.8, 12, 4.8, '1 katori:100', 'indian,veg,protein'],

  // ----------------------------------------------------------------- dairy
  ['Milk', 62, 3.2, 3.4, 4.8, 0, '1 glass:200|0.75 glass:150|1 cup:240', 'global,veg,dairy'],
  ['Toned Milk', 48, 3.1, 1.6, 4.9, 0, '1 glass:200', 'indian,veg,dairy'],
  ['Skimmed Milk', 35, 3.4, 0.2, 5, 0, '1 glass:200', 'global,veg,dairy'],
  ['Curd', 60, 3.4, 3.2, 4.4, 0, '1 katori:150|0.5 katori:75', 'indian,veg,dairy'],
  ['Greek Yogurt', 59, 10.2, 0.4, 3.6, 0, '1 katori:150|1 cup:170', 'global,veg,dairy,protein'],
  ['Buttermilk', 38, 2.2, 1.4, 4.2, 0, '1 glass:200', 'indian,veg,dairy'],
  ['Lassi (sweet)', 92, 2.8, 2.6, 14, 0, '1 glass:200', 'indian,veg,dairy'],
  ['Cheese (cheddar)', 402, 25, 33, 1.3, 0, '1 slice:20', 'global,veg,dairy'],
  ['Butter', 717, 0.9, 81, 0.1, 0, '1 tsp:5|1 tbsp:14', 'global,veg,fat'],
  ['Ghee', 900, 0, 100, 0, 0, '1 tsp:5|1 tbsp:14', 'indian,veg,fat'],

  // ----------------------------------------------------------------- fruits
  ['Banana', 89, 1.1, 0.3, 23, 2.6, '1 small(4.5" long):100|1 medium:118|1 large:136', 'global,veg,fruit'],
  ['Apple', 52, 0.3, 0.2, 14, 2.4, '0.5 small (2-3/4" dia):85|1 small (2-3/4" dia):170|1 medium:182', 'global,veg,fruit'],
  ['Orange', 47, 0.9, 0.1, 12, 2.4, '1 fruit (2-5/8" dia):131', 'global,veg,fruit'],
  ['Guava', 68, 2.6, 0.9, 14, 5.4, '1 fruit, with refuse:70|1 medium:100', 'indian,veg,fruit'],
  ['Papaya', 43, 0.5, 0.3, 11, 1.7, '1 katori:140|1 cup:145', 'indian,veg,fruit'],
  ['Mango', 60, 0.8, 0.4, 15, 1.6, '1 medium:200|1 katori:165', 'indian,veg,fruit'],
  ['Grapes', 69, 0.7, 0.2, 18, 0.9, '1 katori:100', 'global,veg,fruit'],
  ['Watermelon', 30, 0.6, 0.2, 8, 0.4, '1 katori:150', 'global,veg,fruit'],
  ['Pomegranate', 83, 1.7, 1.2, 19, 4, '1 katori:100', 'indian,veg,fruit'],
  ['Strawberries', 32, 0.7, 0.3, 7.7, 2, '1 katori:150|1 cup:152', 'global,veg,fruit'],
  ['Blueberries', 57, 0.7, 0.3, 14, 2.4, '0.25 cup:37|1 katori:145', 'global,veg,fruit'],
  ['Blackberries', 43, 1.4, 0.5, 9.6, 5.3, '0.25 cup:36', 'global,veg,fruit'],
  ['Kiwi', 61, 1.1, 0.5, 15, 3, '1 fruit:75', 'global,veg,fruit'],
  ['Pineapple', 50, 0.5, 0.1, 13, 1.4, '1 katori:150', 'global,veg,fruit'],
  ['Pear', 57, 0.4, 0.1, 15, 3.1, '1 medium:178', 'global,veg,fruit'],
  ['Chikoo (sapota)', 83, 0.4, 1.1, 20, 5.3, '1 fruit:100', 'indian,veg,fruit'],
  ['Dates', 282, 2.5, 0.4, 75, 8, '2 dates:16', 'indian,veg,fruit'],
  ['Avocado', 160, 2, 14.7, 8.5, 6.7, '0.5 fruit:100', 'global,veg,fruit,fat'],

  // ------------------------------------------------------------ nuts & seeds
  ['Almond', 579, 21.2, 49.9, 22, 12.5, '5.0 almond:6|15.0 almond:18|10 almond:12', 'global,veg,nut,fat'],
  ['Walnut', 654, 15.2, 65.2, 14, 6.7, '2.0 piece(half of one):8|4.0 piece(half of one):16', 'global,veg,nut,fat'],
  ['Cashew', 553, 18.2, 43.8, 30, 3.3, '10 cashew:16', 'global,veg,nut,fat'],
  ['Pistachio', 560, 20.2, 45.3, 28, 10.6, '15 pistachio:15', 'global,veg,nut,fat'],
  ['Peanuts', 567, 25.8, 49.2, 16, 8.5, '30 g:30|1 katori:60', 'indian,veg,nut,protein'],
  ['Peanut Butter', 588, 25.1, 50.4, 20, 6, '1 tbsp:16|2 tbsp:32', 'global,veg,fat,protein'],
  ['Chia Seeds', 486, 16.5, 30.7, 42, 34.4, '1 tbsp:12', 'global,veg,seed,fibre'],
  ['Flax Seeds', 534, 18.3, 42.2, 29, 27.3, '1 tbsp:10', 'global,veg,seed,fibre'],
  ['Pumpkin Seeds', 559, 30.2, 49.1, 11, 6, '2 tbsp:20', 'global,veg,seed'],
  ['Makhana (fox nuts)', 347, 9.7, 0.1, 77, 14.5, '0.25 cup:10|1 katori:25', 'indian,veg,snack'],

  // -------------------------------------------------------------- beverages
  ['Tea', 30, 0.9, 0.9, 4.5, 0, '1.0 teacup:120|1 cup:150', 'indian,veg,beverage'],
  ['Green Tea', 1, 0, 0, 0.2, 0, '1 cup:200', 'global,veg,beverage'],
  ['Coffee', 55, 1.8, 1.9, 7.4, 0, '1.0 tea cup:120|1 cup:150', 'indian,veg,beverage'],
  ['Black Coffee', 2, 0.1, 0, 0.3, 0, '1 cup:200', 'global,veg,beverage'],
  ['Coconut Water', 19, 0.7, 0.2, 3.7, 1.1, '1 glass:200', 'indian,veg,beverage'],
  ['Orange Juice (fresh)', 45, 0.7, 0.2, 10, 0.2, '1 glass:200', 'global,veg,beverage'],
  ['Cola', 42, 0, 0, 10.6, 0, '1 can:330', 'global,veg,beverage'],
  ['Beer', 43, 0.5, 0, 3.6, 0, '1 bottle:330', 'global,beverage,alcohol'],
  ['Wine (red)', 85, 0.1, 0, 2.6, 0, '1 glass:150', 'global,beverage,alcohol'],
  ['Protein Shake (whey, water)', 82, 18, 1.2, 2.4, 0.5, '1 scoop:30', 'global,veg,protein,beverage'],

  // ----------------------------------------------------------------- snacks
  ['Samosa', 308, 5.2, 17.8, 32, 2.6, '1 samosa:65', 'indian,veg,fried,snack'],
  ['Pakora', 315, 7.1, 18.4, 30, 3.8, '1 katori:80', 'indian,veg,fried,snack'],
  ['Dhokla', 158, 6.2, 4.8, 22, 2.4, '2 pieces:80', 'indian,veg,snack'],
  ['Poha Chivda', 452, 8.4, 22.6, 54, 4.2, '30 g:30', 'indian,veg,snack'],
  ['Biscuit (marie)', 416, 7.2, 9.8, 74, 2.4, '2 biscuits:14', 'indian,veg,snack'],
  ['Potato Chips', 536, 6.6, 34.6, 53, 4.4, '1 small pack:30', 'global,veg,snack'],
  ['Dark Chocolate (70%)', 598, 7.8, 43, 46, 11, '2 squares:20', 'global,veg,snack'],
  ['Vada Pav', 286, 6.4, 12.8, 37, 3.1, '1 vada pav:150', 'indian,veg,snack'],
  ['Pani Puri', 329, 5.4, 14.6, 44, 3.2, '6 pieces:120', 'indian,veg,snack'],
  ['Bhel Puri', 235, 5.8, 7.4, 37, 4.1, '1 plate:120', 'indian,veg,snack'],

  // ---------------------------------------------------------------- sweets
  ['Gulab Jamun', 336, 4.2, 14.8, 47, 0.6, '1 piece:40|2 pieces:80', 'indian,veg,sweet'],
  ['Jalebi', 385, 3.1, 14.2, 62, 0.4, '1 piece:35', 'indian,veg,sweet'],
  ['Rasgulla', 186, 4.1, 3.8, 34, 0, '1 piece:50', 'indian,veg,sweet'],
  ['Kheer', 145, 3.8, 4.6, 22, 0.4, '1 katori:150', 'indian,veg,sweet'],
  ['Laddu (besan)', 425, 7.4, 21.6, 51, 3.2, '1 laddu:40', 'indian,veg,sweet'],
  ['Ice Cream (vanilla)', 207, 3.5, 11, 24, 0.7, '1 scoop:65', 'global,veg,sweet'],
  ['Sugar', 387, 0, 0, 100, 0, '1 tsp:4|1 tbsp:12', 'global,veg,sweet'],
  ['Honey', 304, 0.3, 0, 82, 0.2, '1 tsp:7|1 tbsp:21', 'global,veg,sweet'],

  // ----------------------------------------------------------- global mains
  ['Pasta (cooked)', 131, 5, 1.1, 25, 1.8, '1 katori:140|1 cup:140', 'global,veg,grain'],
  ['Pasta with Pesto', 198, 6.2, 9.4, 23, 2.1, '1 plate:220', 'global,veg,grain'],
  ['Pizza (cheese)', 266, 11, 10, 33, 2.3, '1 slice:107|2 slices:214', 'global,veg'],
  ['Burger (veg)', 245, 8.2, 9.6, 31, 2.8, '1 burger:180', 'global,veg'],
  ['Burger (chicken)', 268, 14.2, 11.4, 27, 1.9, '1 burger:190', 'global,nonveg'],
  ['Sandwich (veg)', 218, 7.4, 7.2, 31, 3.1, '1 sandwich:150', 'global,veg'],
  ['Pesto Toast', 285, 8.1, 14.2, 31, 2.6, '1 slice:70', 'global,veg'],
  ['Pasta Salad', 165, 4.2, 7.8, 20, 2.2, '1 bowl:200', 'global,veg,salad'],
  ['Noodles (cooked)', 138, 4.5, 2.1, 25, 1.2, '1 katori:150', 'global,veg,grain'],
  ['Hakka Noodles', 172, 5.1, 6.4, 24, 2.1, '1 plate:200', 'indian,veg,grain'],
  ['Manchurian (veg)', 195, 4.8, 10.2, 21, 2.4, '1 katori:150', 'indian,veg'],
  ['Soup (veg clear)', 38, 1.4, 0.9, 6.2, 1.1, '1 bowl:200', 'global,veg'],
  ['Yogurt Bowl with Fruit', 92, 4.2, 2.1, 14, 1.6, '1 bowl:250', 'global,veg,breakfast'],
  ['Olives', 115, 0.8, 10.7, 6.3, 3.2, '5 olives:20', 'global,veg,fat'],

  // ------------------------------------------------------------- condiments
  ['Cooking Oil', 884, 0, 100, 0, 0, '1 tsp:5|1 tbsp:14', 'global,veg,fat'],
  ['Mayonnaise', 680, 1, 75, 0.6, 0, '1 tbsp:14', 'global,veg,fat'],
  ['Tomato Ketchup', 101, 1.2, 0.1, 25, 0.3, '1 tbsp:17', 'global,veg,condiment'],
  ['Pickle (mixed)', 205, 1.4, 18.2, 9.4, 3.1, '1 tsp:8', 'indian,veg,condiment'],
  ['Papad (roasted)', 371, 25.1, 3.2, 58, 12.4, '1 papad:13', 'indian,veg,side'],
];

function parseServings(spec: string): Serving[] {
  return spec.split('|').map((part) => {
    const idx = part.lastIndexOf(':');
    return { label: part.slice(0, idx), grams: Number(part.slice(idx + 1)) };
  });
}

/** Deterministic id so re-seeding never duplicates a row. */
export function seedId(name: string): string {
  return `seed_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
}

export function seedFoods(): Food[] {
  const now = Date.now();
  if (import.meta.env.DEV) warnOnMicroDrift();
  return ROWS.map(([name, kcal, protein, fat, carbs, fibre, servings, tags]) => ({
    id: seedId(name),
    name,
    per100g: { kcal, protein, fat, carbs, fibre },
    micros: seedMicrosFor(name),
    servings: parseServings(servings),
    source: 'seed' as const,
    tags: tags.split(','),
    useCount: 0,
    createdAt: now,
    verified: true,
  }));
}

/**
 * The micro table is joined on the food's exact name, so a rename in one file
 * and not the other silently drops a food's micronutrients — it would show up
 * only as an unexplained dip in the day's coverage. Shout about it in dev
 * instead, where whoever made the edit is still looking.
 */
function warnOnMicroDrift(): void {
  const foods = new Set(ROWS.map(([name]) => name));
  const micros = new Set(seedMicroNames());
  const missing = [...foods].filter((n) => !micros.has(n));
  const orphaned = [...micros].filter((n) => !foods.has(n));
  if (missing.length) console.warn('[seed] foods with no micronutrient row:', missing);
  if (orphaned.length) console.warn('[seed] micronutrient rows with no food:', orphaned);
}

/**
 * Foods shown in "Frequently Tracked Foods" before the user has logged
 * anything — matches the reference app's starting list.
 */
export const STARTER_FREQUENT = [
  'Tea',
  'Banana',
  'Apple',
  'Coffee',
  'Orange',
  'Milk',
  'Almond',
  'Boiled Egg',
  'Guava',
  'Makhana (fox nuts)',
  'Roasted Chana',
  'Roti / Chapati',
  'Rice (cooked)',
  'Curd',
  'Dal (cooked)',
  'Cucumber',
  'Paneer',
  'Dosa',
  'Idli',
  'Poha',
  'Walnut',
  'Oats (dry)',
  'Sambar',
  'Chicken Curry',
].map(seedId);
