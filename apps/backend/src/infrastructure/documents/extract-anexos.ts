/**
 * Pure anexos-extraction helpers (no Playwright dependency).
 *
 * Split out of the Playwright fetcher so the fragile "find the document list in
 * whatever JSON the Angular app returned" logic is unit-testable against saved
 * fixtures (task 5.9) without launching a browser.
 *
 * The ComprasMX anexos endpoint is:
 *   GET whitney/sitiopublico/expedientes/{uuid}/anexos?id_proceso={n}&rows=&page=
 * Its exact response shape is undocumented, so every accessor here is defensive:
 * it probes a set of likely field names and degrades gracefully to null.
 */

/** A document extracted from the intercepted anexos response / scraped DOM. */
export interface RawAnexo {
  titulo: string;
  tipo: string | null;
  urlFuente: string;
  /** Download URL if one was discoverable (null → metadata-only). */
  downloadUrl: string | null;
}

// --- field-name probes (lower-cased before matching) ------------------------

const TITULO_KEYS = [
  'titulo',
  'title',
  'nombre',
  'nombre_documento',
  'nom_archivo',
  'descripcion',
  'archivo_nombre',
  'name',
] as const;

const TIPO_KEYS = [
  'tipo',
  'type',
  'tipo_documento',
  'extension',
  'ext',
  'formato',
  'clasificacion',
] as const;

const URL_KEYS = [
  'url',
  'url_descarga',
  'url_archivo',
  'archivo',
  'ruta',
  'ruta_archivo',
  'path',
  'enlace',
  'link',
  'href',
  'uri',
  'documento',
] as const;

const ID_KEYS = ['id', 'id_documento', 'id_anexo', 'uuid', 'folio'] as const;

/** Read a string-ish value from a record by probing a list of keys. */
function probeString(
  rec: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const k of keys) {
    for (const key of Object.keys(rec)) {
      if (key.toLowerCase() === k) {
        const v = rec[key];
        if (typeof v === 'string' && v.trim().length > 0) return v.trim();
        if (typeof v === 'number') return String(v);
      }
    }
  }
  return null;
}

/** Coerce an unknown anexos response body into a list of raw anexo objects. */
export function unwrapAnexoList(body: unknown): Record<string, unknown>[] {
  if (Array.isArray(body)) return body.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null);
  if (body && typeof body === 'object') {
    const rec = body as Record<string, unknown>;
    // Probe common wrapper keys used by PrimeNG/ComprasMX APIs.
    for (const key of ['data', 'resultado', 'lista', 'anexos', 'elementos', 'rows', 'records', 'items', 'result']) {
      const v = rec[key];
      if (Array.isArray(v)) {
        return v.filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null);
      }
    }
    // Nested wrapper: { response: { data: [...] } } etc.
    for (const key of Object.keys(rec)) {
      const v = rec[key];
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const inner = unwrapAnexoList(v);
        if (inner.length > 0) return inner;
      }
    }
  }
  return [];
}

/** Turn a raw anexo record into a normalized RawAnexo. */
export function toRawAnexo(rec: Record<string, unknown>, baseUrl?: string): RawAnexo | null {
  const titulo = probeString(rec, TITULO_KEYS);
  const tipo = probeString(rec, TIPO_KEYS);
  let url = probeString(rec, URL_KEYS);
  const id = probeString(rec, ID_KEYS);

  // Prefer a title; fall back to an id-derived label.
  const label = titulo ?? (id ? `Documento ${id}` : null);
  if (!label) return null;

  // Resolve relative URLs against the API base when possible.
  if (url && baseUrl) {
    try {
      url = new URL(url, baseUrl).toString();
    } catch {
      /* keep raw */
    }
  }

  return {
    titulo: label,
    tipo,
    urlFuente: url ?? baseUrl ?? '(sin URL)',
    downloadUrl: url,
  };
}

/**
 * Extract a normalized anexo list from an intercepted API response body.
 * Returns [] when nothing document-like is found.
 */
