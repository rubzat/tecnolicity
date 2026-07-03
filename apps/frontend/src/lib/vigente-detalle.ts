/**
 * Defensive parsing helpers for the ComprasMX vigente detail JSON (PR8).
 *
 * The 3 detail API responses are undocumented (#213) and only known from
 * live capture (#233). Rather than rely on a typed contract that could break
 * if ComprasMX changes a field name, every accessor here PROBES a set of likely
 * keys and degrades gracefully to null. This mirrors the philosophy of the
 * backend's extract-anexos.ts.
 *
 * Shapes (discovery #233):
 *  - detalle:    { success, data: { registro:[{...}], anexos:[...], req_economicos:[...],
 *                partidas:[...], idiomas:[...], grupos_req_economicos:[...], tratados:[...] } }
 *  - anexos:     { success, data:[{ registros:[{descripcion,tipodoc_descripcion,documentos}],
 *                paginacion:[{total_registros,...}] }] }
 *  - reqeconomicos: { success, data:[{ registros:[{grupo,total,descripcion_gp,data_registros}] }] }
 */

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Pull the first registro from the detalle response (`data.registro[0]`). */
export function getDetalleRegistro(detalle: unknown): Record<string, unknown> | null {
  if (!isRecord(detalle)) return null;
  const data = detalle['data'];
  if (!isRecord(data)) return null;
  const registro = asArray(data['registro']);
  const first = registro[0];
  return isRecord(first) ? first : null;
}

/** Read a string field by probing a list of likely key names (case-insensitive). */
function probeString(rec: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const target of keys) {
    for (const key of Object.keys(rec)) {
      if (key.toLowerCase() === target) {
        const v = rec[key];
        if (typeof v === 'string' && v.trim().length > 0) return v.trim();
        if (typeof v === 'number') return String(v);
      }
    }
  }
  return null;
}

/** Read a numeric field by probing a list of likely key names (case-insensitive). */
function probeNumber(rec: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const target of keys) {
    for (const key of Object.keys(rec)) {
      if (key.toLowerCase() === target) {
        const v = rec[key];
        if (typeof v === 'number' && Number.isFinite(v)) return v;
        if (typeof v === 'string' && v.trim().length > 0) {
          const n = Number(v);
          if (Number.isFinite(n)) return n;
        }
      }
    }
  }
  return null;
}

/** A named key-value pair extracted from the detalle registro (for the info grid). */
export interface DetalleField {
  label: string;
  value: string | null;
}

/** Extract the high-value procedure fields for the info grid + fechas sections. */
export function extractDetalleFields(detalle: unknown): {
  info: DetalleField[];
  fechas: { label: string; iso: string | null }[];
} {
  const reg = getDetalleRegistro(detalle);
  if (!reg) return { info: [], fechas: [] };

  const info: DetalleField[] = [
    { label: 'Tipo de procedimiento', value: probeString(reg, ['tipo_procedimiento']) },
    { label: 'Tipo de contratación', value: probeString(reg, ['tipo_contratacion']) },
    { label: 'Carácter', value: probeString(reg, ['caracter']) },
    { label: 'Ley', value: probeString(reg, ['ley']) },
    { label: 'Forma de participación', value: probeString(reg, ['forma_participacion']) },
    {
      label: 'Dependencia',
      value: probeString(reg, ['nombre_dependencia', 'dependencia']),
    },
    { label: 'Unidad compradora', value: probeString(reg, ['unidad_compradora']) },
    {
      label: 'Entidad federativa',
      value: probeString(reg, ['entidad_federativa_contratacion']),
    },
    {
      label: 'Ejercicio presupuestal',
      value: probeString(reg, ['anio_ejercicio_presupuestal', 'ejercicio_presupuestal']),
    },
    { label: 'Estatus', value: probeString(reg, ['estatus']) },
    {
      label: 'Plazo de contratación',
      value: probeString(reg, ['plazo_proc_contratacion']),
    },
  ];

  const fechas = [
    { label: 'Publicación', keys: ['fecha_publicacion'] as const },
    { label: 'Junta de aclaraciones', keys: ['fecha_junta_aclaracion', 'fecha_aclaraciones'] as const },
    { label: 'Presentación y apertura', keys: ['fecha_apertura'] as const },
    { label: 'Acto de fallo', keys: ['fecha_acto_fallo', 'fecha_fallo'] as const },
  ].map((f) => ({ label: f.label, iso: probeString(reg, f.keys) }));

  return { info, fechas };
}

/** A document extracted from the anexos response (or nested in detalle). */
export interface DetalleAnexo {
  descripcion: string;
  tipo: string | null;
  /** Count of attached files (when the nested `documentos` array is present). */
  archivos: number;
}

/**
 * Extract the document list from EITHER the separate anexos endpoint OR the
 * anexos nested inside detalle.data.anexos. The separate endpoint is paginated
 * and richer, so prefer it when present; fall back to the nested copy.
 */
