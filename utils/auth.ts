import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { db, sessions, users, isDatabaseConfigured } from './db';
import {
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  LOGIN_HINT_COOKIE_NAME,
} from './auth-cookies';

/**
 * Signing keys come from the environment and NOTHING else.
 *
 * A missing JWT_SECRET must fail closed in production -- an app that silently
 * signs tokens with a well-known string is worse than one that refuses to boot.
 *
 * The one exception is the showcase local demo mode, where `npm run dev`
 * must sign a token for the sample login to work on a fresh clone with no setup.
 * That fallback is guarded on NODE_ENV !== production AND on the absence of
 * DATABASE_URL, so a deployed build can never reach it. Production still
 * refuses to sign anything without a real secret.
 */
function readSecret(name: string, demoFallback?: string): Uint8Array | null {
  const raw = process.env[name];
  if (!raw) {
    const isDemo =
      process.env.NODE_ENV !== 'production' && !process.env.DATABASE_URL;
    if (isDemo && demoFallback) return new TextEncoder().encode(demoFallback);
    return null;
  }
  // jose requires >= 256 bits for HS256. Anything shorter is a misconfiguration
  // worth rejecting at boot rather than at first login.
  if (raw.length < 32) {
    throw new Error(
      `${name} must be at least 32 characters to sign HS256 tokens.`
    );
  }
  return new TextEncoder().encode(raw);
}

const JWT_SECRET = readSecret(
  'JWT_SECRET',
  'showcase-demo-access-secret-not-for-production'
);
const JWT_REFRESH_SECRET = readSecret(
  'JWT_REFRESH_SECRET',
  'showcase-demo-refresh-secret-not-for-production'
);

// Cookie names live in a LEAF module (no imports) so client components can read
// them without dragging bcryptjs / drizzle / the Neon client into the browser
// bundle. Re-exported here because server code imports them from '@/utils/auth'.
export { ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME, LOGIN_HINT_COOKIE_NAME };

export const ACCESS_EXPIRY = '1h';
export const REFRESH_EXPIRY = '1d';
/** Refresh-token lifetime in ms â€” keep in sync with REFRESH_EXPIRY. */
export const REFRESH_TTL_MS = 24 * 60 * 60 * 1000;

const accessCookieOptions: {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  path: string;
  maxAge: number;
} = {
  // httpOnly keeps the token out of reach of any script on the page, which is
  // what makes an XSS bug non-fatal for session theft.
  httpOnly: true,
  // `secure` in production means the browser refuses to send it over plain
  // HTTP, so a downgrade or an active network attacker can't harvest it.
  secure: process.env.NODE_ENV === 'production',
  // `lax` still blocks the cookie on cross-site POSTs (the CSRF-vulnerable
  // case) while allowing normal top-level navigation, which would break
  // returning to the site from an external link if we used `strict`.
  sameSite: 'lax',
  path: '/',
  maxAge: 60 * 60,
};

const refreshCookieOptions: typeof accessCookieOptions = {
  ...accessCookieOptions,
  maxAge: REFRESH_TTL_MS / 1000,
};

const loginHintCookieOptions: typeof accessCookieOptions = {
  // NOT httpOnly: the whole point of this cookie is to be readable by client
  // JS. It holds no credential -- see auth-cookies.ts. The remaining attributes
  // are inherited so the hint cannot drift from the access cookie's settings.
  ...accessCookieOptions,
  httpOnly: false,
  maxAge: REFRESH_TTL_MS / 1000,
};

/** Cost factor 12 â€” deliberately slow, ~250ms per hash on commodity hardware. */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export interface TokenPayload {
  userId: string;
  email: string;
  role: string;
}

export async function signAccessToken(
  payload: TokenPayload
): Promise<string | null> {
  if (!JWT_SECRET) return null;
  try {
    return await new SignJWT({ ...payload })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(ACCESS_EXPIRY)
      .sign(JWT_SECRET);
  } catch (err) {
    console.error('[signAccessToken] Error:', (err as Error).message);
    return null;
  }
}

/**
 * Refresh tokens are signed with a SEPARATE secret.
 *
 * Separate keys mean a leaked access token cannot be presented as a refresh
 * token to mint a long-lived session â€” the classic token-confusion escalation.
 * This is why JWT_REFRESH_SECRET is not simply `${JWT_SECRET}-refresh`.
 */
export async function signRefreshToken(
  payload: TokenPayload
): Promise<string | null> {
  if (!JWT_REFRESH_SECRET) return null;
  try {
    return await new SignJWT({ ...payload })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(REFRESH_EXPIRY)
      .sign(JWT_REFRESH_SECRET);
  } catch {
    return null;
  }
}

