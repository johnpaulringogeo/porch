/**
 * Access-token JWTs.
 *
 * v0 uses HS256 with a single shared signing key; v1 moves to asymmetric
 * (ES256 or EdDSA) so external consumers can verify without the secret.
 */
import { SignJWT, jwtVerify } from 'jose';

export interface AccessTokenClaims {
  /** Account ID (`sub`). */
  sub: string;
  persona: string;
  did: string;
  username: string;
  iat: number;
  exp: number;
  jti: string;
}

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

export async function signAccessToken(
  signingKeyBase64: string,
  payload: Omit<AccessTokenClaims, 'iat' | 'exp' | 'jti'>,
): Promise<{ token: string; expiresAt: Date; jti: string }> {
  const key = base64ToUint8(signingKeyBase64);
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + ACCESS_TOKEN_TTL_SECONDS;
  const jti = crypto.randomUUID();

  const token = await new SignJWT({
    persona: payload.persona,
    did: payload.did,
    username: payload.username,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(payload.sub)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .setJti(jti)
    .sign(key);

  return { token, expiresAt: new Date(exp * 1000), jti };
}

export async function verifyAccessToken(
  signingKeyBase64: string,
  token: string,
): Promise<AccessTokenClaims> {
  const key = base64ToUint8(signingKeyBase64);
  const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
  if (
    typeof payload.sub !== 'string' ||
    typeof payload.persona !== 'string' ||
    typeof payload.did !== 'string' ||
    typeof payload.username !== 'string' ||
    typeof payload.iat !== 'number' ||
    typeof payload.exp !== 'number' ||
    typeof payload.jti !== 'string'
  ) {
    throw new Error('Malformed access token payload');
  }
  return {
    sub: payload.sub,
    persona: payload.persona,
    did: payload.did,
    username: payload.username,
    iat: payload.iat,
    exp: payload.exp,
    jti: payload.jti,
  };
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