export function extractAnexosFromBody(body: unknown, baseUrl?: string): RawAnexo[] {
  const list = unwrapAnexoList(body);
  const out: RawAnexo[] = [];
  for (const rec of list) {
    const anexo = toRawAnexo(rec, baseUrl);
    if (anexo) out.push(anexo);
  }
  return out;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function extractExtension(filename: string | null): string | null {
  if (!filename) return null;
  const m = filename.match(/\.([a-z0-9]{2,4})(?:$|\?|#)/i);
  return m ? m[1]!.toUpperCase() : null;
}

/**
 * Specialized extractor for the REAL ComprasMX whitney anexos response shape
 * (discovered via live Playwright diagnostic against comprasmx.buengobierno.gob.mx):
 *
 *   { success, data: [{ registros: [{ descripcion, tipodoc_descripcion,
 *       uuid_documento, documentos: [{ nombre, uuid_pa, original_size }] }] }] }
 *
 * The generic `extractAnexosFromBody` only unwraps to `data[]` and stops there;
 * the actual files are two levels deeper (`registros[].documentos[]`). This
 * function flattens that nesting so each file becomes its own RawAnexo.
 *
 * `downloadUrl` is null because the download endpoint format is undocumented
 * (#213); metadata (titulo/tipo/filename) is the deliverable, and the frontend
 * links each row to the official anuncio page via `urlFuente = baseUrl`.
 */
export function extractComprasMxAnexos(body: unknown, baseUrl?: string): RawAnexo[] {
  const root = asRecord(body);
  if (!root) return [];
  const data = root['data'];
  if (!Array.isArray(data)) return [];

  const out: RawAnexo[] = [];
  for (const pageEntry of data) {
    const pageRec = asRecord(pageEntry);
    if (!pageRec) continue;
    const registros = pageRec['registros'];
    if (!Array.isArray(registros)) continue;
    for (const reg of registros) {
      const r = asRecord(reg);
      if (!r) continue;
      const catTitulo = probeString(r, ['descripcion', 'tipodoc_descripcion']);
      const tipo = probeString(r, ['tipodoc_descripcion']);
      const docs = r['documentos'];
      if (Array.isArray(docs) && docs.length > 0) {
        for (const doc of docs) {
          const d = asRecord(doc);
          if (!d) continue;
          const nombre = probeString(d, ['nombre', 'descripcion']);
          if (!nombre && !catTitulo) continue;
          out.push({
            titulo: nombre ?? catTitulo!,
            tipo: tipo ?? extractExtension(nombre),
            urlFuente: baseUrl ?? '(sin URL)',
            downloadUrl: null,
          });
        }
      } else if (catTitulo) {
        // A registro with no embedded files yet — still surface the category.
        out.push({ titulo: catTitulo, tipo, urlFuente: baseUrl ?? '(sin URL)', downloadUrl: null });
      }
    }
  }
  return out;
}

/**
 * Fallback: scrape document links from rendered DOM HTML (used when no anexos
 * API response was intercepted). Looks for <a> tags whose href or text suggests
 * a downloadable document.
 */
export function scrapeAnexosFromHtml(html: string, baseUrl?: string): RawAnexo[] {
  const out: RawAnexo[] = [];
  const seen = new Set<string>();
  // Match <a href="...">text</a> (case-insensitive, non-greedy). DOM parsing via
  // regex is intentionally lenient — this is a best-effort fallback path.
  const linkRe = /<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    const href = m[1]!.trim();
    const text = m[2]!.replace(/<[^>]*>/g, '').trim();
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue;
    const signal = `${href}|${text}`.toLowerCase();
    // Heuristic: link text/URL hints at a document download.
    const looksLikeDoc =
      /\.(pdf|docx?|xlsx?|pptx?|zip|rar|csv|txt|rtf|odt|ods|odp)(\?|$)/i.test(href) ||
      /(descarg|anexo|documento|archivo|bajar|download)/i.test(signal);
    if (!looksLikeDoc) continue;
    let abs = href;
    if (baseUrl) {
      try {
        abs = new URL(href, baseUrl).toString();
      } catch {
        /* keep raw */
      }
    }
    if (seen.has(abs)) continue;
    seen.add(abs);
    out.push({
      titulo: text || abs.split('/').pop() || 'Documento',
      tipo: extractExtension(href),
      urlFuente: abs,
      downloadUrl: abs,
    });
  }
  return out;
}

/** Heuristic: does a URL look like the ComprasMX anexos endpoint? */
export function isAnexosEndpoint(url: string): boolean {
  return /\/anexos(\?|\/|$)/i.test(url) || /anexos/i.test(url);
}

/** Heuristic: does a URL look like the ComprasMX expedientes API? */
export function isComprasApi(url: string): boolean {
  return /whitney\/sitiopublico/i.test(url) || /buengobierno\.gob\.mx/i.test(url);
}
