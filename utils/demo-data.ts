/**
 * In-memory catalogue used when no DATABASE_URL is configured.
 *
 * WHY THIS EXISTS
 * ---------------
 * A showcase that needs a provisioned database before `npm run dev` works is a
 * worse showcase: the reviewer has to sign up for a Postgres instance before
 * they can read the code. So the read model has two transports:
 *
 *   DATABASE_URL set     -> utils/products.ts runs the real SQL (the real path)
 *   DATABASE_URL unset   -> this module, in-memory (the demo path)
 *
 * This is a fallback, NOT a reimplementation of the business logic. It builds
 * the exact same `ProductCardData` read model from a fixed catalogue so every
 * component, page and API route above it is unchanged and is genuinely the
 * code under review. Filtering, sorting and the cheapest-active-variant price
 * rule mirror the SQL semantics deliberately, including the `LATERAL`'s
 * inner-join behaviour of hiding products with no active variant.
 *
 * The same catalogue definitions are used by `scripts/seed.mjs`, so the demo
 * and a seeded database show the same products.
 */

import type { ProductCardData } from './product-format';
import { sortSizes } from './product-format';
import { CATEGORY_TREE, expandCategorySlugsForDemo } from './categories';

export type DemoOptions = {
  categorySlug?: string;
  includeChildren?: boolean;
  featuredOnly?: boolean;
  search?: string;
  sort?: 'featured' | 'newest' | 'price-asc' | 'price-desc';
  colors?: string[];
  sizes?: string[];
  inStockOnly?: boolean;
  minPrice?: number;
  maxPrice?: number;
  limit?: number;
};

type Colour = { name: string; hex: string };

const COLOURS: Colour[] = [
  { name: 'Black', hex: '#1c1c1c' },
  { name: 'Ivory', hex: '#f4f0e6' },
  { name: 'Sage', hex: '#9aa88f' },
  { name: 'Clay', hex: '#b4796a' },
  { name: 'Navy', hex: '#2b3a55' },
  { name: 'Sand', hex: '#d9c7a7' },
];

const SIZE_RUN = ['XS', 'S', 'M', 'L', 'XL'];

const MATERIALS = [
  'Cotton',
  'Linen blend',
  'Merino wool',
  'Recycled polyester',
  'Tencel',
];

const FITS = ['Regular', 'Relaxed', 'Slim', 'Oversized', 'Cropped'];

/** Must stay in step with the PRODUCTS list in scripts/seed.mjs. */
const CATALOGUE: Array<{
  name: string;
  category: string;
  price: number;
  featured: boolean;
}> = [
  { name: 'Placeholder Linen Shirt', category: 'blouses', price: 68, featured: true },
  { name: 'Sample Everyday Tee', category: 't-shirts', price: 24, featured: true },
  { name: 'Mock Knit Cardigan', category: 'blouses', price: 92, featured: false },
  { name: 'Example Wrap Dress', category: 'dresses', price: 118, featured: true },
  { name: 'Demo Pleated Midi', category: 'midi-dresses', price: 134, featured: false },
  { name: 'Test Wide-Leg Trouser', category: 'trousers', price: 88, featured: false },
  { name: 'Sample A-Line Skirt', category: 'skirts', price: 62, featured: false },
  { name: 'Placeholder Trench Coat', category: 'outerwear', price: 195, featured: true },
  { name: 'Demo Wool Scarf', category: 'accessories', price: 34, featured: false },
  { name: 'Sample Cotton Blouse', category: 'blouses', price: 58, featured: false },
  { name: 'Mock Striped Tee', category: 't-shirts', price: 29, featured: false },
  { name: 'Example Denim Jacket', category: 'outerwear', price: 142, featured: false },
  { name: 'Test Slip Dress', category: 'dresses', price: 108, featured: true },
  { name: 'Sample Pleated Skirt', category: 'skirts', price: 66, featured: false },
  { name: 'Placeholder Jogger', category: 'bottoms', price: 72, featured: false },
  { name: 'Demo Satin Blouse', category: 'blouses', price: 84, featured: false },
  { name: 'Mock Graphic Tee', category: 't-shirts', price: 26, featured: false },
  { name: 'Example Wrap Skirt', category: 'skirts', price: 59, featured: false },
  { name: 'Test Quilted Vest', category: 'outerwear', price: 118, featured: false },
  { name: 'Sample Wool Beanie', category: 'accessories', price: 28, featured: false },
];

