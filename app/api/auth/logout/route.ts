import { NextRequest, NextResponse } from 'next/server';
import {
  clearAuthCookies,
  REFRESH_COOKIE_NAME,
  revokeSession,
} from '@/utils/auth';

/**
 * POST /api/auth/logout
 *
 * POST rather than GET on purpose: a logout triggered by an <img> or a
 * cross-site link would let a third party sign a user out.
 */
export async function POST(request: NextRequest) {
  const refreshCookie = request.cookies.get(REFRESH_COOKIE_NAME);
  if (refreshCookie?.value) {
    try {
      await revokeSession(refreshCookie.value);
    } catch {
      // Best-effort revocation — the cookies are cleared either way, and a
      // failure here must not leave the user apparently still signed in.
    }
  }

  const cookies = clearAuthCookies();
  const response = NextResponse.json({ ok: true }, { status: 200 });
  response.cookies.set(cookies.access.name, cookies.access.value, cookies.access.options);
  response.cookies.set(cookies.refresh.name, cookies.refresh.value, cookies.refresh.options);
  // Must clear the hint too, or the client keeps asking /api/auth/me after logout.
  response.cookies.set(
    cookies.loggedIn.name,
    cookies.loggedIn.value,
    cookies.loggedIn.options
  );
  return response;
}