import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rm } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { QuarantineSink } from './quarantine';

const TMP = join(tmpdir(), `tecnolicity-quarantine-test-${process.pid}`);

beforeEach(async () => {
  await rm(TMP, { recursive: true, force: true });
});

afterEach(async () => {
  await rm(TMP, { recursive: true, force: true });
});

describe('quarantine', () => {
  it('counts and snapshots entries', () => {
    const q = new QuarantineSink(join(TMP, 'q.jsonl'));
    expect(q.count).toBe(0);
    q.add({ rowNumber: 12, reason: 'missing numero_procedimiento', field: 'numero_procedimiento', rawRow: ['a', 'b'] });
    q.add({ rowNumber: 30, reason: 'short row', rawRow: ['x'] });
    expect(q.count).toBe(2);
    expect(q.snapshot().length).toBe(2);
  });

  it('flushes JSONL with one object per line', async () => {
    const path = join(TMP, 'nested', 'q.jsonl');
    const q = new QuarantineSink(path);
    q.add({ rowNumber: 12, reason: 'missing numero_procedimiento', rawRow: ['a', 'b'] });
    q.add({ rowNumber: 30, reason: 'short row', rawRow: ['x'] });

    const written = await q.flush();
    expect(written).toBe(2);

    const content = await readFile(path, 'utf8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).rowNumber).toBe(12);
    expect(JSON.parse(lines[1]!).reason).toBe('short row');
  });

  it('creates empty file when nothing quarantined', async () => {
    const path = join(TMP, 'empty.jsonl');
    const q = new QuarantineSink(path);
    const written = await q.flush();
    expect(written).toBe(0);
    const content = await readFile(path, 'utf8');
    expect(content).toBe('');
  });
});
