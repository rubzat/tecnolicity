import { describe, it, expect } from 'vitest';
import {
  parseRegistro,
  parseSearchResponse,
  buildAnuncioUrl,
  VIGENTE_FILTER_BODY,
} from './parse-vigente';

/**
 * Pure-parser unit tests (no browser, no DB). The fixture is a REAL registro
 * captured from the ComprasMX search API (discovery #231).
 */
const REAL_REGISTRO = {
  no: 1,
  id_procedimiento: 442348,
  numero_procedimiento: 'LO-09-210-009000999-N-694-2026',
  nombre_procedimiento: 'RECONSTRUCCIÓN Y CONSERVACIÓN DE TERRACERÍAS DEL CAMINO',
  siglas: 'SICT',
  estatus: 'VIGENTE PAP',
  estatus_alterno: 'VIGENTE',
  tipo_procedimiento: 'LICITACIÓN PÚBLICA',
  cod_expediente: 'E-2026-00063802',
  caracter: 'NACIONAL',
  fecha_aclaraciones: '2026-06-16T18:30:00',
  fecha_apertura: '2026-06-23T17:40:00',
  uuid_procedimiento: '56c41b823ffb4e378a1dfed8cff56686',
  id_proceso: 0,
  fecha_limite: null,
  entidad_federativa_contratacion: 'CHIAPAS',
  unidad_compradora: '009000999 - DIRECCIÓN GENERAL DE CARRETERAS',
  tipo_contratacion: 'OBRA PÚBLICA',
};

describe('parseRegistro', () => {
  it('maps a real API registro to the domain row', () => {
    const r = parseRegistro(REAL_REGISTRO)!;
    expect(r).not.toBeNull();
    expect(r.numeroProcedimiento).toBe('LO-09-210-009000999-N-694-2026');
    expect(r.nombre).toContain('RECONSTRUCCIÓN');
    expect(r.caracter).toBe('NACIONAL');
    expect(r.siglasDependencia).toBe('SICT');
    expect(r.estatus).toBe('VIGENTE PAP');
    expect(r.tipoProcedimiento).toBe('LICITACIÓN PÚBLICA');
    expect(r.tipoContratacion).toBe('OBRA PÚBLICA');
    expect(r.codigoExpediente).toBe('E-2026-00063802');
    expect(r.unidadCompradora).toContain('DIRECCIÓN GENERAL DE CARRETERAS');
    expect(r.entidadFederativa).toBe('CHIAPAS');
    expect(r.uuidProcedimiento).toBe('56c41b823ffb4e378a1dfed8cff56686');
  });

  it('parses the two key dates with the Mexico City (-06:00) offset applied', () => {
    const r = parseRegistro(REAL_REGISTRO)!;
    expect(r.fechaJuntaAclaraciones).toBeInstanceOf(Date);
    // API "2026-06-16T18:30:00" (no zone) → pinned to -06:00 → 00:30:00Z next day.
    expect(r.fechaJuntaAclaraciones!.toISOString()).toBe('2026-06-17T00:30:00.000Z');
    expect(r.fechaPresentacionApertura).toBeInstanceOf(Date);
    // API "2026-06-23T17:40:00" → -06:00 → 23:40:00Z same calendar day.
    expect(r.fechaPresentacionApertura!.toISOString()).toBe('2026-06-23T23:40:00.000Z');
  });

  it('builds the detail/anuncio URL from the uuid', () => {
    const r = parseRegistro(REAL_REGISTRO)!;
    expect(r.direccionesAnuncio).toBe(
      'https://comprasmx.buengobierno.gob.mx/sitiopublico/#/sitiopublico/detalle/56c41b823ffb4e378a1dfed8cff56686/procedimiento',
    );
  });

  it('does NOT set dependencia (the search API never sends it)', () => {
    const r = parseRegistro(REAL_REGISTRO)!;
    expect(r.dependencia).toBeNull();
  });

  it('keeps the full raw registro for forward compatibility', () => {
    const r = parseRegistro(REAL_REGISTRO)!;
    expect(r.rawData).toEqual(expect.objectContaining({ id_procedimiento: 442348 }));
  });

  it('returns null when numero_procedimiento is missing', () => {
    expect(parseRegistro({ siglas: 'IMSS' })).toBeNull();
    expect(parseRegistro(null)).toBeNull();
    expect(parseRegistro('string')).toBeNull();
  });

  it('tolerates missing dates and null uuid', () => {
    const r = parseRegistro({ numero_procedimiento: 'X-1', fecha_apertura: null })!;
    expect(r.fechaJuntaAclaraciones).toBeNull();
    expect(r.fechaPresentacionApertura).toBeNull();
    expect(r.uuidProcedimiento).toBeNull();
    expect(r.direccionesAnuncio).toBeNull();
  });

  it('tolerates a garbage date without throwing', () => {
    const r = parseRegistro({
      numero_procedimiento: 'X-2',
      fecha_apertura: 'not-a-date',
    })!;
    expect(r.fechaPresentacionApertura).toBeNull();
  });
});

describe('parseSearchResponse', () => {
  it('parses registros + pagination from the real wrapper shape', () => {
    const body = {
      success: true,
      data: [
        {
          registros: [REAL_REGISTRO, { ...REAL_REGISTRO, no: 2, numero_procedimiento: 'AA-2' }],
          paginacion: [
            {
              pagina_actual: 1,
              registros_pagina: 100,
              total_paginas: 12,
              total_registros: 1125,
              registro_inicial: 1,
              registro_final: 100,
            },
          ],
        },
      ],
      msg: null,
      pid: 1,
    };
    const parsed = parseSearchResponse(body);
    expect(parsed.registros).toHaveLength(2);
    const first = parsed.registros[0];
    expect(first).toBeDefined();
    expect(first!.numeroProcedimiento).toBe('LO-09-210-009000999-N-694-2026');
    expect(parsed.pagination).not.toBeNull();
    expect(parsed.pagination!.totalRegistros).toBe(1125);
    expect(parsed.pagination!.totalPaginas).toBe(12);
  });

  it('returns empty + null pagination for malformed bodies', () => {
    expect(parseSearchResponse(null)).toEqual({ registros: [], pagination: null });
    expect(parseSearchResponse({})).toEqual({ registros: [], pagination: null });
    expect(parseSearchResponse({ data: [] })).toEqual({ registros: [], pagination: null });
    expect(parseSearchResponse({ data: [{}] })).toEqual({ registros: [], pagination: null });
  });

  it('drops registros without a numero_procedimiento', () => {
    const parsed = parseSearchResponse({
      data: [{ registros: [{ siglas: 'X' }, REAL_REGISTRO] }],
    });
    expect(parsed.registros).toHaveLength(1);
  });
});

describe('buildAnuncioUrl', () => {
  it('builds the detalle URL', () => {
    expect(buildAnuncioUrl('abc123')).toBe(
      'https://comprasmx.buengobierno.gob.mx/sitiopublico/#/sitiopublico/detalle/abc123/procedimiento',
    );
  });
  it('returns null for falsy input', () => {
    expect(buildAnuncioUrl(null)).toBeNull();
    expect(buildAnuncioUrl('')).toBeNull();
  });
});

describe('VIGENTE_FILTER_BODY', () => {
  it('targets the vigentes tab (id_estatus:0, id_proceso:0)', () => {
    expect(VIGENTE_FILTER_BODY.id_estatus).toBe(0);
    expect(VIGENTE_FILTER_BODY.id_proceso).toBe(0);
  });
});
