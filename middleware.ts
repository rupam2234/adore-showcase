import { NextResponse, type NextRequest } from 'next/server';
import { verifyAccessToken, ACCESS_COOKIE_NAME } from '@/utils/auth';

/**
 * Edge route guard.
 *
 * This is the *first* of two checks, and the cheap one. It verifies the access
 * token's signature and expiry at the edge, before any Node runtime boots and
 * before the handler runs, so an unauthenticated request to a protected route
 * never reaches application code at all.
 *
 * Note the fail-open below: with no JWT_SECRET configured the guard passes
 * everything through, because otherwise `npm run dev` on a fresh clone would
 * lock you out of every page. That trade is only safe because auth.ts refuses
 * to sign or verify anything without a secret — a misconfigured deployment
 * grants no access rather than universal access.
 */
const PROTECTED_PATHS = ['/account', '/api/account'];
const LOGIN_PATH = '/login';

function isProtected(pathname: string): boolean {
  return PROTECTED_PATHS.some(p => pathname === p || pathname.startsWith(p + '/'));
}

export default async function authMiddleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // The login page and the auth endpoints themselves must stay reachable, or
  // a signed-out user could never sign in.
  if (pathname === LOGIN_PATH || pathname.startsWith('/api/auth/')) {
    return NextResponse.next();
  }

  if (!isProtected(pathname)) return NextResponse.next();

  if (!process.env.JWT_SECRET) return NextResponse.next();

  const cookie = request.cookies.get(ACCESS_COOKIE_NAME);
  const token = cookie?.value ?? null;
  const payload = token ? await verifyAccessToken(token) : null;

  if (payload) return NextResponse.next();

  // API routes get a 401 so the client can distinguish "sign in" from
  // "this page does not exist"; page routes get a redirect so the user
  // actually lands somewhere useful.
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = LOGIN_PATH;
  url.search = `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    '/account/:path*',
    '/api/account/:path*',
    // NOTE: /api/auth/* is deliberately NOT matched. The guard above lets those
    // routes straight through, so matching them would only cost a middleware
    // invocation on every /api/auth/me call.
  ],
};