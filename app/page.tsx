import Link from 'next/link';
import { ProductCard } from '@/components/shop/product-card';
import { getProductsForSection } from '@/utils/products';
import { sampleWithoutReplacement } from '@/utils/random';

/**
 * The homepage is statically generated and revalidated every 5 minutes.
 *
 * WHY ISR HERE
 * ------------
 * The homepage is the single most-requested page and its content changes only
 * when a product is added or edited. Rendering it per request meant paying a
 * full catalogue query on every hit; leaving it fully static would mean a
 * product edit waited for the next deploy. `revalidate` gives a bounded answer:
 * zero queries on a cache hit, at most 5 minutes of staleness otherwise.
 */
export const revalidate = 300;

export default async function HomePage() {
  // Two independent reads run concurrently rather than in sequence — awaiting
  // the first before starting the second would make page latency the SUM of
  // both queries instead of the slower of the two.
  const [featured, latestPool] = await Promise.all([
    getProductsForSection({ featuredOnly: true, limit: 8 }),
    getProductsForSection({ sort: 'newest', limit: 24 }),
  ]);

  // "Latest arrivals" deliberately varies per request instead of always showing
  // the same newest items. The sample is taken in JS from an already-fetched,
  // indexed page of results rather than with SQL `ORDER BY random()`, which
  // would force the database to sort the entire catalogue with no index to
  // serve it. See utils/random.ts.
  const latest = sampleWithoutReplacement(latestPool, 8);

  return (
    <main>
      <section className="bg-[#2B2620] py-20 text-[#FAF8F3]">
        <div className="mx-auto max-w-6xl px-4">
          <h1 className="font-serif text-4xl font-semibold sm:text-5xl">
            An engineering showcase
          </h1>
          <p className="mt-4 max-w-2xl text-[#FAF8F3]/70">
            A sanitized extract of a production Next.js commerce platform.
            The architecture is real: ISR, atomic query models, tag-based cache
            invalidation, edge rate limiting and rotating JWT sessions. The
            products, imagery and copy are placeholders.
          </p>
          <Link
            href="/shop"
            className="mt-8 inline-block rounded-full bg-[#FAF8F3] px-6 py-3 text-sm font-medium text-[#2B2620]"
          >
            Browse the catalogue
          </Link>
        </div>
      </section>

      {featured.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 py-14">
          <h2 className="font-serif text-2xl font-semibold">Featured</h2>
          <div className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
            {featured.map(p => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}

      {latest.length > 0 && (
        <section className="mx-auto max-w-6xl px-4 pb-14">
          <h2 className="font-serif text-2xl font-semibold">Latest arrivals</h2>
          <p className="mt-1 text-sm text-[#2B2620]/60">
            Reshuffled per request from the newest 24 — see{' '}
            <code className="text-xs">utils/random.ts</code>.
          </p>
          <div className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
            {latest.map(p => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}