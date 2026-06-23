import { describe, it, expect } from 'vitest';
import { mapRow, RowMapError } from './row-mapper';
import { COLUMNS } from '../../infrastructure/csv/columns';

/** Build a 73-column row prefilled with empty strings, then apply overrides. */
function makeRow(overrides: Partial<Record<number, string>> = {}): string[] {
  const row = new Array<string>(COLUMNS.direccionAnuncio + 1).fill('');
  for (const [k, v] of Object.entries(overrides)) {
    if (typeof v === 'string') row[Number(k)] = v;
  }
  return row;
}

/** Row 2 of the real ComprasMX CSV (latin-1 decoded). */
const REAL_ROW_2 = makeRow({
  [COLUMNS.ordenGobierno]: 'GEM',
  [COLUMNS.claveRamo]: '80',
  [COLUMNS.descripcionRamo]: 'PUEBLA',
  [COLUMNS.tipoInstitucion]: 'GE',
  [COLUMNS.claveInstitucion]: '080V26',
  [COLUMNS.siglasInstitucion]: 'BUAP',
  [COLUMNS.nombreInstitucion]: 'BENEMÉRITA UNIVERSIDAD AUTÓNOMA DE PUEBLA',
  [COLUMNS.claveUc]: '921069958',
  [COLUMNS.nombreUc]: 'TESORERÍA GENERAL',
  [COLUMNS.codigoExpediente]: 'E-2026-00026692',
  [COLUMNS.referenciaExpediente]: 'CAASBUAP/SF/AD/A.55/09/2026',
  [COLUMNS.tituloExpediente]: 'ADQUISICIÓN DE INSUMOS DE LABORATORIO',
  [COLUMNS.partidaEspecifica]: '25401, 25501, 25901',
  [COLUMNS.ley]: 'LAASSP',
  [COLUMNS.tipoProcedimiento]: 'ADJUDICACIÓN DIRECTA POR MONTOS MÁXIMOS POR EXCEPCIÓN',
  [COLUMNS.articuloExcepcion]: 'ART. 55 PÁRRAFO PRIMERO',
  [COLUMNS.descripcionExcepcion]: 'ADQUISICIONES, ARRENDAMIENTOS Y SERVICIOS',
  [COLUMNS.compraConsolidada]: 'NO',
  [COLUMNS.numeroProcedimiento]: 'AA-80-V26-921069958-N-15-2026',
  [COLUMNS.tipoContratacion]: 'ADQUISICIONES',
  [COLUMNS.caracterProcedimiento]: 'NACIONAL',
  [COLUMNS.formaParticipacion]: 'ELECTRÓNICA',
  [COLUMNS.casoFortuito]: 'NO',
  [COLUMNS.creditoExterno]: 'NO',
  [COLUMNS.fechaPublicacion]: '2026-03-23 20:33:39',
  [COLUMNS.fechaApertura]: '2026-03-23 17:00:00',
  [COLUMNS.fechaFallo]: '2026-03-23 00:00:00',
  [COLUMNS.codigoContrato]: 'C-2026-00029992',
  [COLUMNS.numeroContrato]: 'DAPI-CUPREDER/CAASBUAP-SF-AD.55/2026/09',
  [COLUMNS.tituloContrato]: 'ADQUISICIÓN DE INSUMOS DE LABORATORIO',
  [COLUMNS.descripcionContrato]: 'ADQUISICIÓN DE INSUMOS DE LABORATORIO',
  [COLUMNS.contratoPlurianual]: 'NO',
  [COLUMNS.estatusDrc]: 'PUBLICADO',
  [COLUMNS.fechaInicio]: '24/03/2026',
  [COLUMNS.fechaFin]: '27/03/2026',
  [COLUMNS.importeDrc]: '63666.95',
  [COLUMNS.monedaOriginal]: 'MXN',
  [COLUMNS.convenioModificatorioOriginal]: '',
  [COLUMNS.estatusContrato]: '',
  [COLUMNS.fechaFirmaContrato]: '',
  [COLUMNS.rfc]: 'A&K0512024K4',
  [COLUMNS.proveedor]: 'AMARO & KING SA DE CV',
  [COLUMNS.pais]: 'MX',
  [COLUMNS.nacionalidad]: 'MEXICANA',
  [COLUMNS.autoRegistroCompranet]: 'NO',
  [COLUMNS.estratificacion]: 'PEQUEÑA',
  [COLUMNS.direccionAnuncio]:
    'https://comprasmx.buengobierno.gob.mx/sitiopublico/#/sitiopublico/detalle/4db7dee96544424',
});

