import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Quarantine sink for malformed rows (CI-7).
 *
 * Rows that fail parsing or mapping (missing natural key, structural defect)
 * are routed here instead of aborting the batch. At the end of ingestion the
 * sink is flushed to a JSONL file (`{rowNumber, reason, field, rawRow}` per
 * line) and counted in the final report.
 */
export interface QuarantineEntry {
  /** 1-based data row number (matches the CSV physical row minus the header). */
  rowNumber: number;
  /** Human-readable reason. */
  reason: string;
  /** Optional offending field name. */
  field?: string;
  /** The raw parsed row, for forensic re-play. */
  rawRow: string[];
}

export class QuarantineSink {
  private readonly entries: QuarantineEntry[] = [];

  constructor(private readonly filePath: string) {}

  add(entry: QuarantineEntry): void {
    this.entries.push(entry);
  }

  get count(): number {
    return this.entries.length;
  }

  /** Snapshot of all quarantined entries (for the final report). */
  snapshot(): readonly QuarantineEntry[] {
    return this.entries;
  }

  /**
   * Write the quarantined entries to `filePath` as JSONL. Creates parent
   * directories. Returns the number of entries written. If there are no
   * entries, the file is still (over)written as empty so stale data never
   * masquerades as the current run's quarantine.
   */
  async flush(): Promise<number> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const lines = this.entries.map((e) => JSON.stringify(e)).join('\n');
    await writeFile(this.filePath, lines + (lines ? '\n' : ''), 'utf8');
    return this.entries.length;
  }
}
