/**
 * Deterministic Phase 1 catalog fixture (PLAN §5: ~100 products, 6 categories).
 * Kept separate from `seed.ts` so Phase 2 can extend the fixture set without
 * turning the seed script into a wall of copy.
 */

export type CatalogSpecial = 'out-of-stock' | 'no-reviews' | 'long-description' | 'price-change';

export type CatalogVariant = {
  label: string;
  priceDeltaCents?: number;
};

export type CatalogTemplate = {
  category: string;
  name: string;
  description: string;
  basePriceCents: number;
  variants: CatalogVariant[];
  skuPrefix: string;
  special?: CatalogSpecial;
};

export type CatalogProduct = {
  sku: string;
  name: string;
  description: string;
  category: string;
  priceCents: number;
  imageUrl: string | null;
  special?: CatalogSpecial;
};

const AUDIO: CatalogTemplate[] = [
  {
    skuPrefix: 'AUD-001',
    category: 'Audio',
    name: 'Aurora Wireless Headphones',
    description:
      'Over-ear Bluetooth headphones with 38-hour battery life, memory-foam cushions, and multipoint pairing for laptop and phone.',
    basePriceCents: 8999,
    variants: [{ label: 'Midnight Black' }, { label: 'Cloud White' }, { label: 'Sage Green' }],
  },
  {
    skuPrefix: 'AUD-002',
    category: 'Audio',
    name: 'Pulse Noise-Cancelling Earbuds',
    description:
      'Compact true-wireless earbuds with adaptive noise cancellation, transparency mode, and a pocketable charging case.',
    basePriceCents: 12999,
    variants: [{ label: 'Graphite' }, { label: 'Ivory' }],
  },
  {
    skuPrefix: 'AUD-003',
    category: 'Audio',
    name: 'Drift Portable Bluetooth Speaker',
    description:
      'Water-resistant speaker with a warm 360-degree sound, 12-hour playtime, and a woven carry strap.',
    basePriceCents: 5999,
    variants: [{ label: 'Charcoal' }, { label: 'Sand' }],
  },
  {
    skuPrefix: 'AUD-004',
    category: 'Audio',
    name: 'Studio Monitor Headphones',
    description:
      'Open-back wired headphones tuned for mixing, with replaceable pads and a detachable coiled cable.',
    basePriceCents: 15999,
    variants: [{ label: 'Black' }],
  },
  {
    skuPrefix: 'AUD-005',
    category: 'Audio',
    name: 'Echo Mini Smart Speaker',
    description:
      'Small-room smart speaker with voice control, a 3.5 mm aux input, and a soft fabric finish.',
    basePriceCents: 4999,
    variants: [{ label: 'Cloud White' }, { label: 'Deep Blue' }],
  },
  {
    skuPrefix: 'AUD-006',
    category: 'Audio',
    name: 'Vinyl Revival Turntable',
    description:
      'Belt-driven turntable with a built-in preamp, Bluetooth output, and a walnut veneer plinth.',
    basePriceCents: 24999,
    variants: [{ label: 'Walnut' }],
  },
  {
    skuPrefix: 'AUD-007',
    category: 'Audio',
    name: 'Loop Wired Earbuds',
    description:
      'Simple wired earbuds with an inline microphone, tangle-resistant cable, and three ear-tip sizes.',
    basePriceCents: 1999,
    variants: [{ label: 'Black' }, { label: 'White' }],
  },
  {
    skuPrefix: 'AUD-008',
    category: 'Audio',
    name: 'Boom Party Speaker',
    description:
      'Loud portable speaker with a built-in handle, LED light ring, and microphone input for karaoke nights.',
    basePriceCents: 19999,
    variants: [{ label: 'Black' }],
  },
];

