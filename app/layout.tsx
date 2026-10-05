import type { Metadata } from 'next';
import './globals.css';
import { SiteHeader } from '@/components/theme/header';

export const metadata: Metadata = {
  // Relative metadata image paths need an absolute base to resolve against.
  // Reads from the env so a preview deploy needs no code change; falls back to
  // the local origin so `npm run dev` and `npm run build` work with no setup.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  title: {
    default: 'Adore Showcase (Sanitized)',
    template: '%s | Adore Showcase',
  },
  description:
    'A sanitized engineering showcase of a Next.js commerce platform: SSG, atomic Drizzle queries, caching, rate limiting and JWT sessions.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#FAF8F3] text-[#2B2620] antialiased">
        <SiteHeader />
        {children}
        <footer className="mt-16 border-t border-[#2B2620]/10 py-10">
          <div className="mx-auto max-w-6xl px-4 text-sm text-[#2B2620]/60">
            <p className="font-semibold text-[#2B2620]/80">
              Adore Showcase — sanitized demo
            </p>
            <p className="mt-1 max-w-2xl">
              This repository is a public, sanitized extract built to demonstrate
              engineering patterns. The production source is private. All
              products, imagery and copy are placeholders.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}