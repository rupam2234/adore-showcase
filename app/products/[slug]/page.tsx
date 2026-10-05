import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getActiveProductSlugs,
  getProductBySlug,
  getProductsForSection,
} from '@/utils/products';
import { formatPrice, primaryImage } from '@/utils/product-format';

/**
 * Prerender every shippable product at build time.
 *
 * `getActiveProductSlugs` deliberately uses the SAME predicate as
 * `getProductBySlug` (ACTIVE + at least one active variant). If these two
 * disagreed, the build would emit pages that render `notFound()` â€” static
 * output for URLs that can never work.
 *
 * `dynamicParams = false` then makes the set exhaustive: any slug not returned
 * here 404s instead of triggering an on-demand render. With a catalogue of
 * this size that is the right trade â€” it turns an unknown URL from a database
 * query into an immediate rejection, and one that cannot be used to probe for
 * valid slugs at database cost.
 */
export async function generateStaticParams() {
  const slugs = await getActiveProductSlugs();
  return slugs.map(slug => ({ slug }));
}

export const dynamicParams = false;

/**
 * ISR window for the product page. A product edit therefore appears within 5
 * minutes even without an explicit tag invalidation; in production an admin
 * write calls `revalidatePath` so the change is immediate and this is only the
 * backstop.
 */
export const revalidate = 300;

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return { title: 'Product not found' };

  const description =
    product.shortDescription ??
    product.details[0] ??
    `${product.name} â€” product detail`;
  const image = primaryImage(product);
  return {
    title: product.name,
    description,
    openGraph: {
      title: product.name,
      description,
      // Relative path: the absolute URL is resolved against the request origin,
      // so the same code works on a preview deploy and in production without a
      // hardcoded site URL.
      images: image ? [image.url] : undefined,
    },
  };
}

export default async function ProductPage({ params }: Params) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();

  // Related products reuse the same atomic read model, scoped to this
  // product's first category.
  const related = (
    await getProductsForSection({
      categorySlug: product.categories[0]?.slug,
      limit: 4,
    })
  ).filter(p => p.id !== product.id);

  const image = primaryImage(product);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <nav className="text-sm text-[#2B2620]/50">
        <Link href="/shop" className="hover:text-[#2B2620]">
          Shop
        </Link>
        <span className="mx-2">/</span>
        <span className="text-[#2B2620]/80">{product.name}</span>
      </nav>

      <div className="mt-6 grid gap-10 lg:grid-cols-2">
        <div className="relative aspect-[4/5] overflow-hidden rounded-xl bg-white">
          {image && (
            <Image
              src={image.url}
              alt={image.alt ?? product.name}
              fill
              sizes="(min-width: 1024px) 50vw, 100vw"
              className="object-cover"
              // The hero image is the page's LCP element, so it must not be
              // lazy-loaded â€” a lazy LCP image delays the largest paint.
              priority
            />
          )}
        </div>

        <div>
          <h1 className="font-serif text-3xl font-semibold">{product.name}</h1>

          {product.shortDescription && (
            <p className="mt-3 text-[#2B2620]/70">{product.shortDescription}</p>
          )}

          <div className="mt-4 flex items-baseline gap-3">
            <span className="text-2xl font-semibold">
              {formatPrice(product.price, product.currency)}
            </span>
            {product.compareAtPrice && (
              <span className="text-[#2B2620]/40 line-through">
                {formatPrice(product.compareAtPrice, product.currency)}
              </span>
            )}
          </div>

          {product.material && (
            <p className="mt-4 text-sm">
              <span className="text-[#2B2620]/50">Material: </span>
              {product.material}
            </p>
          )}
          {product.fit && (
            <p className="mt-1 text-sm">
              <span className="text-[#2B2620]/50">Fit: </span>
              {product.fit}
            </p>
          )}

          <div className="mt-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[#2B2620]/60">
              Colours
            </h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {product.colors.map(c => (
                <span
                  key={c.name}
                  className="inline-flex items-center gap-2 rounded-full border border-[#2B2620]/15 px-3 py-1 text-sm"
                >
                  <span
                    aria-hidden
                    className="h-3 w-3 rounded-full border border-[#2B2620]/20"
                    style={{ background: c.hex ?? '#ddd' }}
                  />
                  {c.name}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-[#2B2620]/60">
              Sizes
            </h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {product.sizes.map(s => (
                <span
                  key={s.size}
                  className="rounded-lg border border-[#2B2620]/15 px-4 py-2 text-sm"
                >
                  {s.size}
                  {s.stock === 0 && (
                    <span className="ml-2 text-xs text-[#2B2620]/40">
                      sold out
                    </span>
                  )}
                </span>
              ))}
            </div>
          </div>

          {product.details.length > 0 && (
            <div className="mt-8">
              <h2 className="font-serif text-lg font-semibold">Details</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[#2B2620]/70">
                {product.details.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {related.length > 0 && (
        <section className="mt-16">
          <h2 className="font-serif text-2xl font-semibold">You may also like</h2>
          <p className="mt-1 text-sm text-[#2B2620]/60">
            Sourced from the same atomic read model.
          </p>
          <div className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-4">
            {related.map(p => (
              <Link
                key={p.id}
                href={`/products/${p.slug}`}
                className="rounded-lg bg-white p-3 text-sm shadow-sm hover:shadow-md"
              >
                {p.name}
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
