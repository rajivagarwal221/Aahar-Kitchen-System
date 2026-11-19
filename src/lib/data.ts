// Shared types and static copy.

export type Item = {
  id: string; // detector class key, e.g. 'toor_dal'
  name: string;
  conf: number; // 0-100; 100 for items added by hand
  qty: number;
  unit: 'pcs' | 'g' | 'L';
  step: number;
  color: string;
  box: [number, number, number, number]; // x, y, w, h as % of image
};

// A small pantry for trying the app without a camera or the detection backend.
export const SAMPLE_ITEMS: Item[] = [
  { id: 'tomato', name: 'Tomato', conf: 100, qty: 4, unit: 'pcs', step: 1, color: '#C8432A', box: [8, 14, 24, 22] },
  { id: 'paneer', name: 'Paneer', conf: 100, qty: 250, unit: 'g', step: 50, color: '#E9DFC9', box: [38, 12, 24, 20] },
  { id: 'milk', name: 'Milk', conf: 100, qty: 0.5, unit: 'L', step: 0.25, color: '#F7F3EA', box: [70, 8, 20, 40] },
  { id: 'spinach', name: 'Spinach', conf: 100, qty: 200, unit: 'g', step: 20, color: '#3F6B3A', box: [8, 56, 30, 26] },
  { id: 'onion', name: 'Onion', conf: 100, qty: 2, unit: 'pcs', step: 1, color: '#B9674A', box: [44, 58, 20, 20] },
  { id: 'chilli pepper', name: 'Chilli pepper', conf: 100, qty: 3, unit: 'pcs', step: 1, color: '#5C8A3A', box: [70, 62, 18, 14] },
  { id: 'garlic', name: 'Garlic', conf: 100, qty: 1, unit: 'pcs', step: 1, color: '#EDE6D6', box: [0, 0, 0, 0] },
  { id: 'ginger', name: 'Ginger', conf: 100, qty: 1, unit: 'pcs', step: 1, color: '#C9A66B', box: [0, 0, 0, 0] },
];

export const FEATURES = [
  { to: '/scan', n: '01', title: 'Fridge scan', line: 'Point your camera at a shelf. AHAAR checks the light and focus before it takes the shot.' },
  { to: '/detect', n: '02', title: 'Ingredient detection', line: 'Every item gets a box, a name and a confidence score. Wrong guess? Remove it.' },
  { to: '/pantry', n: '03', title: 'Pantry & quantities', line: 'Amounts you can nudge, a shopping list, and a graph of what each ingredient can become.' },
  { to: '/recipes', n: '04', title: 'Meal recommendations', line: 'Real recipes ranked by what you already have, your family\'s conditions and cooking time. Each score explains itself.' },
  { to: '/family', n: '05', title: 'Family portions & health', line: 'Portions tailored by disease, BP and heart rate, with standard 100g=1bowl measures.' },
  { to: '/cook', n: '06', title: 'Cook-along', line: 'One step on screen at a time, with a timer that runs while your hands are busy.' },
  { to: '/health', n: '07', title: 'Family health log', line: 'Log blood pressure and heart rate for each member and watch the trend over time.' },
] as const;
