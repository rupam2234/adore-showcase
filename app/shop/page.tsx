import type { Metadata } from 'next';
import { ProductCard } from '@/components/shop/product-card';
import { FilterPanel } from '@/components/shop/filter-panel';
import { getFilterFacets, getProductsForSection } from '@/utils/products';
import { parseShopFilters } from '@/utils/filter-params';

export const metadata: Metadata = {
  title: 'Shop',
  description: 'Browse the full catalogue.',
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The shop listing.
 *
 * Note what is NOT here: no `revalidate` export and no `force-dynamic`. The
 * parent `app/shop/layout.tsx` sets `revalidate = 300`, and in Next.js a child
 * page without its own dynamic API usage inherits the layout's static/ISR
 * behaviour. Filter combinations are therefore prerendered on demand and then
 * cached — the first visitor to a given filter URL pays the render, everyone
 * after is a cache hit.
 *
 * searchParams opts this route into dynamic rendering for the *params*, which
 * is what makes each filter combination addressable on its own.
 */
export default async function ShopPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;

  // Every filter value is validated and coerced here, before it can reach a
  // query. `sort` is whitelist-checked, lists are split and trimmed, numbers
  // fall back to undefined rather than NaN.
  const filters = parseShopFilters(sp);

  // Facets and products are independent reads — run them concurrently so the
  // page costs one round trip's latency rather than two serial ones.
  const [products, facets] = await Promise.all([
    getProductsForSection({
      categorySlug: typeof sp.category === 'string' ? sp.category : undefined,
      search: filters.query,
      sort: filters.sort,
      colors: filters.colors,
      sizes: filters.sizes,
      inStockOnly: filters.inStockOnly,
      minPrice: filters.minPrice,
      maxPrice: filters.maxPrice,
      limit: 24,
    }),
    getFilterFacets(typeof sp.category === 'string' ? sp.category : undefined),
  ]);

  return (
    <main>
      <h1 className="font-serif text-3xl font-semibold">
        {filters.query ? `Results for “${filters.query}”` : 'All products'}
      </h1>
      <p className="mt-1 text-sm text-[#2B2620]/60">
        {products.length} product{products.length === 1 ? '' : 's'}
      </p>

      <div className="mt-8 grid gap-10 lg:grid-cols-[220px_1fr]">
        <FilterPanel facets={facets} filters={filters} />

        <div>
          {products.length === 0 ? (
            <p className="rounded-lg bg-white p-8 text-center text-[#2B2620]/60">
              Nothing matches those filters.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-6 sm:grid-cols-3">
              {products.map(p => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}