describe('row-mapper', () => {
  describe('happy path (real CSV row 2)', () => {
    const mapped = mapRow(REAL_ROW_2);

    it('maps institution with accented latin-1 chars intact', () => {
      expect(mapped.institution.claveInstitucion).toBe('080V26');
      expect(mapped.institution.nombreInstitucion).toBe(
        'BENEMÉRITA UNIVERSIDAD AUTÓNOMA DE PUEBLA',
      );
      expect(mapped.institution.siglas).toBe('BUAP');
      expect(mapped.institution.ordenGobierno).toBe('GEM');
    });

    it('maps purchasing unit with institution ref', () => {
      expect(mapped.purchasingUnit.claveUc).toBe('921069958');
      expect(mapped.purchasingUnit.nombreUc).toBe('TESORERÍA GENERAL');
      expect(mapped.purchasingUnit.claveInstitucion).toBe('080V26');
    });

    it('maps supplier with rfc + accented nombre', () => {
      expect(mapped.supplier?.rfc).toBe('A&K0512024K4');
      expect(mapped.supplier?.nombre).toBe('AMARO & KING SA DE CV');
      expect(mapped.supplier?.estratificacion).toBe('PEQUEÑA');
    });

    it('maps procedure with mixed date formats normalized', () => {
      expect(mapped.procedure.numeroProcedimiento).toBe('AA-80-V26-921069958-N-15-2026');
      expect(mapped.procedure.fechaPublicacion?.toISOString()).toBe('2026-03-23T20:33:39.000Z');
      expect(mapped.procedure.fechaApertura?.toISOString()).toBe('2026-03-23T17:00:00.000Z');
      expect(mapped.procedure.estatus).toBe('PUBLICADO');
      expect(mapped.procedure.descripcion).toBe('ADQUISICIÓN DE INSUMOS DE LABORATORIO');
    });

    it('maps expediente (preserves the comma-bearing partida_especifica)', () => {
      expect(mapped.expediente.codigoExpediente).toBe('E-2026-00026692');
      expect(mapped.expediente.partidaEspecifica).toBe('25401, 25501, 25901');
    });

    it('maps contract with DMY dates → YYYY-MM-DD', () => {
      expect(mapped.contract.codigoContrato).toBe('C-2026-00029992');
      expect(mapped.contract.fechaInicio).toBe('2026-03-24');
      expect(mapped.contract.fechaFin).toBe('2026-03-27');
      expect(mapped.contract.importeDrc).toBe('63666.95');
      expect(mapped.contract.contratoPlurianual).toBe(false);
      expect(mapped.contract.convenioModificatorio).toBeNull();
      expect(mapped.contract.rfc).toBe('A&K0512024K4');
    });

    it('emits null amount rows when both amount blocks are empty', () => {
      // Row 2 of the real file has empty 51-54 AND empty 59-62.
      expect(mapped.amounts.original).toBeNull();
      expect(mapped.amounts.convenio).toBeNull();
    });
  });

  describe('edge cases', () => {
    it('throws RowMapError when clave_institucion is missing', () => {
      const row = makeRow({
        [COLUMNS.claveUc]: 'X',
        [COLUMNS.numeroProcedimiento]: 'P',
      });
      expect(() => mapRow(row)).toThrow(RowMapError);
      expect(() => mapRow(row)).toThrow(/clave_institucion/);
    });

    it('throws RowMapError when clave_uc is missing', () => {
      const row = makeRow({
        [COLUMNS.claveInstitucion]: 'I',
        [COLUMNS.numeroProcedimiento]: 'P',
      });
      expect(() => mapRow(row)).toThrow(/clave_uc/);
    });

    it('throws RowMapError when numero_procedimiento is missing', () => {
      const row = makeRow({
        [COLUMNS.claveInstitucion]: 'I',
        [COLUMNS.claveUc]: 'U',
      });
      expect(() => mapRow(row)).toThrow(/numero_procedimiento/);
    });

    it('throws on structurally short rows', () => {
      expect(() => mapRow(['a', 'b'])).toThrow(RowMapError);
    });

    it('returns null supplier when RFC is blank', () => {
      const row = mapRow(
        makeRow({
          [COLUMNS.claveInstitucion]: 'I',
          [COLUMNS.claveUc]: 'U',
          [COLUMNS.numeroProcedimiento]: 'P',
        }),
      );
      expect(row.supplier).toBeNull();
      expect(row.contract.rfc).toBeNull();
    });

    it('parses thousands-separated money and strips the separator', () => {
      const row = mapRow(
        makeRow({
          [COLUMNS.claveInstitucion]: 'I',
          [COLUMNS.claveUc]: 'U',
          [COLUMNS.numeroProcedimiento]: 'P',
          [COLUMNS.importeDrc]: '9,741,029.28',
          [COLUMNS.montoSinImpMinOriginal]: '1,234.50',
          [COLUMNS.montoConImpMaxOriginal]: '2,000.00',
        }),
      );
      expect(row.contract.importeDrc).toBe('9741029.28');
      expect(row.amounts.original?.montoSinImpMin).toBe('1234.50');
      expect(row.amounts.original?.montoConImpMax).toBe('2000.00');
    });

    it('parses SI/SÍ/NO into booleans', () => {
      const row = mapRow(
        makeRow({
          [COLUMNS.claveInstitucion]: 'I',
          [COLUMNS.claveUc]: 'U',
          [COLUMNS.numeroProcedimiento]: 'P',
          [COLUMNS.compraConsolidada]: 'SÍ',
          [COLUMNS.creditoExterno]: 'SI',
          [COLUMNS.contratoPlurianual]: 'NO',
        }),
      );
      expect(row.procedure.compraConsolidada).toBe(true);
      expect(row.procedure.creditoExterno).toBe(true);
      expect(row.contract.contratoPlurianual).toBe(false);
    });

    it('builds both original + convenio amount rows when populated (row 6 of real file)', () => {
      const row = mapRow(
        makeRow({
          [COLUMNS.claveInstitucion]: 'I',
          [COLUMNS.claveUc]: 'U',
          [COLUMNS.numeroProcedimiento]: 'P',
          [COLUMNS.monedaOriginal]: 'MXN',
          [COLUMNS.montoSinImpMinOriginal]: '476732.03',
          [COLUMNS.montoSinImpMaxOriginal]: '553009.15',
          [COLUMNS.monedaConvenio]: 'MXN',
          [COLUMNS.montoSinImpMinConvenio]: '476732.03',
          [COLUMNS.fechaFinUltimoConv]: '2026-12-31 00:00:00',
        }),
      );
      expect(row.amounts.original?.tipo).toBe('original');
      expect(row.amounts.original?.montoSinImpMin).toBe('476732.03');
      expect(row.amounts.original?.montoSinImpMax).toBe('553009.15');
      expect(row.amounts.convenio?.tipo).toBe('convenio');
      expect(row.amounts.convenio?.montoSinImpMin).toBe('476732.03');
      expect(row.amounts.convenio?.fechaFinConvenio).toBe('2026-12-31');
    });

    it('falls back nombreInstitucion/nombreUc to the clave when blank', () => {
      const row = mapRow(
        makeRow({
          [COLUMNS.claveInstitucion]: 'CLV',
          [COLUMNS.claveUc]: 'UC',
          [COLUMNS.numeroProcedimiento]: 'P',
        }),
      );
      expect(row.institution.nombreInstitucion).toBe('CLV');
      expect(row.purchasingUnit.nombreUc).toBe('UC');
    });
  });
});
