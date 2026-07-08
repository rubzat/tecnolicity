import type { UserRepository } from '../../domain/repositories/user-repository.js';
import { hashPassword } from './password.js';

/**
 * Seeds the first login account from ADMIN_USERNAME/ADMIN_PASSWORD the
 * moment the `users` table is empty — covers both a brand-new deploy and
 * upgrading from the pre-PR12 env-var-only admin (same env vars, so the
 * account that already existed just... starts existing in the DB instead).
 * A no-op on every boot after that; accounts are managed via /admin/users
 * from then on, not by editing environment variables.
 */
export async function bootstrapAdminUser(
  repo: UserRepository,
  username: string,
  password: string,
): Promise<void> {
  const existing = await repo.count();
  if (existing > 0) return;

  const passwordHash = await hashPassword(password);
  await repo.create({ username, passwordHash });
  console.log(`[bootstrap] created initial user "${username}" — manage accounts at /admin/users from now on`);
}