const COMPUTERS: CatalogTemplate[] = [
  {
    skuPrefix: 'COM-001',
    category: 'Computers',
    name: 'Nimbus 14 Ultrabook',
    description:
      'A 14-inch lightweight laptop with an all-day battery, a backlit keyboard, and a fanless aluminum chassis.',
    basePriceCents: 89900,
    variants: [
      { label: '8GB RAM / 256GB SSD' },
      { label: '16GB RAM / 512GB SSD', priceDeltaCents: 20000 },
    ],
  },
  {
    skuPrefix: 'COM-002',
    category: 'Computers',
    name: 'Vector Mechanical Keyboard',
    description:
      'Hot-swappable 75% keyboard with PBT keycaps, per-key lighting, and a USB-C detachable cable.',
    basePriceCents: 12999,
    variants: [{ label: 'Linear' }, { label: 'Tactile' }, { label: 'Clicky' }],
  },
  {
    skuPrefix: 'COM-003',
    category: 'Computers',
    name: 'Glide Wireless Mouse',
    description:
      'Low-profile wireless mouse with silent switches, a precision sensor, and a rechargeable battery.',
    basePriceCents: 4999,
    variants: [{ label: 'Graphite' }, { label: 'Cloud White' }],
  },
  {
    skuPrefix: 'COM-004',
    category: 'Computers',
    name: 'Pixel 27 4K Monitor',
    description:
      'A color-accurate 4K display with USB-C power delivery, slim bezels, and an adjustable stand.',
    basePriceCents: 34999,
    variants: [{ label: '27-inch' }, { label: '32-inch', priceDeltaCents: 10000 }],
  },
  {
    skuPrefix: 'COM-005',
    category: 'Computers',
    name: 'Orbit USB-C Hub',
    description:
      'Seven-port aluminum hub with HDMI, gigabit Ethernet, SD reader, and 100 W pass-through charging.',
    basePriceCents: 6999,
    variants: [{ label: 'Space Gray' }],
  },
  {
    skuPrefix: 'COM-006',
    category: 'Computers',
    name: 'Arc Laptop Stand',
    description:
      'Ventilated aluminum stand with five height settings and silicone pads that keep a laptop in place.',
    basePriceCents: 3999,
    variants: [{ label: 'Silver' }, { label: 'Space Gray' }],
  },
  {
    skuPrefix: 'COM-007',
    category: 'Computers',
    name: 'Flux Portable SSD 1TB',
    description:
      'Pocket-sized USB-C solid-state drive with shock-resistant housing and read speeds up to 1,050 MB/s.',
    basePriceCents: 11999,
    variants: [{ label: 'Black' }],
  },
  {
    skuPrefix: 'COM-008',
    category: 'Computers',
    name: 'Quiet Keys Keyboard Cover',
    description:
      'Silicone keyboard cover that quiets typing and keeps dust and crumbs out of the switches.',
    basePriceCents: 1999,
    variants: [{ label: '14-inch' }, { label: '16-inch' }],
  },
  {
    skuPrefix: 'COM-009',
    category: 'Computers',
    name: 'Nimbus Dock',
    description:
      'Compact desktop dock with dual display outputs, Ethernet, and a 90 W laptop charger in one brick.',
    basePriceCents: 17999,
    variants: [{ label: 'Black' }],
  },
];

