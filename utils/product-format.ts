/**
 * Product types and pure formatting helpers.
 *
 * Everything here is dependency-free and side-effect-free, so it can be
 * imported by client components without pulling the DB into the browser bundle.
 */

export type ProductCategory = {
  slug: string;
  name: string;
  parentSlug: string | null;
};

export type ProductImage = {
  id: string;
  url: string;
  alt: string | null;
  isPrimary: boolean;
};

export type ProductVariantOption = {
  id: string;
  color: string;
  colorHex: string | null;
  size: string;
  price: string;
  compareAtPrice: string | null;
  stock: number;
};

/** A size rollup across colours: total stock and the cheapest price. */
export type ProductSizeOption = {
  size: string;
  stock: number;
  price: string;
  compareAtPrice: string | null;
};

/**
 * The single read model every product surface consumes â€” the listing card, the
 * detail page and the API all return exactly this shape. One shape means one
 * component can render a card from any of them.
 */
export type ProductCardData = {
  id: string;
  slug: string;
  name: string;
  shortDescription: string | null;
  details: string[];
  material: string | null;
  fit: string | null;
  categories: ProductCategory[];
  /** Drives the featured-first sort and the featured-only listing. */
  isFeatured: boolean;
  price: string;
  compareAtPrice: string | null;
  currency: string;
  colors: Array<{ name: string; hex: string | null }>;
  sizes: ProductSizeOption[];
  variants: ProductVariantOption[];
  totalStock: number;
  images: ProductImage[];
};

/**
 * Apparel size order.
 *
 * A lexicographic sort would produce XS, XXL, XL â€” because "XXL" < "XL" as
 * strings. This is the one ordering a size dropdown has to get right, so it is
 * defined once and used by both the SQL CASE expression and this function.
 */
const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', 'XXL'] as const;

export function sortSizes(sizes: string[]): string[] {
  return [...sizes].sort((a, b) => {
    const ia = SIZE_ORDER.indexOf(a as (typeof SIZE_ORDER)[number]);
    const ib = SIZE_ORDER.indexOf(b as (typeof SIZE_ORDER)[number]);
    // Unknown sizes sort last but keep a stable alphabetical order among
    // themselves, rather than all collapsing to rank -1.
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

/**
 * Money comes back from Postgres `numeric` as a string, deliberately â€” parsing
 * it into a JS number would introduce float drift in a currency column.
 * Formatting happens once, at the edge of the render, never in the query.
 */
export function formatPrice(
  amount: string | number | null | undefined,
  currency: string = 'USD'
): string {
  if (amount == null) return '';
  const value = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(value)) return '';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(value);
}

/** Primary image, falling back to the first, so a card always has something. */
export function primaryImage(product: ProductCardData): ProductImage | null {
  return product.images.find(i => i.isPrimary) ?? product.images[0] ?? null;
}
