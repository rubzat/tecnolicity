/**
 * ApiKeyRepository — domain port for the `api_keys` table (PR11).
 *
 * The admin panel issues/revokes keys here; the public-API rate-limit
 * middleware looks up the caller's key here on every request.
 */

export interface ApiKeyRecord {
  id: number;
  name: string;
  email: string | null;
  keyHash: string;
  keyPrefix: string;
  rateLimitPerMinute: number;
  active: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
}

export interface CreateApiKeyInput {
  name: string;
  email: string | null;
  keyHash: string;
  keyPrefix: string;
  rateLimitPerMinute: number;
}

export interface UpdateApiKeyInput {
  name?: string;
  email?: string | null;
  rateLimitPerMinute?: number;
  active?: boolean;
}

export interface ApiKeyRepository {
  list(): Promise<ApiKeyRecord[]>;
  create(input: CreateApiKeyInput): Promise<ApiKeyRecord>;
  findByHash(keyHash: string): Promise<ApiKeyRecord | null>;
  update(id: number, patch: UpdateApiKeyInput): Promise<ApiKeyRecord | null>;
  delete(id: number): Promise<boolean>;
  touchLastUsed(id: number): Promise<void>;
}
