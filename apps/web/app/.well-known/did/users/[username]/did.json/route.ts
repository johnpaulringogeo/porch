import { NextResponse } from 'next/server';
import { buildPorchDidDocument } from '@porch/core/did/document';
import { getDb } from '@/lib/db';

/**
 * W3C DID Web resolution endpoint.
 *
 * Per the did:web spec, `did:web:<host>:users:<username>` resolves to
 *     https://<host>/users/<username>/did.json
 * For usernames (the `users:` path segment), Porch also exposes a
 * `.well-known`-rooted path so it can be resolved without touching the user's
 * profile page routing.
 *
 * The document is NOT stored — it's derived from the persona + persona_key
 * rows at read time, so key rotations are reflected immediately.
 */
export async function GET(
  _request: Request,
  { params }: { params: { username: string } },
) {
  const host = process.env.PORCH_HOST;
  if (!host) {
    return NextResponse.json(
      { error: { code: 'CONFIG_ERROR', message: 'PORCH_HOST is not set' } },
      { status: 500 },
    );
  }

  const username = params.username.toLowerCase();

  const db = getDb();
  const doc = await buildPorchDidDocument(db, host, username);
  if (!doc) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'DID document not found' } },
      { status: 404 },
    );
  }

  return NextResponse.json(doc, {
    headers: {
      'Content-Type': 'application/did+json',
      'Cache-Control': 'public, max-age=60, s-maxage=60',
    },
  });
}

// DID documents must be fetched live from the database so key rotations
// propagate immediately. Disable static optimization.
export const dynamic = 'force-dynamic';
