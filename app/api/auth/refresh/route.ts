import { NextRequest, NextResponse } from 'next/server';
import {
  refreshTokens,
  setAuthCookies,
  REFRESH_COOKIE_NAME,
} from '@/utils/auth';
import { rateLimit } from '@/utils/rate-limit';

/**
 * Bounded because this is the one endpoint an attacker can hammer with junk
 * tokens, and each attempt costs a signature verification plus a database
 * lookup. Keyed on the client, so one attacker cannot lock everyone else out.
 */
const REFRESH_LIMIT = { limit: 30, windowMs: 60 * 1000 };

function clientKey(request: NextRequest): string {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  return `refresh:${ip}`;
}

/**
 * POST /api/auth/refresh
 *
 * Exchanges the refresh cookie for a new token pair. The old refresh token is
 * revoked as part of the exchange (rotation), so a captured one is only ever
 * usable once.
 */
export async function POST(request: NextRequest) {
  const { allowed, retryAfterSeconds } = rateLimit(
    clientKey(request),
    REFRESH_LIMIT
  );
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }
    );
  }

  const cookie = request.cookies.get(REFRESH_COOKIE_NAME);
  if (!cookie?.value) {
    return NextResponse.json({ error: 'No refresh token' }, { status: 401 });
  }

  try {
    const { accessToken, refreshToken } = await refreshTokens(cookie.value);
    const cookies = setAuthCookies(accessToken, refreshToken);
    const response = NextResponse.json({ ok: true }, { status: 200 });
    response.cookies.set(cookies.access.name, cookies.access.value, cookies.access.options);
    response.cookies.set(cookies.refresh.name, cookies.refresh.value, cookies.refresh.options);
    response.cookies.set(
      cookies.loggedIn.name,
      cookies.loggedIn.value,
      cookies.loggedIn.options
    );
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (err) {
    // A failure here means the token was invalid, expired or already revoked —
    // clear the cookies so the client stops retrying with a dead token.
    const cookies = setAuthCookies('', '');
    const response = NextResponse.json(
      { error: (err as Error).message },
      { status: 401 }
    );
    response.cookies.set(cookies.access.name, '', { ...cookies.access.options, maxAge: 0 });
    response.cookies.set(cookies.refresh.name, '', { ...cookies.refresh.options, maxAge: 0 });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
}