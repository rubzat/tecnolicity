import { mkdir, writeFile, readFile, unlink, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { StoredFile, StorageInterface } from '../../domain/storage/storage-interface.js';

/**
 * LocalFilesystemStorage — MVP storage adapter.
 *
 * Files land under `{root}/documents/{procedureId}/{filename}`. The `storageRef`
 * returned to callers is the path RELATIVE to the storage root (so it stays
 * portable across machines / containers); `getPath()` re-expands it to an
 * absolute path on demand. Swappable for an S3 adapter behind the same port.
 */
export class LocalFilesystemStorage implements StorageInterface {
  private readonly root: string;

  constructor(root: string) {
    // Resolve relative to CWD at call time (root is configured per-env).
    this.root = resolve(root);
  }

  /** Per-procedure directory inside the storage root. */
  private dirFor(procedureId: number): string {
    return join(this.root, 'documents', String(procedureId));
  }

  async save(procedureId: number, filename: string, data: Buffer): Promise<StoredFile> {
    const dir = this.dirFor(procedureId);
    await mkdir(dir, { recursive: true });
    const absolutePath = join(dir, filename);
    await writeFile(absolutePath, data);
    const { size } = await stat(absolutePath);
    // storageRef is relative to root → portable + matches what we persist.
    const storageRef = join('documents', String(procedureId), filename);
    return { storageRef, absolutePath, size };
  }

  getPath(storageRef: string): string {
    return join(this.root, storageRef);
  }

  async exists(storageRef: string): Promise<boolean> {
    try {
      await stat(this.getPath(storageRef));
      return true;
    } catch {
      return false;
    }
  }

  async read(storageRef: string): Promise<Buffer> {
    return readFile(this.getPath(storageRef));
  }

  async remove(storageRef: string): Promise<void> {
    try {
      await unlink(this.getPath(storageRef));
    } catch {
      /* no-op: missing file is fine */
    }
  }
}