const HOME: CatalogTemplate[] = [
  {
    skuPrefix: 'HOM-001',
    category: 'Home',
    name: 'Hearth Ceramic Mug Set',
    description:
      'Four stoneware mugs with a speckled glaze, comfortable handles, and a stackable shape for small kitchens.',
    basePriceCents: 2999,
    variants: [{ label: 'Stone' }, { label: 'Clay' }, { label: 'Ocean' }],
  },
  {
    skuPrefix: 'HOM-002',
    category: 'Home',
    name: 'Linen Throw Blanket',
    description:
      'Breathable stonewashed linen throw with a fringed edge, warm in winter and cool in summer.',
    basePriceCents: 5999,
    variants: [{ label: 'Oat' }, { label: 'Sage' }, { label: 'Rust' }],
  },
  {
    skuPrefix: 'HOM-003',
    category: 'Home',
    name: 'Glow Desk Lamp',
    description:
      'Dimmable LED desk lamp with three color temperatures, a USB charging port, and a weighted base.',
    basePriceCents: 4499,
    variants: [{ label: 'Warm White' }, { label: 'Matte Black' }],
  },
  {
    skuPrefix: 'HOM-004',
    category: 'Home',
    name: 'Aroma Diffuser',
    description:
      'Ultrasonic diffuser with a 300 ml tank, whisper-quiet mist, and an automatic shutoff when empty.',
    basePriceCents: 3999,
    variants: [{ label: 'White' }, { label: 'Wood' }],
  },
  {
    skuPrefix: 'HOM-005',
    category: 'Home',
    name: 'Cast Iron Skillet',
    description:
      'Pre-seasoned cast iron skillet for stovetop, oven, and campfire cooking, with a helper handle.',
    basePriceCents: 3999,
    variants: [{ label: '10-inch' }, { label: '12-inch', priceDeltaCents: 1000 }],
  },
  {
    skuPrefix: 'HOM-006',
    category: 'Home',
    name: 'Pour-Over Coffee Kit',
    description:
      'Glass dripper, 600 ml carafe, reusable stainless filter, and a scoop for a clean morning brew.',
    basePriceCents: 5499,
    variants: [{ label: 'Glass' }],
  },
  {
    skuPrefix: 'HOM-007',
    category: 'Home',
    name: 'Bamboo Cutting Board',
    description:
      'Reversible bamboo board with a juice groove, side handles, and a light oil finish.',
    basePriceCents: 2499,
    variants: [{ label: 'Medium' }, { label: 'Large', priceDeltaCents: 1000 }],
  },
  {
    skuPrefix: 'HOM-008',
    category: 'Home',
    name: 'Cloud Cotton Pillow',
    description:
      'Hypoallergenic down-alternative pillow with a breathable cotton shell and a medium-firm fill.',
    basePriceCents: 3999,
    variants: [{ label: 'Standard' }, { label: 'King', priceDeltaCents: 1000 }],
  },
  {
    skuPrefix: 'HOM-009',
    category: 'Home',
    name: 'Terra Planter Trio',
    description:
      'Three terracotta planters with drainage holes and matching saucers, sized for herbs and houseplants.',
    basePriceCents: 3299,
    variants: [{ label: 'Terracotta' }],
  },
];

const FITNESS: CatalogTemplate[] = [
  {
    skuPrefix: 'FIT-001',
    category: 'Fitness',
    name: 'Flow Yoga Mat',
    description:
      'Non-slip 6 mm yoga mat with alignment lines, a carry strap, and closed-cell foam that wipes clean.',
    basePriceCents: 4999,
    variants: [{ label: 'Charcoal' }, { label: 'Lilac' }],
  },
  {
    skuPrefix: 'FIT-002',
    category: 'Fitness',
    name: 'Resistance Band Set',
    description:
      'Five latex-free bands with clip handles, ankle straps, and a door anchor for home strength work.',
    basePriceCents: 2999,
    variants: [{ label: 'Light / Medium / Heavy' }],
  },
  {
    skuPrefix: 'FIT-003',
    category: 'Fitness',
    name: 'Trail Running Shoes',
    description:
      'Grippy trail shoes with a rock plate, breathable mesh upper, and a cushioned midsole for long runs.',
    basePriceCents: 12999,
    variants: [{ label: 'US 8' }, { label: 'US 9' }, { label: 'US 10' }, { label: 'US 11' }],
  },
  {
    skuPrefix: 'FIT-004',
    category: 'Fitness',
    name: 'Adjustable Dumbbell Pair',
    description:
      'Space-saving dumbbells that adjust from 5 to 25 lb with a twist of the handle; pair included.',
    basePriceCents: 19999,
    variants: [{ label: '5–25 lb' }],
  },
  {
    skuPrefix: 'FIT-005',
    category: 'Fitness',
    name: 'Hydro Steel Bottle',
    description:
      'Double-wall insulated steel bottle that keeps drinks cold for 24 hours and fits most cup holders.',
    basePriceCents: 3499,
    variants: [{ label: '32 oz' }, { label: '40 oz', priceDeltaCents: 500 }],
  },
  {
    skuPrefix: 'FIT-006',
    category: 'Fitness',
    name: 'Foam Roller',
    description:
      'Medium-density foam roller with a textured surface for post-run recovery and mobility work.',
    basePriceCents: 2499,
    variants: [{ label: '18-inch' }],
  },
  {
    skuPrefix: 'FIT-007',
    category: 'Fitness',
    name: 'Jump Rope Pro',
    description:
      'Speed rope with sealed bearings, adjustable steel cable, and knurled aluminum handles.',
    basePriceCents: 1999,
    variants: [{ label: 'Black' }],
  },
  {
    skuPrefix: 'FIT-008',
    category: 'Fitness',
    name: 'Studio Kettlebell',
    description:
      'Cast-iron kettlebell with a wide, smooth handle and a flat base that stays put between sets.',
    basePriceCents: 5999,
    variants: [{ label: '15 lb' }, { label: '25 lb', priceDeltaCents: 2000 }],
  },
];

