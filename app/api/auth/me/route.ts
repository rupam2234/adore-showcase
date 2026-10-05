import { NextRequest, NextResponse } from 'next/server';
import {
  getUserById,
  verifyAccessToken,
  ACCESS_COOKIE_NAME,
  loginHintCookie,
} from '@/utils/auth';

/**
 * Attach the client-readable login hint so the UI never has to guess the
 * session state. This is the one route that learns whether the browser is
 * signed in without issuing new tokens, so it is where the hint gets corrected
 * (e.g. after the access token expires) instead of every page load asking.
 */
function withLoginHint(response: NextResponse, value: '0' | '1'): NextResponse {
  const hint = loginHintCookie(value);
  response.cookies.set(hint.name, hint.value, hint.options);
  // This route returns user-specific data (or a 401 that depends on the
  // caller's cookies), so it must never be cached by a browser, proxy or CDN.
  // `Set-Cookie` already deters CDNs, but stating it makes the intent explicit
  // instead of relying on that heuristic.
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

/**
 * GET /api/auth/me
 *   Returns the current user from the access token cookie.
 *   401 if not authenticated.
 */
export async function GET(request: NextRequest) {
  const cookie = request.cookies.get(ACCESS_COOKIE_NAME);
  if (!cookie?.value) {
    return withLoginHint(
      NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
      '0'
    );
  }

  const payload = await verifyAccessToken(cookie.value);
  if (!payload) {
    return withLoginHint(
      NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 }),
      '0'
    );
  }

  const user = await getUserById(payload.userId);
  if (!user) {
    return withLoginHint(
      NextResponse.json({ error: 'User not found' }, { status: 401 }),
      '0'
    );
  }

  return withLoginHint(
    NextResponse.json(
      {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
      },
      { status: 200 }
    ),
    '1'
  );
}