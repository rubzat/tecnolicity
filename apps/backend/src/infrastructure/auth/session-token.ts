import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Minimal signed session token — `base64url(payload).base64url(hmac)` — for
 * the single-admin cookie session. Deliberately not a full JWT: one claim
 * (an expiry), one signer, no algorithm negotiation, so there's no need for
 * a JWT library just to keep one admin logged in.
 */
export interface SessionPayload {
  sub: string;
  exp: number;
}

function b64urlEncode(input: string): string {
  return Buffer.from(input, 'utf8').toString('base64url');
}

function b64urlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function sign(payloadB64: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

export function createSessionToken(sub: string, ttlMs: number, secret: string): string {
  const payload: SessionPayload = { sub, exp: Date.now() + ttlMs };
  const payloadB64 = b64urlEncode(JSON.stringify(payload));
  return `${payloadB64}.${sign(payloadB64, secret)}`;
}

/** Verifies signature + expiry. Returns the payload, or null if invalid/expired. */
export function verifySessionToken(token: string, secret: string): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts as [string, string];

  const expected = sign(payloadB64, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64)) as SessionPayload;
  } catch {
    return null;
  }
  if (typeof payload.exp !== 'number' || Date.now() > payload.exp) return null;
  return payload;
}