export async function verifyAccessToken(
  token: string
): Promise<TokenPayload | null> {
  if (!JWT_SECRET) return null;
  try {
    // `jose` pins the algorithm via the key argument, so an attacker cannot
    // swap `alg: none` or downgrade to a symmetric/asymmetric confusion attack.
    const { payload } = await jwtVerify(token, JWT_SECRET, {
      algorithms: ['HS256'],
    });
    return {
      userId: payload.userId as string,
      email: payload.email as string,
      role: payload.role as string,
    };
  } catch (err) {
    console.error('[verifyAccessToken] Error:', (err as Error).message);
    return null;
  }
}

export async function verifyRefreshToken(
  token: string
): Promise<TokenPayload | null> {
  if (!JWT_REFRESH_SECRET) return null;
  try {
    const { payload } = await jwtVerify(token, JWT_REFRESH_SECRET, {
      algorithms: ['HS256'],
    });
    return {
      userId: payload.userId as string,
      email: payload.email as string,
      role: payload.role as string,
    };
  } catch {
    return null;
  }
}

export type UserRole = 'admin' | 'user';

export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Demo-mode user store.
 *
 * When no DATABASE_URL is configured there is no `users` table, but the auth
 * routes still have to work so a reviewer can exercise the cookie/token flow
 * without provisioning anything. This is an in-memory stand-in ONLY for the
 * showcase's demo transport; the JWT signing, verification, rotation and
 * cookie handling above are the real implementations.
 *
 * The password is a published constant on purpose -- it guards nothing, and a
 * random one would only make the showcase harder to try.
 */
