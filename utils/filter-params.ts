import type { ProductSort } from './products';

/**
 * Shared parsing of shop filter URL params (?q, ?sort, ?colors, ?sizes,
 * ?stock, ?min, ?max) — used by both shop pages. Values are sanitized:
 * sort is whitelist-checked, lists are comma-split, numbers fall back to
 * undefined when missing or invalid.
 */
export type ParsedShopFilters = {
  query: string;
  sort: ProductSort;
  colors: string[];
  sizes: string[];
  inStockOnly: boolean;
  minPrice?: number;
  maxPrice?: number;
};

const SORTS: ProductSort[] = ['featured', 'newest', 'price-asc', 'price-desc'];

const toList = (value: string | string[] | undefined) =>
  typeof value === 'string'
    ? value
        .split(',')
        .map(v => v.trim())
        .filter(Boolean)
    : [];

const toNumber = (value: string | string[] | undefined) => {
  const n = typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

export function parseShopFilters(
  sp: Record<string, string | string[] | undefined>
): ParsedShopFilters {
  const sortParam = typeof sp.sort === 'string' ? sp.sort : undefined;
  return {
    query: typeof sp.q === 'string' ? sp.q.trim() : '',
    sort: SORTS.includes(sortParam as ProductSort)
      ? (sortParam as ProductSort)
      : 'featured',
    colors: toList(sp.colors),
    sizes: toList(sp.sizes),
    inStockOnly: sp.stock === '1',
    minPrice: toNumber(sp.min),
    maxPrice: toNumber(sp.max),
  };
}

/** Params that must survive advanced-filter navigation. */
export function preservedParams(f: {
  query: string;
  sort: ProductSort;
}): Record<string, string | undefined> {
  return {
    q: f.query || undefined,
    sort: f.sort !== 'featured' ? f.sort : undefined,
  };
}
