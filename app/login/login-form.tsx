'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * The sign-in form posts to /api/auth/login, which sets the httpOnly cookies.
 * The token never passes through JavaScript on this page — the response body
 * carries only display-safe user fields.
 */
export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Could not sign in');
        return;
      }

      router.push('/shop');
      router.refresh();
    } catch {
      setError('Network error — please try again');
    } finally {
      setBusy(false);
    }
  }

  const field =
    'w-full rounded-lg border border-[#2B2620]/20 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#2B2620]/30';

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <div>
        <label htmlFor="email" className="block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          type="email"
          name="email"
          required
          autoComplete="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com"
          disabled={busy}
          className={`mt-1 ${field}`}
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          type="password"
          name="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          disabled={busy}
          className={`mt-1 ${field}`}
        />
      </div>

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-full bg-[#2B2620] px-4 py-2.5 text-sm font-medium text-[#FAF8F3] disabled:opacity-50"
      >
        {busy ? 'Signing in…' : 'Sign in'}
      </button>

      <p className="text-center text-xs text-[#2B2620]/50">
        Demo credentials are printed by <code>npm run seed</code>.
      </p>
    </form>
  );
}