const OUTDOORS: CatalogTemplate[] = [
  {
    skuPrefix: 'OUT-001',
    category: 'Outdoors',
    name: 'Ridge 2-Person Tent',
    description:
      'Three-season backpacking tent with a full-coverage rainfly, two doors, and a compact stuff sack.',
    basePriceCents: 19999,
    variants: [{ label: 'Forest' }, { label: 'Sand' }],
  },
  {
    skuPrefix: 'OUT-002',
    category: 'Outdoors',
    name: 'Summit Daypack 24L',
    description:
      'Ventilated daypack with a hydration sleeve, hip-belt pockets, and a rain cover in the base.',
    basePriceCents: 8999,
    variants: [{ label: 'Black' }, { label: 'Moss' }],
  },
  {
    skuPrefix: 'OUT-003',
    category: 'Outdoors',
    name: 'Trailhead Trekking Poles',
    description:
      'Pair of collapsible aluminum trekking poles with cork grips and quick-lock length adjustment.',
    basePriceCents: 5999,
    variants: [{ label: 'Pair' }],
  },
  {
    skuPrefix: 'OUT-004',
    category: 'Outdoors',
    name: 'Camp Cook Set',
    description:
      'Ten-piece nesting cook set with a non-stick pot, pan, bowls, and a mesh storage bag.',
    basePriceCents: 7999,
    variants: [{ label: '10-piece' }],
  },
  {
    skuPrefix: 'OUT-005',
    category: 'Outdoors',
    name: 'Horizon Sleeping Bag',
    description:
      'Three-season sleeping bag rated to 20°F with a draft collar, compression sack, and soft liner.',
    basePriceCents: 12999,
    variants: [{ label: 'Regular' }, { label: 'Long', priceDeltaCents: 1000 }],
  },
  {
    skuPrefix: 'OUT-006',
    category: 'Outdoors',
    name: 'Beacon Headlamp',
    description:
      'Rechargeable 400-lumen headlamp with red night mode, a lockout switch, and a comfortable strap.',
    basePriceCents: 3499,
    variants: [{ label: 'Black' }],
  },
  {
    skuPrefix: 'OUT-007',
    category: 'Outdoors',
    name: 'Dry Bag 20L',
    description:
      'Roll-top waterproof dry bag with a welded seam and a shoulder strap for kayaking and camping.',
    basePriceCents: 2499,
    variants: [{ label: 'Yellow' }, { label: 'Blue' }],
  },
  {
    skuPrefix: 'OUT-008',
    category: 'Outdoors',
    name: 'Firestarter Kit',
    description:
      'Ferro rod, striker, and waterproof tinder in a compact tin for reliable campfires in wet weather.',
    basePriceCents: 1999,
    variants: [{ label: 'Standard' }],
  },
];

