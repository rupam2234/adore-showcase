import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col items-center px-4 py-24 text-center">
      <p className="text-sm uppercase tracking-[0.2em] text-[#2B2620]/50">
        404
      </p>
      <h1 className="mt-3 font-serif text-3xl font-semibold">
        We couldn&apos;t find that page
      </h1>
      <p className="mt-3 text-[#2B2620]/60">
        The link may be out of date, or the product may no longer be listed.
      </p>
      <Link
        href="/shop"
        className="mt-8 rounded-full bg-[#2B2620] px-6 py-3 text-sm font-medium text-[#FAF8F3]"
      >
        Back to the shop
      </Link>
    </main>
  );
}