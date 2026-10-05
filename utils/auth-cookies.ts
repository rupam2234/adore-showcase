export const ACCESS_COOKIE_NAME = 'showcase_access_token';
export const REFRESH_COOKIE_NAME = 'showcase_refresh_token';

/**
 * Non-httpOnly "this browser may have a session" hint, readable by client JS.
 *
 * Read by useAuthUser() to skip the /api/auth/me round-trip entirely for
 * guests (the majority of traffic). It carries no data and grants nothing:
 * every request is still authorized server-side from the httpOnly access
 * token, so a forged value can at worst cause one wasted 401.
 */
export const LOGIN_HINT_COOKIE_NAME = 'showcase_logged_in';