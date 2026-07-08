/**
 * UserRepository — domain port for the `users` table (PR12).
 *
 * Every user has identical access (no roles) — this is a login allowlist,
 * not a permissions system.
 */

export interface UserRecord {
  id: number;
  username: string;
  passwordHash: string;
  active: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface CreateUserInput {
  username: string;
  passwordHash: string;
}

export interface UpdateUserInput {
  active?: boolean;
  passwordHash?: string;
}

export interface UserRepository {
  count(): Promise<number>;
  list(): Promise<UserRecord[]>;
  findByUsername(username: string): Promise<UserRecord | null>;
  create(input: CreateUserInput): Promise<UserRecord>;
  update(id: number, patch: UpdateUserInput): Promise<UserRecord | null>;
  delete(id: number): Promise<boolean>;
  touchLastLogin(id: number): Promise<void>;
  /** Active users other than `excludeId` — used to guard the last account. */
  countOtherActive(excludeId: number): Promise<number>;
}