/**
 * Deterministic PRNG, identical in intent to the seed script's mulberry32.
 *
 * Fixed seed so the demo catalogue is byte-identical on every reload -- a
 * reviewer refreshing the page sees a stable grid rather than a reshuffled one.
 */
function makeRng(seed = 42) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function categoryName(slug: string): string {
  for (const parent of CATEGORY_TREE) {
    if (parent.slug === slug) return parent.name;
    const child = parent.children?.find(c => c.slug === slug);
    if (child) return child.name;
  }
  return slug;
}

/** Parent slug for a category, or null when it is itself a top-level node. */
function parentSlugOf(slug: string): string | null {
  for (const parent of CATEGORY_TREE) {
    if (parent.children?.some(c => c.slug === slug)) return parent.slug;
  }
  return null;
}

/**
 * Build the catalogue once per process and memoise it.
 *
 * Module scope rather than per-request so repeated renders (and the 20
 * generateStaticParams calls at build time) do not rebuild it. Next.js keeps a
 * module instance alive for the process, which is exactly the lifetime wanted.
 */
function buildCatalogue(): ProductCardData[] {
  const rng = makeRng();
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];

  return CATALOGUE.map(p => {
    const slug = slugify(p.name);

    // Two colours x a 3-5 size run, matching the seed script so the demo and a
    // seeded database agree.
    const colours = [...COLOURS].sort(() => rng() - 0.5).slice(0, 2);
    const sizes = SIZE_RUN.slice(0, 3 + Math.floor(rng() * 3));

    const variants = colours.flatMap(colour =>
      sizes.map(size => {
        const price = (p.price + Math.round(rng() * 20 - 10)).toFixed(2);
        return {
          id: `v-${slug}-${colour.name}-${size}`,
          color: colour.name,
          colorHex: colour.hex,
          size,
          price,
          compareAtPrice: rng() < 0.3 ? (Number(price) + 15).toFixed(2) : null,
          stock: Math.floor(rng() * 14),
        };
      })
    );

    // The size rollup: one row per size, mirroring the GROUP BY subquery.
    const rolledSizes = sortSizes([...new Set(sizes)]).map(size => {
      const forSize = variants.filter(v => v.size === size);
      const cheapest = [...forSize].sort((a, b) => Number(a.price) - Number(b.price))[0]!;
      return {
        size,
        stock: forSize.reduce((sum, v) => sum + v.stock, 0),
        price: cheapest.price,
        compareAtPrice: cheapest.compareAtPrice,
      };
    });

    // The cheapest ACTIVE variant -- what the SQL LATERAL returns.
    const cheapest = [...variants].sort((a, b) => Number(a.price) - Number(b.price))[0]!;

    return {
      id: `p-${slug}`,
      slug,
      name: p.name,
      shortDescription: `Placeholder ${p.category.replace('-', ' ')} sample product used to demonstrate the catalogue read model.`,
      details: [
        'Sample item — placeholder content only',
        'Fabric and care details are illustrative',
        'No real product is represented here',
      ],
      material: pick(MATERIALS),
      fit: pick(FITS),
      categories: [
        { slug: p.category, name: categoryName(p.category), parentSlug: parentSlugOf(p.category) },
      ],
      price: cheapest.price,
      compareAtPrice: cheapest.compareAtPrice,
      isFeatured: p.featured,
      currency: 'USD',
      colors: colours.map(c => ({ name: c.name, hex: c.hex })),
      sizes: rolledSizes,
      variants,
      totalStock: variants.reduce((sum, v) => sum + v.stock, 0),
      images: [0, 1].map(n => ({
        id: `i-${slug}-${n}`,
        url: `/images/placeholder-${slug}-${n + 1}.svg`,
        alt: `Placeholder illustration for ${p.name}`,
        isPrimary: n === 0,
      })),
    } satisfies ProductCardData;
  });
}

