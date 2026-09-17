import type * as s from './schema.js'

type MenuInsert = typeof s.menuItems.$inferInsert
type RecipeInsert = typeof s.recipes.$inferInsert
type IngredientInsert = typeof s.ingredients.$inferInsert
type CustomerInsert = typeof s.customers.$inferInsert

const SIZES = { small: -50, medium: 0, large: 70 }
const HOT_MILK_MODS = {
  'oat milk': 70,
  'almond milk': 70,
  'extra shot': 100,
  decaf: 0,
  'vanilla syrup': 60,
  'caramel syrup': 60,
  'extra hot': 0,
}
const NO_MILK_MODS = { 'extra shot': 100, decaf: 0 }
const COLD_MODS = {
  'oat milk': 70,
  'almond milk': 70,
  'extra shot': 100,
  'vanilla syrup': 60,
  'caramel syrup': 60,
  'light ice': 0,
}

export const INGREDIENTS: IngredientInsert[] = [
  { sku: 'espresso_beans', name: 'Espresso beans', unit: 'g', defaultQty: 2000, reorderLevel: 400 },
  { sku: 'drip_beans', name: 'Drip roast beans', unit: 'g', defaultQty: 1500, reorderLevel: 300 },
  { sku: 'whole_milk', name: 'Whole milk', unit: 'ml', defaultQty: 8000, reorderLevel: 2000 },
  { sku: 'oat_milk', name: 'Oat milk', unit: 'ml', defaultQty: 3000, reorderLevel: 1000 },
  { sku: 'almond_milk', name: 'Almond milk', unit: 'ml', defaultQty: 2000, reorderLevel: 500 },
  { sku: 'vanilla_syrup', name: 'Vanilla syrup', unit: 'ml', defaultQty: 600, reorderLevel: 150 },
  { sku: 'caramel_syrup', name: 'Caramel syrup', unit: 'ml', defaultQty: 600, reorderLevel: 150 },
  { sku: 'matcha', name: 'Matcha powder', unit: 'g', defaultQty: 200, reorderLevel: 50 },
  {
    sku: 'chai_concentrate',
    name: 'Chai concentrate',
    unit: 'ml',
    defaultQty: 1500,
    reorderLevel: 400,
  },
  { sku: 'cocoa', name: 'Cocoa', unit: 'g', defaultQty: 500, reorderLevel: 100 },
  { sku: 'ice', name: 'Ice', unit: 'g', defaultQty: 10000, reorderLevel: 2000 },
  { sku: 'cups', name: 'Cups', unit: 'each', defaultQty: 300, reorderLevel: 60 },
  { sku: 'lids', name: 'Lids', unit: 'each', defaultQty: 300, reorderLevel: 60 },
  { sku: 'croissant', name: 'Butter croissant', unit: 'each', defaultQty: 12, reorderLevel: 3 },
  {
    sku: 'blueberry_muffin',
    name: 'Blueberry muffin',
    unit: 'each',
    defaultQty: 8,
    reorderLevel: 2,
  },
  // Deliberately scarce so an "out of stock" scenario is reachable.
  { sku: 'lavender_syrup', name: 'Lavender syrup', unit: 'ml', defaultQty: 20, reorderLevel: 100 },
]

