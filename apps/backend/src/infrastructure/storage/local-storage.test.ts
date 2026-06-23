import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalFilesystemStorage } from './local-storage.js';

describe('LocalFilesystemStorage', () => {
  let root: string;
  let storage: LocalFilesystemStorage;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'tec-docs-'));
    storage = new LocalFilesystemStorage(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('saves a file under documents/{procedureId}/{filename} and returns a portable ref', async () => {
    const stored = await storage.save(42, 'anexo.pdf', Buffer.from('hello world'));

    // storageRef is relative to root (portable / persisted in documents.storage_ref).
    expect(stored.storageRef).toBe(join('documents', '42', 'anexo.pdf'));
    expect(stored.size).toBe('hello world'.length);

    // absolutePath points at the real file.
    const written = await readFile(stored.absolutePath);
    expect(written.toString()).toBe('hello world');
  });

  it('reads a file back via its storageRef', async () => {
    const { storageRef } = await storage.save(7, 'doc.txt', Buffer.from('data'));
    const buf = await storage.read(storageRef);
    expect(buf.toString()).toBe('data');
  });

  it('reports existence truthfully', async () => {
    expect(await storage.exists('documents/7/x')).toBe(false);
    const { storageRef } = await storage.save(7, 'x', Buffer.from('y'));
    expect(await storage.exists(storageRef)).toBe(true);
  });

  it('removes a file and becomes a no-op when missing', async () => {
    const { storageRef } = await storage.save(1, 'gone.bin', Buffer.from([1, 2, 3]));
    await storage.remove(storageRef);
    expect(await storage.exists(storageRef)).toBe(false);
    // Removing again does not throw.
    await expect(storage.remove(storageRef)).resolves.toBeUndefined();
  });

  it('creates nested directories on demand', async () => {
    const { absolutePath } = await storage.save(999, 'deep.pdf', Buffer.from('x'));
    // getPath resolves the same ref back to the same absolute path.
    expect(storage.getPath(join('documents', '999', 'deep.pdf'))).toBe(absolutePath);
  });
});
