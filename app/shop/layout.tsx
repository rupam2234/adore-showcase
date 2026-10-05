import Link from 'next/link';

/**
 * Shared ISR window for every shop route.
 *
 * Putting it on the layout means the category nav, the filter panel and the
 * product grid all share one revalidation boundary — a product write that
 * invalidates `/shop` refreshes the nav and the facets in the same pass,
 * instead of leaving the page half-updated.
 */
export const revalidate = 300;

export default function ShopLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      {children}
      <nav className="mt-12 flex flex-wrap gap-4 border-t border-[#2B2620]/10 pt-6 text-sm">
        <Link href="/shop" className="text-[#2B2620]/60 hover:text-[#2B2620]">
          All
        </Link>
        <Link
          href="/shop/tops"
          className="text-[#2B2620]/60 hover:text-[#2B2620]"
        >
          Tops
        </Link>
        <Link
          href="/shop/bottoms"
          className="text-[#2B2620]/60 hover:text-[#2B2620]"
        >
          Bottoms
        </Link>
        <Link
          href="/shop/dresses"
          className="text-[#2B2620]/60 hover:text-[#2B2620]"
        >
          Dresses
        </Link>
        <Link
          href="/shop/outerwear"
          className="text-[#2B2620]/60 hover:text-[#2B2620]"
        >
          Outerwear
        </Link>
      </nav>
    </div>
  );
}