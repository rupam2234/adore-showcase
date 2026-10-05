'use client';

import { useRouter } from 'next/navigation';
import type { ParsedShopFilters } from '@/utils/filter-params';

type Facets = {
  colors: { name: string; hex: string | null }[];
  sizes: string[];
};

/**
 * The advanced filter panel.
 *
 * Filtering happens in the URL, not in component state, which is what makes a
 * filtered view shareable, bookmarkable and back-button-correct. The facet
 * OPTIONS are passed in already computed (and cache-tagged) by the server; this
 * component only assembles a query string.
 *
 * Facets are deliberately NOT narrowed by the current selection — the panel
 * always offers every available option so a shopper can widen a filter without
 * first clearing it.
 */
export function FilterPanel({
  facets,
  filters,
}: {
  facets: Facets;
  filters: ParsedShopFilters;
}) {
  const router = useRouter();

  /** Merge one filter change into the URL and navigate. */
  const apply = (next: Partial<ParsedShopFilters>) => {
    const merged = { ...filters, ...next };
    const params = new URLSearchParams();
    if (merged.query) params.set('q', merged.query);
    if (merged.sort !== 'featured') params.set('sort', merged.sort);
    if (merged.colors.length) params.set('colors', merged.colors.join(','));
    if (merged.sizes.length) params.set('sizes', merged.sizes.join(','));
    if (merged.inStockOnly) params.set('stock', '1');
    if (merged.minPrice != null) params.set('min', String(merged.minPrice));
    if (merged.maxPrice != null) params.set('max', String(merged.maxPrice));
    // `scroll: false` keeps the viewport where the shopper left it — with 24
    // products a scroll reset on every toggle is disorienting.
    router.push(`/shop?${params.toString()}`, { scroll: false });
  };

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter(v => v !== value) : [...list, value];

  return (
    <aside className="space-y-8 text-sm">
      <div>
        <label
          htmlFor="shop-search"
          className="block font-semibold text-[#2B2620]/70"
        >
          Search
        </label>
        <input
          id="shop-search"
          type="search"
          defaultValue={filters.query}
          placeholder="Search products"
          onChange={e => apply({ query: e.target.value })}
          className="mt-2 w-full rounded-lg border border-[#2B2620]/15 bg-white px-3 py-2"
        />
      </div>

      <div>
        <span className="block font-semibold text-[#2B2620]/70">Sort</span>
        <select
          value={filters.sort}
          onChange={e => apply({ sort: e.target.value as ParsedShopFilters['sort'] })}
          className="mt-2 w-full rounded-lg border border-[#2B2620]/15 bg-white px-3 py-2"
        >
          <option value="featured">Featured</option>
          <option value="newest">Newest</option>
          <option value="price-asc">Price: low to high</option>
          <option value="price-desc">Price: high to low</option>
        </select>
      </div>

      <div>
        <span className="block font-semibold text-[#2B2620]/70">Colour</span>
        <div className="mt-2 space-y-1">
          {facets.colors.map(c => (
            <label key={c.name} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={filters.colors.includes(c.name)}
                onChange={() => apply({ colors: toggle(filters.colors, c.name) })}
              />
              <span
                aria-hidden
                className="h-3 w-3 rounded-full border border-[#2B2620]/20"
                style={{ background: c.hex ?? '#ddd' }}
              />
              {c.name}
            </label>
          ))}
        </div>
      </div>

      <div>
        <span className="block font-semibold text-[#2B2620]/70">Size</span>
        <div className="mt-2 flex flex-wrap gap-3">
          {facets.sizes.map(s => (
            <label key={s} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={filters.sizes.includes(s)}
                onChange={() => apply({ sizes: toggle(filters.sizes, s) })}
              />
              {s}
            </label>
          ))}
        </div>
      </div>

      <div>
        <span className="block font-semibold text-[#2B2620]/70">Price</span>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="number"
            min={0}
            placeholder="Min"
            defaultValue={filters.minPrice}
            onChange={e =>
              apply({ minPrice: e.target.value ? Number(e.target.value) : undefined })
            }
            className="w-20 rounded-lg border border-[#2B2620]/15 bg-white px-2 py-1"
          />
          <span className="text-[#2B2620]/40">–</span>
          <input
            type="number"
            min={0}
            placeholder="Max"
            defaultValue={filters.maxPrice}
            onChange={e =>
              apply({ maxPrice: e.target.value ? Number(e.target.value) : undefined })
            }
            className="w-20 rounded-lg border border-[#2B2620]/15 bg-white px-2 py-1"
          />
        </div>
      </div>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={filters.inStockOnly}
          onChange={e => apply({ inStockOnly: e.target.checked })}
        />
        In stock only
      </label>
    </aside>
  );
}