const ACCESSORIES: CatalogTemplate[] = [
  {
    skuPrefix: 'ACC-001',
    category: 'Accessories',
    name: 'Everyday Canvas Tote',
    description:
      'Heavyweight cotton canvas tote with an interior pocket, reinforced handles, and a flat base.',
    basePriceCents: 2499,
    variants: [{ label: 'Natural' }, { label: 'Black' }],
  },
  {
    skuPrefix: 'ACC-002',
    category: 'Accessories',
    name: 'Minimal Leather Wallet',
    description:
      'Slim full-grain leather wallet with four card slots, a cash pocket, and RFID shielding.',
    basePriceCents: 4999,
    variants: [{ label: 'Tan' }, { label: 'Black' }],
  },
  {
    skuPrefix: 'ACC-003',
    category: 'Accessories',
    name: 'Merino Beanie',
    description: 'Soft merino wool beanie with a folded cuff and a snug, itch-free knit.',
    basePriceCents: 2999,
    variants: [{ label: 'Charcoal' }, { label: 'Oat' }],
  },
  {
    skuPrefix: 'ACC-004',
    category: 'Accessories',
    name: 'Polarized Sunglasses',
    description:
      'Lightweight acetate sunglasses with polarized lenses, UV400 protection, and a hard case.',
    basePriceCents: 7999,
    variants: [{ label: 'Tortoise' }, { label: 'Black' }],
  },
  {
    skuPrefix: 'ACC-005',
    category: 'Accessories',
    name: 'Travel Organizer Pouch',
    description:
      'Zippered pouch with elastic cable loops, a mesh pocket, and a water-resistant lining.',
    basePriceCents: 1999,
    variants: [{ label: 'Small' }, { label: 'Large', priceDeltaCents: 1000 }],
  },
  {
    skuPrefix: 'ACC-006',
    category: 'Accessories',
    name: 'Keyring Multi-Tool',
    description:
      'Pocket-sized stainless multi-tool with scissors, a bottle opener, and a small screwdriver.',
    basePriceCents: 3499,
    variants: [{ label: 'Steel' }],
  },
  {
    skuPrefix: 'ACC-007',
    category: 'Accessories',
    name: 'Cotton Baseball Cap',
    description:
      'Six-panel cotton cap with an adjustable strap, curved brim, and a low-profile fit.',
    basePriceCents: 2499,
    variants: [{ label: 'Navy' }, { label: 'Stone' }],
  },
  {
    skuPrefix: 'ACC-008',
    category: 'Accessories',
    name: 'Weekender Duffel',
    description:
      'Canvas-and-leather duffel with a shoe compartment, detachable shoulder strap, and brass zips.',
    basePriceCents: 12999,
    variants: [{ label: 'Olive' }, { label: 'Black' }],
  },
  {
    skuPrefix: 'ACC-009',
    category: 'Accessories',
    name: 'Silk Sleep Mask',
    description:
      'Mulberry silk sleep mask with an adjustable strap and a soft lining that blocks light without pressure.',
    basePriceCents: 2499,
    variants: [{ label: 'Charcoal' }],
  },
];

