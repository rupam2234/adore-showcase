import Link from 'next/link';

/**
 * Site chrome. Kept deliberately small — in the showcase this exists to prove
 * the layout/ISR composition works, not to ship the production navigation.
 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-10 border-b border-[#2B2620]/10 bg-[#FAF8F3]/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-4">
        <Link href="/" className="font-serif text-xl font-semibold tracking-tight">
          Adore <span className="font-sans text-xs uppercase tracking-[0.2em] text-[#2B2620]/50">Showcase</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/shop" className="text-[#2B2620]/70 hover:text-[#2B2620]">
            Shop
          </Link>
          <Link href="/login" className="text-[#2B2620]/70 hover:text-[#2B2620]">
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  );
}