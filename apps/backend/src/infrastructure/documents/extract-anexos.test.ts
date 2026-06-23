import { describe, it, expect } from 'vitest';
import {
  extractAnexosFromBody,
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