const DEMO_PASSWORD = 'showcase-demo-password';
const DEMO_USER: UserRow = {
  id: 'demo-user',
  email: 'demo@example.com',
  name: 'Demo User',
  role: 'user',
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

/** Refresh tokens issued in demo mode, so revoke/refresh behave realistically. */
const demoSessions = new Map<string, { userId: string; expiresAt: number }>();

function demoSessionFor(): { user: UserRow; passwordHash: string } | null {
  return {
    user: DEMO_USER,
    // Pre-hashed at cost 10 so verification costs the same real time it would
    // against a database row.
    passwordHash: DEMO_USER_HASH,
  };
}

let DEMO_USER_HASH = '';

export async function getUserByEmail(
  email: string
): Promise<(UserRow & { passwordHash: string }) | null> {
  if (!isDatabaseConfigured) {
    if (!DEMO_USER_HASH) DEMO_USER_HASH = await hashPassword(DEMO_PASSWORD);
    const found = demoSessionFor();
    return found && email.toLowerCase() === DEMO_USER.email
      ? { ...found.user, passwordHash: found.passwordHash }
      : null;
  }

  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return { ...r, role: r.role as UserRole };
}

export async function getUserById(id: string): Promise<UserRow | null> {
  if (!isDatabaseConfigured) return id === DEMO_USER.id ? DEMO_USER : null;

  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  const r = rows[0];
  if (!r) return null;
  return { ...r, role: r.role as UserRole };
}

export function setAuthCookies(
  accessToken: string,
  refreshToken: string
): {
  access: { name: string; value: string; options: typeof accessCookieOptions };
  refresh: {
    name: string;
    value: string;
    options: typeof refreshCookieOptions;
  };
  loggedIn: {
    name: string;
    value: string;
    options: typeof loginHintCookieOptions;
  };
} {
  return {
    access: {
      name: ACCESS_COOKIE_NAME,
      value: accessToken,
      options: accessCookieOptions,
    },
    refresh: {
      name: REFRESH_COOKIE_NAME,
      value: refreshToken,
      options: refreshCookieOptions,
    },
    loggedIn: {
      name: LOGIN_HINT_COOKIE_NAME,
      value: '1',
      options: loginHintCookieOptions,
    },
  };
}

export function clearAuthCookies(): {
  access: { name: string; value: string; options: typeof accessCookieOptions };
  refresh: {
    name: string;
    value: string;
    options: typeof refreshCookieOptions;
  };
  loggedIn: {
    name: string;
    value: string;
    options: typeof loginHintCookieOptions;
  };
} {
  return {
    access: {
      name: ACCESS_COOKIE_NAME,
      value: '',
      options: { ...accessCookieOptions, maxAge: 0 },
    },
    refresh: {
      name: REFRESH_COOKIE_NAME,
      value: '',
      options: { ...refreshCookieOptions, maxAge: 0 },
    },
    // Keep the hint (value "0" = confirmed signed out) rather than deleting it:
    // an explicit "0" lets the client skip /api/auth/me without a speculative
    // round-trip, whereas an absent cookie means "unknown" and forces one.
    loggedIn: {
      name: LOGIN_HINT_COOKIE_NAME,
      value: '0',
      options: loginHintCookieOptions,
    },
  };
}

/** One row per device; refresh rotates (revoke old + insert new). */
const MAX_SESSIONS_PER_USER = 10;

export async function storeSession(
  userId: string,
  token: string,
  expiresAt: Date
): Promise<void> {
  if (!isDatabaseConfigured) {
    // Demo transport: same pruning rules, held in memory.
    const now = Date.now();
    for (const [key, row] of demoSessions) {
      if (row.expiresAt <= now) demoSessions.delete(key);
    }
    const forUser = [...demoSessions.entries()].filter(([, r]) => r.userId === userId);
    if (forUser.length >= MAX_SESSIONS_PER_USER) {
      forUser
        .sort((a, b) => b[1].expiresAt - a[1].expiresAt)
        .slice(MAX_SESSIONS_PER_USER - 1)
        .forEach(([key]) => demoSessions.delete(key));
    }
    demoSessions.set(token, { userId, expiresAt: expiresAt.getTime() });
    return;
  }

  // Housekeeping so the table can't grow without bound (runs on the rare
  // login/refresh path, not per request):
  // 1. Drop this user's already-expired sessions.
  await db
    .delete(sessions)
    .where(
      and(eq(sessions.userId, userId), lt(sessions.expiresAt, new Date()))
    );
  // 2. Cap concurrent devices: keep this new session + the 9 most recently
  //    expiring ones. A stale device is signed out lazily instead of piling up.
  await db.execute(sql`
    DELETE FROM sessions
    WHERE user_id = ${userId}
      AND token <> ${token}
      AND token NOT IN (
        SELECT token FROM sessions
        WHERE user_id = ${userId}
        ORDER BY expires_at DESC
        LIMIT ${MAX_SESSIONS_PER_USER - 1}
      )
  `);
  await db.insert(sessions).values({ userId, token, expiresAt });
}

export async function revokeSession(token: string): Promise<void> {
  if (!isDatabaseConfigured) {
    demoSessions.delete(token);
    return;
  }
  await db.delete(sessions).where(eq(sessions.token, token));
}

/**
 * A signature check alone is not enough: a refresh token must also be live in
 * the `sessions` table. That indirection is what makes logout and revocation
 * real â€” the JWT stays cryptographically valid until it expires, but the
 * server-side row is gone, so it is refused.
 */
export async function isSessionValid(token: string): Promise<boolean> {
  if (!isDatabaseConfigured) {
    const row = demoSessions.get(token);
    return Boolean(row && row.expiresAt > Date.now());
  }

  const rows = await db
    .select({ userId: sessions.userId })
    .from(sessions)
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return rows.length > 0;
}

/**
 * Rotate on every refresh: revoke the presented token, issue a new pair.
 *
 * This makes a stolen refresh token usable at most once before it is burned,
 * and gives replay detection a place to live.
 */
export async function refreshTokens(
  refreshToken: string
): Promise<{ accessToken: string; refreshToken: string }> {
  const payload = await verifyRefreshToken(refreshToken);
  if (!payload) throw new Error('Invalid refresh token');
  const valid = await isSessionValid(refreshToken);
  if (!valid) throw new Error('Session revoked');

  await revokeSession(refreshToken);

  const newPayload: TokenPayload = {
    userId: payload.userId,
    email: payload.email,
    role: payload.role,
  };
  const a = await signAccessToken(newPayload);
  const r = await signRefreshToken(newPayload);
  if (!a || !r) throw new Error('Failed to sign tokens');
  await storeSession(payload.userId, r, new Date(Date.now() + REFRESH_TTL_MS));
  return { accessToken: a, refreshToken: r };
}

export interface LoginResult {
  success: boolean;
  accessToken?: string;
  refreshToken?: string;
  user?: UserRow;
  error?: string;
}

export async function login(
  email: string,
  password: string
): Promise<LoginResult> {
  const user = await getUserByEmail(email);
  // One message for both "no such user" and "wrong password" â€” distinguishing
  // them would let an attacker enumerate which emails have accounts.
  if (!user) return { success: false, error: 'Invalid email or password' };

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return { success: false, error: 'Invalid email or password' };

  const payload: TokenPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
  };
  const accessToken = await signAccessToken(payload);
  const refreshToken = await signRefreshToken(payload);
  if (!accessToken || !refreshToken)
    return { success: false, error: 'Server configuration error' };

  await storeSession(
    user.id,
    refreshToken,
    new Date(Date.now() + REFRESH_TTL_MS)
  );

  return {
    success: true,
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    },
  };
}

/**
 * The login-hint cookie on its own â€” "1" signed in, "0" signed out.
 *
 * Used by /api/auth/me, the one route that learns the session state without
 * issuing fresh tokens, so it can keep the client hint accurate.
 */
export function loginHintCookie(value: '0' | '1'): {
  name: string;
  value: string;
  options: typeof loginHintCookieOptions;
} {
  return {
    name: LOGIN_HINT_COOKIE_NAME,
    value,
    options: loginHintCookieOptions,
  };
}
