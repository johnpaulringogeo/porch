/**
 * DID helpers — the string-level manipulation for our did:web scheme.
 *
 * Our format is:  did:web:<host>:users:<username>
 * Resolution URL: https://<host>/.well-known/did/users/<username>/did.json
 *
 * For local dev the host includes a URL-encoded port:
 *   did:web:localhost%3A3000:users:matt-personal
 */

export function buildDid(host: string, username: string): string {
  return `did:web:${host}:users:${username}`;
}

export interface ParsedDid {
  host: string;
  username: string;
}

export function parseDid(did: string): ParsedDid {
  // did:web:<host>:users:<username>
  if (!did.startsWith('did:web:')) {
    throw new Error(`Not a did:web: ${did}`);
  }
  const rest = did.slice('did:web:'.length);
  // The last segment is the username; the one before it must be 'users';
  // everything before that is the host.
  const parts = rest.split(':');
  if (parts.length < 3 || parts[parts.length - 2] !== 'users') {
    throw new Error(`Malformed did:web (expected …:users:<username>): ${did}`);
  }
  const username = parts[parts.length - 1]!;
  const host = parts.slice(0, -2).join(':');
  return { host, username };
}

export function didToResolutionUrl(did: string): string {
  const { host, username } = parseDid(did);
  // did:web encodes ':' in host as '%3A' per the did:web spec. We decode it
  // back to the literal ':' for the URL because URLs do not need it encoded.
  const decodedHost = host.replaceAll('%3A', ':');
  // http for localhost, https everywhere else
  const scheme = decodedHost.startsWith('localhost') || decodedHost.startsWith('127.0.0.1')
    ? 'http'
    : 'https';
  return `${scheme}://${decodedHost}/.well-known/did/users/${username}/did.json`;
}
