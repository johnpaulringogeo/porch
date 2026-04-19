'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api';

/**
 * Login form. Deliberately minimal — email + password is all the API needs.
 *
 * The API returns a generic "Invalid email or password" for both bad email
 * and wrong password to avoid account enumeration; we pass that message
 * straight through to the user without trying to be smarter.
 */
export default function LoginPage() {
  const router = useRouter();
  const { login, session } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (session) router.replace('/dashboard');
  }, [session, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await login({ email, password });
      router.replace('/dashboard');
    } catch (err) {
      if (err instanceof ApiError) {
        setFormError(err.message);
      } else {
        setFormError('Something went wrong. Please try again.');
      }
      setSubmitting(false);
    }
  }

  return (
    <>
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">
          Welcome back
        </h1>
        <p className="text-sm text-[hsl(var(--text-muted))]">
          Sign in to your Porch account.
        </p>
      </header>

      <form onSubmit={onSubmit} className="space-y-5">
        {formError ? (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {formError}
          </div>
        ) : null}

        <div className="space-y-1">
          <label htmlFor="email" className="block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-[hsl(var(--border-default))] bg-white px-3 py-2 text-sm outline-none focus:border-[hsl(var(--text-default))]"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="password" className="block text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-[hsl(var(--border-default))] bg-white px-3 py-2 text-sm outline-none focus:border-[hsl(var(--text-default))]"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-mode-home px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="text-sm text-[hsl(var(--text-muted))]">
        New to Porch?{' '}
        <a href="/signup" className="font-medium text-[hsl(var(--text-default))] underline">
          Create an account
        </a>
      </p>
    </>
  );
}