const SPECIALS: CatalogTemplate[] = [
  {
    skuPrefix: 'HOM-901',
    category: 'Home',
    name: 'Lumen Smart Bulb',
    description:
      'Wi-Fi smart bulb with warm-to-cool white tuning and app schedules. Currently between shipments.',
    basePriceCents: 2499,
    variants: [{ label: 'E26' }],
    special: 'out-of-stock',
  },
  {
    skuPrefix: 'AUD-901',
    category: 'Audio',
    name: 'Aria Studio Microphone',
    description:
      'Cardioid condenser microphone with a shock mount, pop filter, and USB-C output for home recording.',
    basePriceCents: 13999,
    variants: [{ label: 'Black' }],
    special: 'no-reviews',
  },
  {
    skuPrefix: 'COM-901',
    category: 'Computers',
    name: 'Atlas Standing Desk',
    description:
      'Electric sit-stand desk with a bamboo top, four memory presets, cable management, and a quiet dual-motor frame.',
    basePriceCents: 49999,
    variants: [{ label: '48-inch' }],
    special: 'long-description',
  },
  {
    skuPrefix: 'COM-902',
    category: 'Computers',
    name: 'Nimbus 14 Ultrabook — Price Watch Edition',
    description:
      'The same lightweight 14-inch ultrabook with a promotional finish, used to demo price-change warnings at checkout.',
    basePriceCents: 79900,
    variants: [{ label: '16GB / 512GB' }],
    special: 'price-change',
  },
  {
    skuPrefix: 'FIT-901',
    category: 'Fitness',
    name: 'Trail Runner Merino Socks',
    description:
      'Cushioned merino running socks with a seamless toe and arch compression; sold as a two-pack.',
    basePriceCents: 1899,
    variants: [{ label: 'Two-pack' }],
  },
  {
    skuPrefix: 'OUT-901',
    category: 'Outdoors',
    name: 'Alpine Camp Stove',
    description:
      'Compact canister stove with a piezo igniter, foldable pot supports, and a stuff sack.',
    basePriceCents: 4499,
    variants: [{ label: 'Standard' }],
  },
  {
    skuPrefix: 'ACC-901',
    category: 'Accessories',
    name: 'Canvas Laptop Sleeve',
    description:
      'Padded 14-inch laptop sleeve with a waxed-canvas shell, felt lining, and a zip pocket.',
    basePriceCents: 3499,
    variants: [{ label: 'Olive' }],
  },
  {
    skuPrefix: 'HOM-902',
    category: 'Home',
    name: 'Ceramic Pour-Over Carafe',
    description:
      'Glazed ceramic carafe with a cork lid and a 600 ml capacity; pairs with the Pour-Over Coffee Kit.',
    basePriceCents: 2799,
    variants: [{ label: 'Cream' }],
  },
  {
    skuPrefix: 'AUD-902',
    category: 'Audio',
    name: 'Studio Boom Arm',
    description:
      'Desk-mounted boom arm with internal cable routing, a 360-degree swivel, and a microphone clip.',
    basePriceCents: 3999,
    variants: [{ label: 'Black' }],
  },
  {
    skuPrefix: 'COM-903',
    category: 'Computers',
    name: 'Glide XL Desk Mat',
    description:
      'Extended desk mat with a smooth cloth surface, stitched edges, and a non-slip rubber base.',
    basePriceCents: 2499,
    variants: [{ label: 'Graphite' }],
  },
];

const TEMPLATES: CatalogTemplate[] = [
  ...AUDIO,
  ...COMPUTERS,
  ...HOME,
  ...FITNESS,
  ...OUTDOORS,
  ...ACCESSORIES,
  ...SPECIALS,
];

const LONG_DESCRIPTION_SUFFIX =
  ' The desktop frame is tested to 250 lb and moves at 1.2 inches per second with a low-decibel motor, so calls and recordings stay quiet. A built-in cable tray keeps monitor, keyboard, and charging cables off the floor, and the memory controller stores four sitting and standing heights. Assembly takes about twenty minutes with the included hex key; the bamboo top is pre-finished and sealed against everyday spills. The desk ships in two boxes and includes a five-year frame warranty.';

export function buildCatalog(): CatalogProduct[] {
  const products: CatalogProduct[] = [];
  for (const template of TEMPLATES) {
    template.variants.forEach((variant, index) => {
      const variantNumber = String(index + 1).padStart(2, '0');
      const description =
        template.special === 'long-description'
          ? `${template.description}${LONG_DESCRIPTION_SUFFIX}${LONG_DESCRIPTION_SUFFIX}`
          : `${template.description} Color/finish: ${variant.label}.`;
      products.push({
        sku: `${template.skuPrefix}-${variantNumber}`,
        name: `${template.name} — ${variant.label}`,
        description,
        category: template.category,
        priceCents: template.basePriceCents + (variant.priceDeltaCents ?? 0),
        imageUrl: null,
        special: template.special,
      });
    });
  }
  return products;
}
