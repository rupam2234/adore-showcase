import type { Metadata } from 'next';
import { LoginForm } from './login-form';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to your showcase account.',
};

/**
 * Session-dependent, so never statically cached — `cookies()` below opts this
 * route into dynamic rendering.
 */
export default function LoginPage() {
  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <h1 className="font-serif text-3xl font-semibold">Sign in</h1>
      <p className="mt-2 text-sm text-[#2B2620]/60">
        A demonstration of the JWT session flow: short-lived access token,
        rotating refresh token, both in httpOnly cookies.
      </p>
      <div className="mt-8">
        <LoginForm />
      </div>
    </main>
  );
}