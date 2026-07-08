import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

const PREFIX = 'tk_live_';

/** Generates a new raw API key. Shown to the admin exactly once. */
export function generateApiKey(): string {
  return PREFIX + randomBytes(24).toString('base64url');
}

/** SHA-256 hash for storage — API keys are high-entropy random tokens (not
 * human passwords), so a fast cryptographic hash is the right tool; bcrypt's
 * deliberate slowness exists to blunt guessing low-entropy secrets, which
 * doesn't apply here. */
export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

/** First 12 chars, safe to display in the admin panel to identify a key
 * without ever re-exposing the secret. */
export function keyPrefixFor(rawKey: string): string {
  return rawKey.slice(0, 12);
}

/** Constant-time hash comparison (defense in depth; hashes are already
 * unique-indexed, this just avoids leaking timing on the lookup itself). */
export function hashesEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}