let cached: ProductCardData[] | null = null;

export function getDemoCatalogue(): ProductCardData[] {
  if (!cached) cached = buildCatalogue();
  return cached;
}

const ACTIVE = getDemoCatalogue().filter(p => p.totalStock >= 0);

/**
 * Demo equivalent of `getProductsForSection`, matching the SQL semantics:
 * category expands to include children, every filter is an AND, sort is
 * whitelist-based, and `limit` is applied last.
 */
export function getDemoProducts(options: DemoOptions = {}): ProductCardData[] {
  const {
    categorySlug,
    includeChildren = true,
    featuredOnly = false,
    search,
    sort = 'featured',
    colors,
    sizes,
    inStockOnly = false,
    minPrice,
    maxPrice,
    limit = 8,
  } = options;

  // `totalStock >= 0` is always true; the filter is here to mirror the SQL
  // LATERAL, which drops products with no active variant.
  let rows = ACTIVE.filter(p => p.variants.length > 0);

  if (categorySlug && categorySlug !== 'all') {
    const slugs = includeChildren
      ? expandCategorySlugsForDemo(categorySlug)
      : [categorySlug];
    rows = rows.filter(p => p.categories.some(c => slugs.includes(c.slug)));
  }

  if (featuredOnly) rows = rows.filter(p => p.isFeatured);

  if (search) {
    const needle = search.toLowerCase();
    rows = rows.filter(
      p =>
        p.name.toLowerCase().includes(needle) ||
        (p.shortDescription ?? '').toLowerCase().includes(needle)
    );
  }

  if (colors?.length) {
    rows = rows.filter(p => p.variants.some(v => colors.includes(v.color)));
  }
  if (sizes?.length) {
    rows = rows.filter(p => p.variants.some(v => sizes.includes(v.size)));
  }
  if (inStockOnly) rows = rows.filter(p => p.variants.some(v => v.stock > 0));

  const price = Number;
  if (minPrice != null) rows = rows.filter(p => price(p.price) >= minPrice);
  if (maxPrice != null) rows = rows.filter(p => price(p.price) <= maxPrice);

  switch (sort) {
    case 'newest':
      // The catalogue is authored newest-first, so this is a stable no-op.
      break;
    case 'price-asc':
      rows = [...rows].sort((a, b) => price(a.price) - price(b.price));
      break;
    case 'price-desc':
      rows = [...rows].sort((a, b) => price(b.price) - price(a.price));
      break;
    case 'featured':
      rows = [...rows].sort(
        (a, b) => Number(b.isFeatured) - Number(a.isFeatured)
      );
      break;
  }

  return rows.slice(0, limit);
}

/** Demo equivalent of `getProductBySlug`: null when not found or inactive. */
export function getDemoProduct(slug: string): ProductCardData | null {
  return ACTIVE.find(p => p.slug === slug) ?? null;
}

/** Demo equivalent of `getActiveProductSlugs`, feeding generateStaticParams. */
export function getDemoSlugs(): string[] {
  return ACTIVE.map(p => p.slug);
}

/** Demo equivalent of `getFilterFacets`. */
export function getDemoFacets(categorySlug?: string): {
  colors: { name: string; hex: string | null }[];
  sizes: string[];
} {
  let rows = ACTIVE;
  if (categorySlug && categorySlug !== 'all') {
    const slugs = expandCategorySlugsForDemo(categorySlug);
    rows = rows.filter(p => p.categories.some(c => slugs.includes(c.slug)));
  }

  const colorMap = new Map<string, string | null>();
  const sizeSet = new Set<string>();
  for (const p of rows) {
    for (const v of p.variants) {
      if (!colorMap.has(v.color)) colorMap.set(v.color, v.colorHex);
      sizeSet.add(v.size);
    }
  }

  return {
    colors: [...colorMap]
      .map(([name, hex]) => ({ name, hex }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    sizes: sortSizes([...sizeSet]),
  };
}