export const MENU: MenuInsert[] = [
  {
    id: 'espresso',
    name: 'Espresso',
    category: 'espresso',
    basePriceCents: 300,
    sizeDeltaCents: { small: 0 },
    modifiers: NO_MILK_MODS,
    description: 'A double shot, straight.',
  },
  {
    id: 'americano',
    name: 'Americano',
    category: 'espresso',
    basePriceCents: 350,
    sizeDeltaCents: SIZES,
    modifiers: NO_MILK_MODS,
    description: 'Espresso over hot water.',
  },
  {
    id: 'latte',
    name: 'Latte',
    category: 'espresso',
    basePriceCents: 450,
    sizeDeltaCents: SIZES,
    modifiers: HOT_MILK_MODS,
    description: 'Espresso with steamed milk and a thin layer of foam.',
  },
  {
    id: 'cappuccino',
    name: 'Cappuccino',
    category: 'espresso',
    basePriceCents: 450,
    sizeDeltaCents: SIZES,
    modifiers: HOT_MILK_MODS,
    description: 'Equal parts espresso, steamed milk, and foam.',
  },
  {
    id: 'flat_white',
    name: 'Flat White',
    category: 'espresso',
    basePriceCents: 475,
    sizeDeltaCents: { small: 0, medium: 0 },
    modifiers: HOT_MILK_MODS,
    description: 'Ristretto shots with velvety microfoam.',
  },
  {
    id: 'mocha',
    name: 'Mocha',
    category: 'espresso',
    basePriceCents: 500,
    sizeDeltaCents: SIZES,
    modifiers: HOT_MILK_MODS,
    description: 'Espresso, cocoa, and steamed milk.',
  },
  {
    id: 'drip',
    name: 'Drip Coffee',
    category: 'brewed',
    basePriceCents: 275,
    sizeDeltaCents: SIZES,
    modifiers: { decaf: 0 },
    description: 'Batch-brewed house roast.',
  },
  {
    id: 'cold_brew',
    name: 'Cold Brew',
    category: 'cold',
    basePriceCents: 425,
    sizeDeltaCents: SIZES,
    modifiers: COLD_MODS,
    description: 'Steeped 18 hours, served over ice.',
  },
  {
    id: 'iced_latte',
    name: 'Iced Latte',
    category: 'cold',
    basePriceCents: 475,
    sizeDeltaCents: SIZES,
    modifiers: COLD_MODS,
    description: 'Espresso and cold milk over ice.',
  },
  {
    id: 'matcha_latte',
    name: 'Matcha Latte',
    category: 'tea',
    basePriceCents: 500,
    sizeDeltaCents: SIZES,
    modifiers: HOT_MILK_MODS,
    description: 'Ceremonial matcha whisked into steamed milk.',
  },
  {
    id: 'chai_latte',
    name: 'Chai Latte',
    category: 'tea',
    basePriceCents: 450,
    sizeDeltaCents: SIZES,
    modifiers: HOT_MILK_MODS,
    description: 'Spiced black tea concentrate with steamed milk.',
  },
  {
    id: 'hot_chocolate',
    name: 'Hot Chocolate',
    category: 'tea',
    basePriceCents: 400,
    sizeDeltaCents: SIZES,
    modifiers: { 'oat milk': 70, 'almond milk': 70 },
    description: 'Cocoa and steamed milk.',
  },
  {
    id: 'lavender_latte',
    name: 'Lavender Latte',
    category: 'espresso',
    basePriceCents: 525,
    sizeDeltaCents: SIZES,
    modifiers: HOT_MILK_MODS,
    description: 'Seasonal. Espresso, house lavender syrup, steamed milk.',
  },
  {
    id: 'croissant',
    name: 'Butter Croissant',
    category: 'pastry',
    basePriceCents: 375,
    sizeDeltaCents: { medium: 0 },
    modifiers: { warmed: 0 },
    description: 'Baked this morning.',
  },
  {
    id: 'blueberry_muffin',
    name: 'Blueberry Muffin',
    category: 'pastry',
    basePriceCents: 350,
    sizeDeltaCents: { medium: 0 },
    modifiers: { warmed: 0 },
    description: 'Wild blueberries, streusel top.',
  },
  {
    id: 'pumpkin_latte',
    name: 'Pumpkin Spice Latte',
    category: 'espresso',
    basePriceCents: 550,
    sizeDeltaCents: SIZES,
    modifiers: HOT_MILK_MODS,
    available: false,
    description: 'Seasonal. Back in October.',
  },
]

