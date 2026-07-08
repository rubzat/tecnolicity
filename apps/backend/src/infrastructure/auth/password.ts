import bcrypt from 'bcryptjs';

/** Human-chosen passwords, unlike API keys — bcrypt's deliberate slowness
 * is the right tool here (blunts offline guessing of a low-entropy secret),
 * where it wasn't for the high-entropy random API keys (see api-key-crypto.ts). */
const SALT_ROUNDS = 12;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, SALT_ROUNDS);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
