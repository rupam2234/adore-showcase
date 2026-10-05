import { cookies } from 'next/headers';
import { verifyAccessToken, ACCESS_COOKIE_NAME } from './auth';

/**
 * Resolve the signed-in user from the request's cookies.
 *
 * The token is verified (signature + expiry) but NOT checked against the
 * sessions table — that table gates *refresh*, not every read. Middleware has
 * already rejected an invalid access token before a route handler runs, so
 * re-querying the DB on every server component would add a round trip to
 * render for no additional safety.
 */
export async function getSessionUserId(): Promise<string | null> {
  const token = (await cookies()).get(ACCESS_COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = await verifyAccessToken(token);
  return payload?.userId ?? null;
}