export function extractAnexos(
  anexos: unknown,
  detalle: unknown,
): { documentos: DetalleAnexo[]; total: number | null } {
  const fromSeparate = extractFromSeparateAnexos(anexos);
  if (fromSeparate.documentos.length > 0) return fromSeparate;

  // Fallback: detalle.data.anexos (simpler shape: [{descripcion, tipodoc_descripcion}, ...])
  const docs: DetalleAnexo[] = [];
  const reg = getDetalleRegistro(detalle);
  if (reg) {
    // detalle.data.anexos is under data, not registro
  }
  if (isRecord(detalle)) {
    const data = detalle['data'];
    if (isRecord(data)) {
      for (const a of asArray(data['anexos'])) {
        if (!isRecord(a)) continue;
        const descripcion = probeString(a, ['descripcion', 'tipodoc_descripcion', 'nombre_archivo']);
        if (!descripcion) continue;
        const tipo = probeString(a, ['tipodoc_descripcion']);
        docs.push({ descripcion, tipo, archivos: asArray(a['documentos']).length });
      }
    }
  }
  return { documentos: docs, total: docs.length > 0 ? docs.length : null };
}

function extractFromSeparateAnexos(anexos: unknown): { documentos: DetalleAnexo[]; total: number | null } {
  if (!isRecord(anexos)) return { documentos: [], total: null };
  const data = asArray(anexos['data']);
  if (data.length === 0) return { documentos: [], total: null };

  const page0 = isRecord(data[0]) ? data[0] : null;
  if (!page0) return { documentos: [], total: null };

  const registros = asArray(page0['registros']);
  const pag = asArray(page0['paginacion'])[0];
  let total: number | null = null;
  if (isRecord(pag)) {
    const t = Number(pag['total_registros'] ?? 0);
    if (Number.isFinite(t) && t > 0) total = t;
  }

  const docs: DetalleAnexo[] = [];
  for (const r of registros) {
    if (!isRecord(r)) continue;
    const descripcion =
      probeString(r, ['descripcion', 'tipodoc_descripcion']) ?? '(sin título)';
    const tipo = probeString(r, ['tipodoc_descripcion']);
    docs.push({ descripcion, tipo, archivos: asArray(r['documentos']).length });
  }
  return { documentos: docs, total };
}

/** One line item (partida) within an economic-requirements group. */
export interface DetalleReqEconomicoItem {
  claveCucop: string | null;
  descripcion: string | null;
  unidadMedida: string | null;
  montoMinimo: number | null;
  montoMaximo: number | null;
}

/** One economic-requirements group from reqeconomicos (or nested detalle). */
export interface DetalleReqEconomico {
  grupo: string | null;
  total: string | null;
  descripcion: string | null;
  items: DetalleReqEconomicoItem[];
}

/** Extract one line item from a data_registros (or flat req_economicos) entry. */
function extractReqItem(r: Record<string, unknown>): DetalleReqEconomicoItem {
  return {
    claveCucop: probeString(r, ['clave_cucop']),
    descripcion: probeString(r, ['descripcion_detallada', 'descripcion_cucop']),
    unidadMedida: probeString(r, ['unidad_medida']),
    montoMinimo: probeNumber(r, ['monto_minimo']),
    montoMaximo: probeNumber(r, ['monto_maximo']),
  };
}

/** Extract economic requirements, preferring the separate endpoint, else detalle. */
export function extractReqEconomicos(
  reqeconomicos: unknown,
  detalle: unknown,
): DetalleReqEconomico[] {
  const fromSeparate = extractFromSeparateReq(reqeconomicos);
  if (fromSeparate.length > 0) return fromSeparate;

  // Fallback: detalle.data.req_economicos (flat list, not grouped)
  if (isRecord(detalle)) {
    const data = detalle['data'];
    if (isRecord(data)) {
      const list = asArray(data['req_economicos']);
      if (list.length > 0) {
        const groups = list
          .filter(isRecord)
          .map((r) => ({
            grupo: probeString(r, ['grupo', 'descripcion_grupo']),
            total: probeString(r, ['monto_maximo', 'monto_minimo']),
            descripcion: probeString(r, ['descripcion_cucop', 'descripcion_detallada']),
            items: [extractReqItem(r)],
          }))
          .filter((x) => x.grupo || x.descripcion);
        if (groups.length > 0) return groups;
      }
    }
  }
  return [];
}

function extractFromSeparateReq(reqeconomicos: unknown): DetalleReqEconomico[] {
  if (!isRecord(reqeconomicos)) return [];
  const data = asArray(reqeconomicos['data']);
  const page0 = isRecord(data[0]) ? data[0] : null;
  if (!page0) return [];
  const registros = asArray(page0['registros']);
  return registros
    .filter(isRecord)
    .map((r) => ({
      grupo: probeString(r, ['grupo', 'descripcion_gp']),
      total: probeString(r, ['total']),
      descripcion: probeString(r, ['descripcion_gp']),
      items: asArray(r['data_registros']).filter(isRecord).map(extractReqItem),
    }));
}
