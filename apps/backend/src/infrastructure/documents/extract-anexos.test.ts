import { describe, it, expect } from 'vitest';
import {
  extractAnexosFromBody,
  extractComprasMxAnexos,
  scrapeAnexosFromHtml,
  unwrapAnexoList,
  isAnexosEndpoint,
  isComprasApi,
} from './extract-anexos.js';

describe('extract-anexos (anexos API response parsing)', () => {
  it('handles a bare array body', () => {
    const body = [
      { titulo: 'Bases', url: 'https://x.test/bases.pdf', tipo: 'PDF' },
      { titulo: 'Anexo 1', url_descarga: '/rel/a1.docx' },
    ];
    const out = extractAnexosFromBody(body, 'https://x.test/api/');
    expect(out).toHaveLength(2);
    expect(out[0]!.titulo).toBe('Bases');
    expect(out[0]!.tipo).toBe('PDF');
    expect(out[0]!.downloadUrl).toBe('https://x.test/bases.pdf');
    // relative URL resolved against baseUrl
    expect(out[1]!.downloadUrl).toBe('https://x.test/rel/a1.docx');
  });

  it('unwraps a PrimeNG-style { data: [...] } wrapper', () => {
    const body = {
      data: [{ titulo: 'Dictamen', archivo: 'https://x.test/d.pdf' }],
      total: 1,
    };
    expect(extractAnexosFromBody(body)).toHaveLength(1);
  });

  it('unwraps a { resultado: { lista: [...] } } nested wrapper', () => {
    const body = {
      resultado: {
        lista: [
          { nombre: 'A', ruta: 'https://x.test/a' },
          { nombre_documento: 'B', enlace: 'https://x.test/b' },
        ],
      },
    };
    const out = extractAnexosFromBody(body);
    expect(out.map((a) => a.titulo)).toEqual(['A', 'B']);
  });

  it('returns [] when no document-like objects are present', () => {
    expect(extractAnexosFromBody({ foo: 'bar', nested: { x: 1 } })).toEqual([]);
    expect(extractAnexosFromBody(null)).toEqual([]);
    expect(extractAnexosFromBody(undefined)).toEqual([]);
    expect(extractAnexosFromBody(42)).toEqual([]);
  });

  it('derives a label from an id when no titulo/name exists', () => {
    const out = extractAnexosFromBody([{ id_documento: 77, url: 'https://x.test/77' }]);
    expect(out[0]!.titulo).toBe('Documento 77');
  });

  it('skips anexo objects with neither title nor id', () => {
    const out = extractAnexosFromBody([{ url: 'https://x.test/x' }]);
    expect(out).toHaveLength(0);
  });

  it('probes multiple tipo field names', () => {
    const out = extractAnexosFromBody([
      { titulo: 'A', extension: 'PDF' },
      { titulo: 'B', formato: 'DOCX' },
      { titulo: 'C', tipo_documento: 'XLSX' },
    ]);
    expect(out.map((a) => a.tipo)).toEqual(['PDF', 'DOCX', 'XLSX']);
  });
});

describe('unwrapAnexoList', () => {
  it('returns the array directly when body is already an array', () => {
    expect(unwrapAnexoList([{ a: 1 }])).toEqual([{ a: 1 }]);
  });

  it('returns [] for empty objects', () => {
    expect(unwrapAnexoList({})).toEqual([]);
  });
});

describe('scrapeAnexosFromHtml (DOM fallback)', () => {
  const html = `
    <html><body>
      <a href="/files/bases.pdf">Bases de la licitación</a>
      <a href="https://other.test/anexo1.docx">Descargar anexo 1</a>
      <a href="#section">ir a sección</a>
      <a href="javascript:void(0)">click</a>
      <a href="/about">Acerca de</a>
      <a href="/files/bases.pdf">Bases (duplicate)</a>
      <a href="/files/reporte.xlsx"></a>
    </body></html>
  `;

  it('keeps only links that look like documents (extension or descarg/anexo wording)', () => {
    const out = scrapeAnexosFromHtml(html, 'https://x.test/');
    const hrefs = out.map((a) => a.urlFuente).sort();
    // bases.pdf, anexo1.docx, reporte.xlsx — duplicates collapsed, nav/anchor links dropped.
    expect(hrefs).toEqual([
      'https://other.test/anexo1.docx',
      'https://x.test/files/bases.pdf',
      'https://x.test/files/reporte.xlsx',
    ]);
  });

  it('derives tipo from the file extension', () => {
    const out = scrapeAnexosFromHtml(html, 'https://x.test/');
    const pdf = out.find((a) => a.tipo === 'PDF');
    const docx = out.find((a) => a.tipo === 'DOCX');
    expect(pdf).toBeTruthy();
    expect(docx).toBeTruthy();
  });

  it('uses the filename as titulo when link text is empty', () => {
    const out = scrapeAnexosFromHtml(html, 'https://x.test/');
    const xlsx = out.find((a) => a.tipo === 'XLSX');
    expect(xlsx?.titulo).toBe('reporte.xlsx');
  });

  it('resolves relative hrefs against the base URL', () => {
    const out = scrapeAnexosFromHtml('<a href="/a/b.pdf">x</a>', 'https://host.test');
    expect(out[0]!.downloadUrl).toBe('https://host.test/a/b.pdf');
  });

  it('returns [] when no document-like anchors exist', () => {
    expect(scrapeAnexosFromHtml('<a href="/about">About</a>')).toEqual([]);
  });
});

