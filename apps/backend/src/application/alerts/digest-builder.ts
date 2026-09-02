import type { AlertEventType } from '../../domain/repositories/saved-search-match-repository.js';

export interface DigestEvent {
  type: AlertEventType;
  savedSearchName: string;
  vigenteNombre: string | null;
  numeroProcedimiento: string;
  dependencia: string | null;
  fromEstatus?: string | null;
  toEstatus?: string | null;
  fechaPresentacionApertura?: Date | null;
}

export interface Digest {
  subject: string;
  text: string;
  html: string;
}

/**
 * Link al listado público de oportunidades filtrado por el número de
 * procedimiento. NO existe una ruta de detalle deep-linkable en el frontend
 * (`/vigentes/:numero` solo existe como endpoint de la API), así que apuntamos
 * a `/oportunidades?q=<numero>`: el filtro de texto libre `q` de esa página
 * matchea `numero_procedimiento` por ILIKE, dejando (normalmente) un solo
 * resultado a la vista.
 */
function vigenteUrl(baseUrl: string, numeroProcedimiento: string): string {
  return `${baseUrl.replace(/\/$/, '')}/oportunidades?q=${encodeURIComponent(numeroProcedimiento)}`;
}

function describeEvent(event: DigestEvent): string {
  const nombre = event.vigenteNombre ?? event.numeroProcedimiento;
  switch (event.type) {
    case 'new_match':
      return `Nueva coincidencia en "${event.savedSearchName}": ${nombre}${event.dependencia ? ` — ${event.dependencia}` : ''}`;
    case 'status_change':
      return `Cambio de estatus en "${event.savedSearchName}": ${nombre} pasó de "${event.fromEstatus ?? 'sin estatus'}" a "${event.toEstatus ?? 'sin estatus'}"`;
    case 'closing_soon':
      return `Cierre próximo en "${event.savedSearchName}": ${nombre} cierra el ${
        event.fechaPresentacionApertura?.toLocaleDateString('es-MX') ?? 'próximamente'
      }`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Arma un digest (subject + texto plano + HTML simple) para un lote de eventos de un usuario. */
export function buildDigest(events: DigestEvent[], baseUrl: string): Digest {
  const counts: Record<AlertEventType, number> = { new_match: 0, closing_soon: 0, status_change: 0 };
  for (const e of events) counts[e.type] += 1;

  const subjectParts: string[] = [];
  if (counts.new_match > 0) subjectParts.push(`${counts.new_match} nueva(s)`);
  if (counts.closing_soon > 0) subjectParts.push(`${counts.closing_soon} por cerrar`);
  if (counts.status_change > 0) subjectParts.push(`${counts.status_change} con cambio de estatus`);
  const subject = `Tecnolicity — ${subjectParts.join(' · ')}`;

  const text = events
    .map((e) => `- ${describeEvent(e)}\n  ${vigenteUrl(baseUrl, e.numeroProcedimiento)}`)
    .join('\n\n');

  const htmlItems = events
    .map(
      (e) =>
        `<li>${escapeHtml(describeEvent(e))}<br/><a href="${vigenteUrl(baseUrl, e.numeroProcedimiento)}">Ver detalle</a></li>`,
    )
    .join('');
  const html = `<div><ul>${htmlItems}</ul></div>`;

  return { subject, text, html };
}
