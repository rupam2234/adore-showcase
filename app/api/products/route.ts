import { NextResponse, type NextRequest } from 'next/server';
import { getProductsForSection } from '@/utils/products';
import { rateLimit } from '@/utils/rate-limit';
import { parseShopFilters } from '@/utils/filter-params';

/**
 * Read budget for the public catalogue endpoint.
 *
 * 120 requests / minute per client is far above interactive use (a shopper
 * paging the grid issues single digits) while still capping a scraper, and it
 * is high enough that a burst from a shared office NAT is not punished.
 */
const LIST_LIMIT = { limit: 120, windowMs: 60 * 1000 };

/**
 * Identify the caller for rate-limiting purposes.
 *
 * Deliberately NOT the IP for this route. On serverless the address is often a
 * platform proxy's rather than the client's, so an IP key either lumps unrelated
 * users together or (worse) lumps everyone together — punishing a whole
 * office or NAT'd household for one noisy client. The refresh-token cookie is a
 * stable per-browser identity when present, so that is preferred; otherwise we
 * fall back to the forwarded IP.
 *
 * `x-forwarded-for` is a comma-separated chain; the FIRST entry is the
 * original client. Reading it as a whole would key on a string that differs
 * depending on how many proxies are in front of you.
 */
function clientKey(request: NextRequest): string {
  const refresh = request.cookies.get('showcase_refresh_token')?.value;
  if (refresh) return `t:${refresh}`;

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return ip ? `ip:${ip}` : 'ip:unknown';
}

/**
 * GET /api/products
 *
 * The same atomic read model the server components use, exposed as JSON.
 * Sharing `getProductsForSection` between the page and the API is the point:
 * there is one definition of "a product card", so the two can never drift.
 */
export async function GET(request: NextRequest) {
  const { allowed, remaining, retryAfterSeconds } = rateLimit(
    clientKey(request),
    LIST_LIMIT
  );

  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      {
        status: 429,
        // `Retry-After` is the standard header clients already know how to
        // honour; the body carries the same value for convenience.
        headers: {
          'Retry-After': String(retryAfterSeconds),
          'X-RateLimit-Remaining': '0',
        },
      }
    );
  }

  const sp = request.nextUrl.searchParams;
  const filters = parseShopFilters(Object.fromEntries(sp.entries()));

  // Cap the limit server-side. Without this a client could ask for
  // limit=100000 and turn one request into a full-catalogue dump — the page
  // always passes a sane value, so this only ever defends the API.
  const requested = Number(sp.get('limit') ?? '24');
  const limit = Math.min(Math.max(Number.isFinite(requested) ? requested : 24, 1), 60);

  try {
    const products = await getProductsForSection({
      search: filters.query,
      sort: filters.sort,
      colors: filters.colors,
      sizes: filters.sizes,
      inStockOnly: filters.inStockOnly,
      minPrice: filters.minPrice,
      maxPrice: filters.maxPrice,
      limit,
    });

    return NextResponse.json(
      { products, count: products.length },
      {
        headers: {
          'X-RateLimit-Remaining': String(remaining),
          // Short shared-cache window: several shoppers will hit the same
          // filter combination, and the underlying page is already ISR-cached.
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
        },
      }
    );
  } catch (err) {
    console.error('[GET /api/products]', (err as Error).message);
    // Never surface the driver message to the client: it can name columns and
    // constraints. The detail is logged server-side instead.
    return NextResponse.json({ error: 'Could not load products' }, { status: 500 });
  }
}