const cup = [
  { sku: 'cups', qty: 1 },
  { sku: 'lids', qty: 1 },
]
export const RECIPES: RecipeInsert[] = [
  {
    menuItemId: 'espresso',
    steps: ['grind 18g', 'pull double shot'],
    ingredients: [{ sku: 'espresso_beans', qty: 18 }, ...cup],
    prepSeconds: 35,
  },
  {
    menuItemId: 'americano',
    steps: ['pull double shot', 'add hot water'],
    ingredients: [{ sku: 'espresso_beans', qty: 18 }, ...cup],
    prepSeconds: 45,
  },
  {
    menuItemId: 'latte',
    steps: ['pull double shot', 'steam milk to 60C', 'pour with thin foam'],
    ingredients: [{ sku: 'espresso_beans', qty: 18 }, { sku: 'whole_milk', qty: 240 }, ...cup],
    prepSeconds: 75,
  },
  {
    menuItemId: 'cappuccino',
    steps: ['pull double shot', 'steam milk with dense foam', 'pour'],
    ingredients: [{ sku: 'espresso_beans', qty: 18 }, { sku: 'whole_milk', qty: 180 }, ...cup],
    prepSeconds: 75,
  },
  {
    menuItemId: 'flat_white',
    steps: ['pull ristretto shots', 'steam microfoam', 'pour'],
    ingredients: [{ sku: 'espresso_beans', qty: 20 }, { sku: 'whole_milk', qty: 160 }, ...cup],
    prepSeconds: 80,
  },
  {
    menuItemId: 'mocha',
    steps: ['pull double shot', 'mix cocoa', 'steam milk', 'pour'],
    ingredients: [
      { sku: 'espresso_beans', qty: 18 },
      { sku: 'cocoa', qty: 20 },
      { sku: 'whole_milk', qty: 220 },
      ...cup,
    ],
    prepSeconds: 90,
  },
  {
    menuItemId: 'drip',
    steps: ['pour from batch brewer'],
    ingredients: [{ sku: 'drip_beans', qty: 15 }, ...cup],
    prepSeconds: 15,
  },
  {
    menuItemId: 'cold_brew',
    steps: ['fill cup with ice', 'pour cold brew'],
    ingredients: [{ sku: 'drip_beans', qty: 30 }, { sku: 'ice', qty: 150 }, ...cup],
    prepSeconds: 20,
  },
  {
    menuItemId: 'iced_latte',
    steps: ['pull double shot', 'fill cup with ice', 'add cold milk', 'pour shots over'],
    ingredients: [
      { sku: 'espresso_beans', qty: 18 },
      { sku: 'whole_milk', qty: 200 },
      { sku: 'ice', qty: 150 },
      ...cup,
    ],
    prepSeconds: 60,
  },
  {
    menuItemId: 'matcha_latte',
    steps: ['sift matcha', 'whisk with hot water', 'steam milk', 'pour'],
    ingredients: [{ sku: 'matcha', qty: 4 }, { sku: 'whole_milk', qty: 240 }, ...cup],
    prepSeconds: 85,
  },
  {
    menuItemId: 'chai_latte',
    steps: ['measure concentrate', 'steam milk', 'combine'],
    ingredients: [{ sku: 'chai_concentrate', qty: 120 }, { sku: 'whole_milk', qty: 180 }, ...cup],
    prepSeconds: 60,
  },
  {
    menuItemId: 'hot_chocolate',
    steps: ['mix cocoa', 'steam milk', 'combine'],
    ingredients: [{ sku: 'cocoa', qty: 25 }, { sku: 'whole_milk', qty: 260 }, ...cup],
    prepSeconds: 60,
  },
  {
    menuItemId: 'lavender_latte',
    steps: ['pull double shot', 'add lavender syrup', 'steam milk', 'pour'],
    ingredients: [
      { sku: 'espresso_beans', qty: 18 },
      { sku: 'lavender_syrup', qty: 25 },
      { sku: 'whole_milk', qty: 240 },
      ...cup,
    ],
    prepSeconds: 80,
  },
  {
    menuItemId: 'croissant',
    steps: ['plate'],
    ingredients: [{ sku: 'croissant', qty: 1 }],
    prepSeconds: 10,
  },
  {
    menuItemId: 'blueberry_muffin',
    steps: ['plate'],
    ingredients: [{ sku: 'blueberry_muffin', qty: 1 }],
    prepSeconds: 10,
  },
  {
    menuItemId: 'pumpkin_latte',
    steps: ['pull double shot', 'add pumpkin sauce', 'steam milk', 'pour'],
    ingredients: [{ sku: 'espresso_beans', qty: 18 }, { sku: 'whole_milk', qty: 240 }, ...cup],
    prepSeconds: 80,
  },
]

/** Modifier -> ingredient substitutions/additions the barista applies on top of the base recipe. */
export const MODIFIER_INGREDIENTS: Record<
  string,
  { replaceMilkWith?: string; add?: Array<{ sku: string; qty: number }> }
> = {
  'oat milk': { replaceMilkWith: 'oat_milk' },
  'almond milk': { replaceMilkWith: 'almond_milk' },
  'extra shot': { add: [{ sku: 'espresso_beans', qty: 9 }] },
  'vanilla syrup': { add: [{ sku: 'vanilla_syrup', qty: 20 }] },
  'caramel syrup': { add: [{ sku: 'caramel_syrup', qty: 20 }] },
}

export const CUSTOMERS: CustomerInsert[] = [
  { loyaltyId: 'L-1001', name: 'Ada Lovelace', points: 120, favoriteMenuItemId: 'flat_white' },
  { loyaltyId: 'L-1002', name: 'Grace Hopper', points: 45, favoriteMenuItemId: 'americano' },
  { loyaltyId: 'L-1003', name: 'Linus Pauling', points: 300, favoriteMenuItemId: 'mocha' },
  { loyaltyId: 'L-1004', name: 'Mae Jemison', points: 10, favoriteMenuItemId: 'matcha_latte' },
]

/** 10 points buys a free medium drink; a naive cashier may forget to check. */
export const LOYALTY_POINTS_PER_DOLLAR = 2
export const LOYALTY_FREE_DRINK_POINTS = 100
