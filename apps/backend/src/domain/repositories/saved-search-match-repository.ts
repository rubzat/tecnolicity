/**
 * SavedSearchMatchRepository — dominio port para `saved_search_matches`
 * (PR13). Guarda el estado "qué vigente ya vimos para cuál búsqueda" y evita
 * re-notificar el mismo evento dos veces.
 */

export type AlertEventType = 'new_match' | 'closing_soon' | 'status_change';

export interface SavedSearchMatchRecord {
  id: number;
  savedSearchId: number;
  vigenteId: number;
  lastEstatus: string | null;
  closingSoonNotifiedAt: Date | null;
  createdAt: Date;
}

export interface SavedSearchMatchRepository {
  /** Fila de estado para el par (búsqueda, vigente), o null si nunca se vio. */
  findState(savedSearchId: number, vigenteId: number): Promise<SavedSearchMatchRecord | null>;
  /** Crea la fila base la primera vez que una vigente se ve para una búsqueda. */
  createState(savedSearchId: number, vigenteId: number, estatus: string | null): Promise<void>;
  /** Actualiza el último estatus conocido (tras notificar un status_change). */
  updateEstatus(savedSearchId: number, vigenteId: number, estatus: string | null): Promise<void>;
  /** Marca que ya se avisó el cierre próximo (no se debe repetir). */
  markClosingSoonNotified(savedSearchId: number, vigenteId: number): Promise<void>;
}
