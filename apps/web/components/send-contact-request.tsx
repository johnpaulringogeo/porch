'use client';

/**
 * Sending a contact request by username. We intentionally keep this tiny:
 * one text input for the handle, an optional message (200 chars, mirrors the
 * API), a single submit.
 *
 * On success the parent bumps the outgoing-requests refresh key; we reset
 * the form locally. Errors are shown inline — an ApiError from the server
 * (NotFound for bad username, Conflict for existing edge, etc.) carries a
 * user-friendly message already, so we surface it as-is.
 */

import { useState } from 'react';
import type { CreateContactRequestResponse } from '@porch/types/api';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

const MAX_MESSAGE = 200;

interface SendContactRequestProps {
  onSent?: () => void;
}

export function SendContactRequest({ onSent }: SendContactRequestProps) {
  const { accessToken } = useAuth();
  const [username, setUsername] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const trimmedUsername = username.trim().replace(/^@/, '');
  const trimmedMessage = message.trim();
  const canSubmit =
    trimmedUsername.length > 0 &&
    trimmedMessage.length <= MAX_MESSAGE &&
    !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await api<CreateContactRequestResponse>({
        method: 'POST',
        path: '/api/contacts/requests',
        body: {
          toPersonaUsername: trimmedUsername,
          ...(trimmedMessage ? { message: trimmedMessage } : {}),
        },
        accessToken,
      });
      setUsername('');
      setMessage('');
      setSuccess(`Request sent to @${trimmedUsername}.`);
      onSent?.();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not send that request. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  const remaining = MAX_MESSAGE - message.length;
  const overLimit = remaining < 0;

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[220px_1fr]">
        <label className="flex flex-col gap-1 text-xs text-[hsl(var(--text-muted))]">
          <span>Username</span>
          <input
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="@handle"
            className="rounded-md border border-[hsl(var(--border-default))] bg-[hsl(var(--surface-default))] px-3 py-2 text-sm placeholder:text-[hsl(var(--text-muted))] focus:outline-none focus:ring-2 focus:ring-mode-home/40"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-[hsl(var(--text-muted))]">
          <span>
            Message <span className="opacity-70">(optional)</span>
          </span>
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Say hi…"
            className="rounded-md border border-[hsl(var(--border-default))] bg-[hsl(var(--surface-default))] px-3 py-2 text-sm placeholder:text-[hsl(var(--text-muted))] focus:outline-none focus:ring-2 focus:ring-mode-home/40"
          />
        </label>
      </div>

      <div className="flex items-center justify-between">
        <span className={`text-xs ${overLimit ? 'text-red-600' : 'text-[hsl(var(--text-muted))]'}`}>
          {message ? `${remaining} left` : ' '}
        </span>
        <button
          type="submit"
          disabled={!canSubmit || overLimit}
          className="rounded-md bg-mode-home px-3 py-1.5 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Sending…' : 'Send request'}
        </button>
      </div>

      {error ? (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      ) : null}
      {success ? (
        <p role="status" className="text-xs text-emerald-700">
          {success}
        </p>
      ) : null}
    </form>
  );
}
