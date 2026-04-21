'use client';

/**
 * Create a new persona — `/settings/personas/new`.
 *
 * Lives under the signed-in settings tree. The API route (POST /api/personas)
 * has existed since signup but until now had no web caller; this page closes
 * that loop so a user can add a persona without hitting the DB directly.
 *
 * Fields mirror the server's CreatePersonaRequest:
 *   - username       handle + did:web slug, immutable-ish after creation
 *   - displayName    shown on the profile; editable later in /settings/profile
 *   - bio (optional) shown on the profile; editable later too
 *
 * Client-side validation stays intentionally minimal — the server re-runs
 * everything (format, reserved list, uniqueness) and returns field-targeted
 * errors via ApiError.field, which we route straight to the matching input.
 * That keeps the client and server's truth aligned without the client having
 * to mirror the reserved-username list.
 *
 * On success we navigate back to /settings/personas (the list the user most
 * likely came from). We deliberately do *not* auto-switch into the new
 * persona: creation and identity-shift are separate verbs, and a user who
 * wants to post as the new handle is one row-click away on the list page.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { CreatePersonaResponse } from '@porch/types/api';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

const BIO_MAX = 280;
const DISPLAY_NAME_MAX = 64;

export default function NewPersonaPage() {
  const router = useRouter();
  const { session, accessToken } = useAuth();

  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setFormError(null);
    setFieldErrors({});

    // Trim once up front so every downstream check (client and server) sees
    // the same value. Whitespace-only displayName is caught client-side so
    // users don't need a round-trip to learn that a space isn't a name.
    const trimmedDisplay = displayName.trim();
    const trimmedBio = bio.trim();

    const errs: Record<string, string> = {};
    if (username.length < 3) {
      errs.username = 'Handles are 3–32 characters.';
    }
    if (trimmedDisplay.length === 0) {
      errs.displayName = 'Display name is required.';
    }
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }

    setSubmitting(true);
    try {
      // bio: send undefined (omit) when blank so the server stores NULL via
      // its `.optional()` path, rather than persisting an empty string.
      const payload: {
        username: string;
        displayName: string;
        bio?: string;
      } = {
        username,
        displayName: trimmedDisplay,
      };
      if (trimmedBio.length > 0) payload.bio = trimmedBio;

      await api<CreatePersonaResponse>({
        method: 'POST',
        path: '/api/personas',
        accessToken,
        body: payload,
      });

      // Send the user back to the list. router.refresh() isn't needed — the
      // list page fetches /api/personas on mount, so the new row shows up
      // naturally on navigation.
      router.push('/settings/personas');
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

  if (!session) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="space-y-1">
        <div className="text-xs text-[hsl(var(--text-muted))]">
          <Link href="/settings/personas" className="underline-offset-2 hover:underline">
            Personas
          </Link>
          <span aria-hidden="true"> › </span>
          <span>New</span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Create a persona</h1>
        <p className="text-sm text-[hsl(var(--text-muted))]">
          Personas are separate public identities on your account — pick a
          handle and a display name. You&apos;ll stay acting as{' '}
          <span className="font-medium">@{session.persona.username}</span>{' '}
          until you switch.
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
          id="username"
          label="Handle"
          type="text"
          autoComplete="off"
          required
          value={username}
          onChange={(v) => setUsername(v.toLowerCase())}
          hint={
            <>
              People will see <span className="font-mono">@{username || 'yourname'}</span>.
              It&apos;s part of the persona&apos;s portable identity and
              can&apos;t be changed later. 3–32 chars: lowercase letters,
              numbers, hyphens.
            </>
          }
          error={fieldErrors.username}
        />

        <Field
          id="displayName"
          label="Display name"
          type="text"
          autoComplete="off"
          required
          maxLength={DISPLAY_NAME_MAX}
          value={displayName}
          onChange={setDisplayName}
          hint="The name shown on the profile and posts. You can change this any time."
          error={fieldErrors.displayName}
        />

        <div className="space-y-1">
          <div className="flex items-baseline justify-between">
            <label htmlFor="bio" className="block text-sm font-medium">
              Bio <span className="font-normal text-[hsl(var(--text-muted))]">(optional)</span>
            </label>
            <span className="text-xs text-[hsl(var(--text-muted))]">
              {bio.length}/{BIO_MAX}
            </span>
          </div>
          <textarea
            id="bio"
            name="bio"
            rows={3}
            maxLength={BIO_MAX}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            className="w-full resize-y rounded-md border border-[hsl(var(--border-default))] bg-white px-3 py-2 text-sm outline-none focus:border-[hsl(var(--text-default))]"
          />
          {fieldErrors.bio ? (
            <p className="text-xs text-red-700">{fieldErrors.bio}</p>
          ) : (
            <p className="text-xs text-[hsl(var(--text-muted))]">
              A short description shown on the profile. Editable later.
            </p>
          )}
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center rounded-md bg-mode-home px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Creating…' : 'Create persona'}
          </button>
          <Link
            href="/settings/personas"
            className="text-sm text-[hsl(var(--text-muted))] hover:underline"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}

// ── Field (local copy; mirrors the one in /signup) ───────────────────────

interface FieldProps {
  id: string;
  label: string;
  type: 'text';
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  autoComplete?: string;
  maxLength?: number;
  hint?: React.ReactNode;
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
  error,
}: FieldProps) {
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
        <p className="text-xs text-[hsl(var(--text-muted))]">{hint}</p>
      ) : null}
    </div>
  );
}
