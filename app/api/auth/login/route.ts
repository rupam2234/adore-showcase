import { NextRequest, NextResponse } from 'next/server';
import { login, setAuthCookies } from '@/utils/auth';
import { rateLimit } from '@/utils/rate-limit';

/**
 * Login is the single most attackable route in the app: it accepts
 * attacker-controlled credentials, so it is also the one most worth bounding.
 *
 * This is a SLIDING window per client key, so an attacker cannot wait for a
 * fixed boundary and then fire a fresh burst. 10 attempts / 15 minutes is
 * generous for a human who mistypes twice but useless for an offline
 * dictionary run.
 */
const LOGIN_LIMIT = { limit: 10, windowMs: 15 * 60 * 1000 };

/**
 * Key on email + IP together rather than IP alone. An IP-only limit lets one
 * attacker lock out an entire office; an email-only limit lets a spray across
 * many accounts go unthrottled. Both dimensions bound both attacks.
 *
 * The email is hashed into the key so the limiter's in-memory map never holds
 * plaintext addresses.
 */
function loginKey(request: NextRequest, email: string): string {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const identity = `${ip}:${email.trim().toLowerCase()}`;
  // FNV-1a: a short, dependency-free hash. This key only needs to be stable
  // and hard to guess by eye, not cryptographically collision-resistant.
  let hash = 0x811c9dc5;
  for (let i = 0; i < identity.length; i++) {
    hash ^= identity.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `login:${(hash >>> 0).toString(16)}`;
}

export async function POST(request: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = (await request.json()) as { email?: string; password?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { email, password } = body;
  if (!email || !password) {
    return NextResponse.json(
      { error: 'Email and password are required' },
      { status: 400 }
    );
  }

  const { allowed, retryAfterSeconds } = rateLimit(
    loginKey(request, email),
    LOGIN_LIMIT
  );
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfterSeconds) },
      }
    );
  }

  try {
    const result = await login(email.trim().toLowerCase(), password);

    if (!result.success || !result.accessToken || !result.refreshToken || !result.user) {
      // 401 with the same message the auth layer produced, so a caller cannot
      // distinguish "no such user" from "wrong password".
      return NextResponse.json(
        { error: result.error ?? 'Invalid credentials' },
        { status: 401 }
      );
    }

    const cookies = setAuthCookies(result.accessToken, result.refreshToken);
    const response = NextResponse.json(
      {
        user: {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          role: result.user.role,
        },
      },
      { status: 200 }
    );

    response.cookies.set(cookies.access.name, cookies.access.value, cookies.access.options);
    response.cookies.set(cookies.refresh.name, cookies.refresh.value, cookies.refresh.options);
    // Client-readable login hint so guests can skip /api/auth/me entirely.
    response.cookies.set(
      cookies.loggedIn.name,
      cookies.loggedIn.value,
      cookies.loggedIn.options
    );

    return response;
  } catch (err) {
    console.error('[POST /api/auth/login]', (err as Error).message);
    // Generic message: the detail is logged, never returned.
    return NextResponse.json({ error: 'Server error' }, { status: 500 });
  }
}