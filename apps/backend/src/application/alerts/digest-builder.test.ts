import { describe, it, expect } from 'vitest';
import { buildDigest, type DigestEvent } from './digest-builder.js';

function makeEvent(overrides: Partial<DigestEvent> = {}): DigestEvent {
  return {
    type: 'new_match',
    savedSearchName: 'Obra pública SICT',
    vigenteNombre: 'Construcción de carretera',
    numeroProcedimiento: 'AA-001-2026',
    dependencia: 'SICT',
    ...overrides,
  };
}

describe('buildDigest', () => {
  it('resume las cantidades por tipo en el subject', () => {
    const digest = buildDigest(
      [
        makeEvent({ type: 'new_match' }),
        makeEvent({ type: 'new_match' }),
        makeEvent({ type: 'closing_soon', fechaPresentacionApertura: new Date('2026-09-10') }),
      ],
      'https://tecnolicity.example',
    );
    expect(digest.subject).toContain('2 nueva(s)');
    expect(digest.subject).toContain('1 por cerrar');
    expect(digest.subject).not.toContain('cambio de estatus');
  });

  it('incluye un link directo al detalle de la vigente en texto y HTML', () => {
    const digest = buildDigest([makeEvent()], 'https://tecnolicity.example');
    expect(digest.text).toContain('https://tecnolicity.example/vigentes/AA-001-2026');
    expect(digest.html).toContain('https://tecnolicity.example/vigentes/AA-001-2026');
  });

  it('describe un evento status_change con los valores from/to', () => {
    const digest = buildDigest(
      [makeEvent({ type: 'status_change', fromEstatus: 'PUBLICADA', toEstatus: 'EN EVALUACIÓN' })],
      'https://tecnolicity.example',
    );
    expect(digest.text).toContain('PUBLICADA');
    expect(digest.text).toContain('EN EVALUACIÓN');
  });

  it('escapa caracteres HTML-inseguros en nombres de vigentes', () => {
    const digest = buildDigest(
      [makeEvent({ vigenteNombre: 'Compra de <equipo> & "accesorios"' })],
      'https://tecnolicity.example',
    );
    expect(digest.html).not.toContain('<equipo>');
    expect(digest.html).toContain('&lt;equipo&gt;');
  });

  it('quita la barra final de baseUrl al construir el link', () => {
    const digest = buildDigest([makeEvent()], 'https://tecnolicity.example/');
    expect(digest.text).toContain('https://tecnolicity.example/vigentes/AA-001-2026');
    expect(digest.text).not.toContain('example//vigentes');
  });
});