describe('endpoint heuristics', () => {
  it('isAnexosEndpoint matches the whitney anexos path', () => {
    expect(
      isAnexosEndpoint(
        'https://upcp-cnetservicios.buengobierno.gob.mx/whitney/sitiopublico/expedientes/UUID/anexos?id_proceso=1&rows=&page=',
      ),
    ).toBe(true);
    expect(isAnexosEndpoint('https://x.test/expedientes/UUID/detalle')).toBe(false);
  });

  it('isComprasApi detects the ComprasMX host / whitney path', () => {
    expect(isComprasApi('https://upcp-cnetservicios.buengobierno.gob.mx/whitney/sitiopublico/x')).toBe(true);
    expect(isComprasApi('https://comprasmx.buengobierno.gob.mx/#/x')).toBe(true);
    expect(isComprasApi('https://example.com/api')).toBe(false);
  });
});

// Real ComprasMX whitney anexos response shape (captured live via Playwright).
const COMPRASMX_ANEXOS_BODY = {
  success: true,
  data: [
    {
      registros: [
        {
          no: 1,
          descripcion: 'ANEXO TÉCNICO',
          tipodoc_descripcion: 'ANEXO TÉCNICO',
          uuid_documento: '5d2fa9b9-76e5-442d-8ea8-943901832add',
          id_proc_anexo: 7036898,
          documentos: [
            {
              id_proc_anexo: 7036898,
              descripcion: 'ANEXO TÉCNICO',
              uuid_pa: '5d2fa9b9-76e5-442d-8ea8-943901832add',
              nombre: 'ANEXO TECNICO.pdf',
              original_size: 184661,
              file_size: 0.1761065,
            },
          ],
        },
        {
          no: 2,
          descripcion: 'OFICIO DE NOTIFICACIÓN DE ADJUDICACIÓN',
          tipodoc_descripcion: 'OFICIO DE NOTIFICACIÓN DE ADJUDICACIÓN',
          uuid_documento: '2c50ef1d-e9a8-4818-a0c4-c79be44112ca',
          id_proc_anexo: 7043019,
          documentos: [
            {
              id_proc_anexo: 7043019,
              descripcion: 'OFICIO DE NOTIFICACIÓN',
              uuid_pa: '2c50ef1d-e9a8-4818-a0c4-c79be44112ca',
              nombre: 'AMARO.pdf',
              original_size: 1020446,
            },
          ],
        },
      ],
      paginacion: [{ pagina_actual: 1, total_registros: 2 }],
    },
  ],
  msg: null,
};

describe('extractComprasMxAnexos (real ComprasMX shape)', () => {
  const anuncio = 'https://comprasmx.buengobierno.gob.mx/sitiopublico/#/sitiopublico/detalle/UUID/procedimiento';

  it('flattens registros[].documentos[] into one anexo per file', () => {
    const out = extractComprasMxAnexos(COMPRASMX_ANEXOS_BODY, anuncio);
    expect(out).toHaveLength(2);
    // First file: filename "ANEXO TECNICO.pdf", tipo from tipodoc_descripcion
    expect(out[0]!.titulo).toBe('ANEXO TECNICO.pdf');
    expect(out[0]!.tipo).toBe('ANEXO TÉCNICO');
    // Second file
    expect(out[1]!.titulo).toBe('AMARO.pdf');
  });

  it('uses the anuncio URL as urlFuente (frontend links each row to the official page)', () => {
    const out = extractComprasMxAnexos(COMPRASMX_ANEXOS_BODY, anuncio);
    expect(out.every((a) => a.urlFuente === anuncio)).toBe(true);
  });

  it('sets downloadUrl null (download endpoint format undocumented, #213)', () => {
    const out = extractComprasMxAnexos(COMPRASMX_ANEXOS_BODY, anuncio);
    expect(out.every((a) => a.downloadUrl === null)).toBe(true);
  });

  it('falls back to tipodoc extension when nombre has none', () => {
    const body = {
      success: true,
      data: [
        {
          registros: [
            {
              descripcion: 'Resolución',
              tipodoc_descripcion: 'Resolución',
              documentos: [{ nombre: 'resolucion_sin_ext', uuid_pa: 'x' }],
            },
          ],
        },
      ],
    };
    const out = extractComprasMxAnexos(body);
    expect(out[0]!.titulo).toBe('resolucion_sin_ext');
    expect(out[0]!.tipo).toBe('Resolución');
  });

  it('handles a registro with no embedded documentos (category only)', () => {
    const body = { success: true, data: [{ registros: [{ descripcion: 'Bases', tipodoc_descripcion: 'Bases' }] }] };
    const out = extractComprasMxAnexos(body);
    expect(out).toHaveLength(1);
    expect(out[0]!.titulo).toBe('Bases');
  });

  it('returns [] when the shape does not match', () => {
    expect(extractComprasMxAnexos(null)).toEqual([]);
    expect(extractComprasMxAnexos({ success: false })).toEqual([]);
    expect(extractComprasMxAnexos({ data: [] })).toEqual([]);
    expect(extractComprasMxAnexos({ data: [{ foo: 'bar' }] })).toEqual([]);
  });

  it('the generic extractor alone would MISS this shape (proving the specialized one is needed)', () => {
    // The generic extractAnexosFromBody unwraps to data[] but the elements are
    // {registros, paginacion} objects with no titulo/url fields → 0 results.
    expect(extractAnexosFromBody(COMPRASMX_ANEXOS_BODY, anuncio)).toHaveLength(0);
  });
});
