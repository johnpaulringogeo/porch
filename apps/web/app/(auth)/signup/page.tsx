'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api';
import { COUNTRIES, isKnownCountryCode } from '@/lib/countries';

/**
 * v0 signup form. Collects the fields the API expects, plus one client-only
 * field (confirmPassword) to catch typos before we hash and persist a
 * password the user didn't mean to set.
 *
 *   - email + password + confirmPassword   (account credentials)
 *   - username                             (handle + DID slug; immutable-ish)
 *   - displayName                          (human label; mutable)
 *   - ageAttestation                       (18+ + country of residence)
 *
 * Field-level errors returned by the API (usernameTaken, emailTaken,
 * weakPassword, …) are routed via `ApiError.field`. Anything we can't route
 * becomes a form-level banner.
 */
export default function SignupPage() {
  const router = useRouter();
  const { signup, session } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [jurisdiction, setJurisdiction] = useState(''); // empty = "Select country…"
  const [isAdult, setIsAdult] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // If a signed-in user navigates here, punt them to the dashboard. `session`
  // is `undefined` while we're still doing the refresh probe — only redirect
  // once it settles to a truthy value.
  useEffect(() => {
    if (session) router.replace('/dashboard');
  }, [session, router]);

  // Live feedback for the confirm-password field. Only show a mismatch once
  // the user has actually typed a confirmation — don't nag on an empty input.
  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const showMismatch = confirmPassword.length > 0 && !passwordsMatch;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFieldErrors({});

    // Client-side gates. The API re-validates everything, but these let us
    // fail fast with a useful per-field message before a network round-trip.
    const errs: Record<string, string> = {};
    if (password.length < 12) {
      errs.password = 'Password must be at least 12 characters.';
    }
    if (password !== confirmPassword) {
      errs.confirmPassword = 'Passwords do not match.';
    }
    if (!jurisdiction || !isKnownCountryCode(jurisdiction)) {
      errs.jurisdiction = 'Please choose your country.';
    }
    if (!isAdult) {
      errs.isAdult = 'You must confirm you are 18 or older.';
    }
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }

    setSubmitting(true);
    try {
      await signup({
        email,
        password,
        username,
        displayName,
        ageAttestation: {
          isAdult: true,
          jurisdiction: jurisdiction.toUpperCase(),
        },
      });
      router.replace('/dashboard');
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.field) {
          setFieldErrors({ [err.field]: err.message });
        } else {
          setFormError(err.message);
        }
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
          Create your Porch account
        </h1>
        <p className="text-sm text-[hsl(var(--text-muted))]">
          One account, five modes. You&apos;ll start with one persona — add
          more any time.
        </p>
      </header>

      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {formError ? (
          <div
            role="alert"
            className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          >
            {formError}
          </div>
        ) : null}

        <Field
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={setEmail}
          hint="How you sign in. Kept private — never shown on your profile."
          error={fieldErrors.email}
        />

        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={setPassword}
          hint="At least 12 characters."
          error={fieldErrors.password}
        />

        <Field
          id="confirmPassword"
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          required
          value={confirmPassword}
          onChange={setConfirmPassword}
          hint={
            passwordsMatch
              ? 'Passwords match.'
              : 'Re-enter your password to check for typos.'
          }
          hintTone={passwordsMatch ? 'success' : 'muted'}
          error={fieldErrors.confirmPassword ?? (showMismatch ? 'Passwords do not match.' : undefined)}
        />

        <Field
          id="handle"
          label="Handle"
          type="text"
          autoComplete="nickname"
          required
          value={username}
          onChange={(v) => setUsername(v.toLowerCase())}
          hint={
            <>
              People will see <span className="font-mono">@{username || 'yourname'}</span>.
              It&apos;s part of your portable identity and hard to change
              later. 3–32 chars: lowercase letters, numbers, hyphens.
            </>
          }
          error={fieldErrors.username}
        />

        <Field
          id="displayName"
          label="Display name"
          type="text"
          autoComplete="name"
          required
          value={displayName}
          onChange={setDisplayName}
          hint="The name shown on your profile and posts. You can change this any time."
          error={fieldErrors.displayName}
        />

        <div className="space-y-1">
          <label htmlFor="jurisdiction" className="block text-sm font-medium">
            Country
          </label>
          <select
            id="jurisdiction"
            name="jurisdiction"
            required
            value={jurisdiction}
            onChange={(e) => setJurisdiction(e.target.value)}
            className="w-full rounded-md border border-[hsl(var(--border-default))] bg-white px-3 py-2 text-sm outline-none focus:border-[hsl(var(--text-default))]"
          >
            <option value="" disabled>
              Select country…
            </option>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
          {fieldErrors.jurisdiction ? (
            <p className="text-xs text-red-700">{fieldErrors.jurisdiction}</p>
          ) : (
            <p className="text-xs text-[hsl(var(--text-muted))]">
              Used only for age-of-majority attestation.
            </p>
          )}
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={isAdult}
            onChange={(e) => setIsAdult(e.target.checked)}
          />
          <span>
            I confirm I am at least 18 years old and am eligible to create an
            account in my country.
          </span>
        </label>
        {fieldErrors.isAdult ? (
          <p className="text-sm text-red-700">{fieldErrors.isAdult}</p>
        ) : null}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-mode-home px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>

      <p className="text-sm text-[hsl(var(--text-muted))]">
        Already have an account?{' '}
        <a href="/login" className="font-medium text-[hsl(var(--text-default))] underline">
          Log in
        </a>
      </p>
    </>
  );
}

interface FieldProps {
  id: string;
  label: string;
  type: 'email' | 'password' | 'text';
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  autoComplete?: string;
  maxLength?: number;
  hint?: React.ReactNode;
  /** Color of the hint line when shown. Defaults to "muted". */
  hintTone?: 'muted' | 'success';
  error?: string;
}

function Field({
  id,
  label,
  type,
  value,
  onChange,
  required,
  autoComplete,
  maxLength,
  hint,
  hintTone = 'muted',
  error,
}: FieldProps) {
  const hintClass =
    hintTone === 'success'
      ? 'text-xs text-emerald-700'
      : 'text-xs text-[hsl(var(--text-muted))]';
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        required={required}
        autoComplete={autoComplete}
        maxLength={maxLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-[hsl(var(--border-default))] bg-white px-3 py-2 text-sm outline-none focus:border-[hsl(var(--text-default))]"
      />
      {error ? (
        <p className="text-xs text-red-700">{error}</p>
      ) : hint ? (
        <p className={hintClass}>{hint}</p>
      ) : null}
    </div>
  );
}
