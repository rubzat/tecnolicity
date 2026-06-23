import { createReadStream } from 'node:fs';
import { parse } from 'csv-parse';

/**
 * Streaming CSV parser with latin-1 decoding (CI-1, CI-2).
 *
 * ENCODING DECISION (deviation from design — documented):
 *   Design #215 specified `iconv-lite` for latin-1 stream decoding. Node's
 *   native `fs.createReadStream(path, { encoding: 'latin1' })` maps each byte
 *   0x00–0xFF to the identical Unicode code point, which is correct for the
 *   ISO-8859-1 / Win-1252 Latin range used by ComprasMX (á é í ó ú ñ Ñ Ü — all
 *   in 0xC0–0xFF). Verified round-trip against the real CSV: native latin1
 *   yields "BENEMÉRITA UNIVERSIDAD AUTÓNOMA" while utf8 yields mojibake. This
 *   removes the iconv-lite dependency without changing behaviour (CI-1).
 *
 * STREAMING (CI-2):
 *   The file is never slurped into memory; csv-parse runs in stream mode and
 *   invokes `onRow` per record. The caller is responsible for accumulating the
 *   deduplicated entity objects it cares about.
 */

export interface StreamCsvOptions {
  /** Called once per data row (header row is NOT passed here). */
  onRow: (row: string[], dataRowNumber: number) => void;
  /** Optional: receive the header row. */
  onHeader?: (header: string[]) => void;
}

export interface StreamCsvResult {
  /** Number of data rows processed (excludes the header). */
  totalDataRows: number;
  /** The header row (73 columns). */
  header: string[];
}

/**
 * Stream-parse a latin-1 CSV file, invoking `onRow` for each data row.
 * Resolves when the stream ends. Rejects on a parse error.
 */
export function streamCsv(
  filePath: string,
  options: StreamCsvOptions,
): Promise<StreamCsvResult> {
  const parser = parse({
    delimiter: ',',
    quote: '"',
    relax_quotes: true, // tolerate stray quotes inside fields
    relax_column_count: true, // tolerate ragged rows (quarantine handles logic)
    skip_empty_lines: true,
  });

  // Native latin-1 stream decoding — no iconv-lite dependency.
  const source = createReadStream(filePath, { encoding: 'latin1' });

  let header: string[] | null = null;
  let dataRowNumber = 0;

  return new Promise<StreamCsvResult>((resolve, reject) => {
    source.pipe(parser);

    parser.on('readable', () => {
      let record: string[] | null;
      while ((record = parser.read()) !== null) {
        if (header === null) {
          header = record;
          options.onHeader?.(record);
          continue;
        }
        dataRowNumber++;
        try {
          options.onRow(record, dataRowNumber);
        } catch (err) {
          // Propagate handler errors as stream failures.
          parser.destroy(err instanceof Error ? err : new Error(String(err)));
        }
      }
    });

    parser.on('error', reject);
    parser.on('end', () => {
      resolve({ totalDataRows: dataRowNumber, header: header ?? [] });
    });
  });
}
