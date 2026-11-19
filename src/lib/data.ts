// All demo content in one place. Edit copy and sample data here.

export type Item = {
  id: string;
  name: string;
  className?: string;   // raw YOLO class like 'toor_dal', used when matching recipes
  conf: number;
  qty: number;
  unit: 'pcs' | 'g' | 'L';
  step: number;
  color: string;
  box: [number, number, number, number]; // x, y, w, h as % of image
};

export const DEMO_ITEMS: Item[] = [
  { id: 'tomato', name: 'Tomato', conf: 96, qty: 4, unit: 'pcs', step: 1, color: '#C8432A', box: [8, 14, 24, 22] },
  { id: 'paneer', name: 'Paneer', conf: 91, qty: 250, unit: 'g', step: 50, color: '#E9DFC9', box: [38, 12, 24, 20] },
  { id: 'milk', name: 'Milk', conf: 97, qty: 0.5, unit: 'L', step: 0.25, color: '#F7F3EA', box: [70, 8, 20, 40] },
  { id: 'spinach', name: 'Spinach', conf: 88, qty: 180, unit: 'g', step: 20, color: '#3F6B3A', box: [8, 56, 30, 26] },
  { id: 'onion', name: 'Onion', conf: 94, qty: 2, unit: 'pcs', step: 1, color: '#B9674A', box: [44, 58, 20, 20] },
  { id: 'chilli', name: 'Green chilli', conf: 85, qty: 3, unit: 'pcs', step: 1, color: '#5C8A3A', box: [70, 62, 18, 14] },
];

export const FEATURES = [
  { to: '/scan', n: '01', title: 'Fridge scan', line: 'Point your camera at a shelf. AHAAR checks the light and focus before it takes the shot.' },
  { to: '/detect', n: '02', title: 'Ingredient detection', line: 'Every item gets a box, a name and a confidence score. Wrong guess? Remove it.' },
  { to: '/pantry', n: '03', title: 'Pantry & quantities', line: 'Rough amounts you can nudge — 4 tomatoes, 250 g paneer — linked to what they can become.' },
  { to: '/recipes', n: '04', title: 'Meal recommendations', line: 'Dishes ranked by what you already have, your diet and glycaemic load. Each one explains itself.' },
  { to: '/family', n: '05', title: 'Family portions & health', line: 'Portions tailored by disease, BP and heart rate, with standard 100g=1bowl measures.' },
  { to: '/cook', n: '06', title: 'Cook-along', line: 'One step on screen at a time, with a timer that runs while your hands are busy.' },
  { to: '/health', n: '07', title: 'Family health growth', line: 'Track how family health, blood pressure, and heart rate increased during AHAAR usage.' },
] as const;

export type Recipe = {
  id: string;
  name: string;
  match: number;
  minutes: number;
  tags: string[];
  uses: string[];
  missing: string[];
  reasons: { label: string; value: number }[];
  steps: { title: string; detail: string; seconds: number }[];
  color: string;
};

export const RECIPES: Recipe[] = [
  {
    id: 'palak-paneer',
    name: 'Palak Paneer',
    match: 94,
    minutes: 30,
    tags: ['Veg', 'High protein'],
    uses: ['spinach', 'paneer', 'onion', 'tomato', 'chilli'],
    missing: [],
    reasons: [
      { label: 'Uses what you have', value: 96 },
      { label: 'Fits your diet', value: 90 },
      { label: 'Low glycaemic load', value: 74 },
    ],
    color: '#3F6B3A',
    steps: [
      { title: 'Blanch', detail: 'Boil spinach for 2 minutes, then plunge into cold water and blend smooth.', seconds: 120 },
      { title: 'Chop', detail: 'Finely chop 1 onion, 2 tomatoes and 1 green chilli. Cube 250 g paneer.', seconds: 180 },
      { title: 'Temper', detail: 'Heat 1 tbsp oil. Add cumin. Wait for the first crackle, then add onion.', seconds: 90 },
      { title: 'Simmer', detail: 'Add tomato and spinach purée. Cook on low with a lid for 8 minutes.', seconds: 480 },
      { title: 'Finish', detail: 'Fold in paneer. Simmer 2 minutes more. Rest, then serve.', seconds: 120 },
    ],
  },
  {
    id: 'tomato-dal',
    name: 'Tomato Dal',
    match: 89,
    minutes: 25,
    tags: ['Veg', 'Low GI', 'Quick'],
    uses: ['tomato', 'onion', 'chilli'],
    missing: ['Toor dal'],
    reasons: [
      { label: 'Uses what you have', value: 82 },
      { label: 'Fits your diet', value: 88 },
      { label: 'Low glycaemic load', value: 91 },
    ],
    color: '#E0A21B',
    steps: [
      { title: 'Pressure cook', detail: 'Rinse 1 cup toor dal. Cook with turmeric and 3 cups water for 3 whistles.', seconds: 600 },
      { title: 'Chop', detail: 'Chop 3 tomatoes, 1 onion and 1 green chilli.', seconds: 150 },
      { title: 'Temper', detail: 'Ghee, mustard seeds, cumin, curry leaves. Then onion until soft.', seconds: 120 },
      { title: 'Combine', detail: 'Add tomatoes until they break down, then the dal. Simmer 5 minutes.', seconds: 300 },
    ],
  },
  {
    id: 'veg-pulao',
    name: 'Veg Pulao',
    match: 78,
    minutes: 35,
    tags: ['Veg'],
    uses: ['onion', 'tomato', 'chilli'],
    missing: ['Basmati rice', 'Peas'],
    reasons: [
      { label: 'Uses what you have', value: 70 },
      { label: 'Fits your diet', value: 84 },
      { label: 'Low glycaemic load', value: 52 },
    ],
    color: '#C8693E',
    steps: [
      { title: 'Soak', detail: 'Rinse and soak 1 cup basmati rice for 20 minutes.', seconds: 1200 },
      { title: 'Sauté', detail: 'Whole spices in ghee, then sliced onion until golden.', seconds: 240 },
      { title: 'Cook', detail: 'Add vegetables, rice and 2 cups water. Cover on low for 12 minutes.', seconds: 720 },
      { title: 'Rest', detail: 'Turn off the heat and rest 5 minutes before fluffing.', seconds: 300 },
    ],
  },
  {
    id: 'paneer-bhurji',
    name: 'Paneer Bhurji',
    match: 92,
    minutes: 15,
    tags: ['Veg', 'High protein', 'Quick', 'Low GI'],
    uses: ['paneer', 'onion', 'tomato', 'chilli'],
    missing: [],
    reasons: [
      { label: 'Uses what you have', value: 94 },
      { label: 'Fits your diet', value: 86 },
      { label: 'Low glycaemic load', value: 88 },
    ],
    color: '#B8371F',
    steps: [
      { title: 'Chop', detail: 'Finely chop onion, tomato and chilli. Crumble 200 g paneer.', seconds: 150 },
      { title: 'Sauté', detail: 'Cumin in oil, then onion and chilli until translucent.', seconds: 180 },
      { title: 'Spice', detail: 'Tomato, turmeric, chilli powder, salt. Cook until soft.', seconds: 180 },
      { title: 'Toss', detail: 'Add paneer and toss for 2 minutes. Finish with coriander.', seconds: 120 },
    ],
  },
];

export const FILTERS = ['Veg', 'Low GI', 'High protein', 'Quick'] as const;

