/**
 * SavedSearchRepository — dominio port para `saved_searches` (PR13). Cada
 * fila pertenece a un usuario; los filtros son el mismo shape que ya acepta
 * `GET /vigentes`.
 */

export interface SavedSearchFilters {
  tipoContratacion?: string;
  tipoProcedimiento?: string;
  dependencia?: string;
  siglas?: string;
  entidadFederativa?: string;
  q?: string;
}

export interface SavedSearchRecord {
  id: number;
  userId: number;
  name: string;
  filters: SavedSearchFilters;
  active: boolean;
  createdAt: Date;
}

export interface CreateSavedSearchInput {
  userId: number;
  name: string;
  filters: SavedSearchFilters;
}

export interface UpdateSavedSearchInput {
  name?: string;
  filters?: SavedSearchFilters;
  active?: boolean;
}

export interface SavedSearchRepository {
  listByUser(userId: number): Promise<SavedSearchRecord[]>;
  /** Todas las búsquedas activas de todos los usuarios — usado por EvaluateAlerts. */
  listActive(): Promise<SavedSearchRecord[]>;
  findById(id: number): Promise<SavedSearchRecord | null>;
  create(input: CreateSavedSearchInput): Promise<SavedSearchRecord>;
  update(id: number, patch: UpdateSavedSearchInput): Promise<SavedSearchRecord | null>;
  delete(id: number): Promise<boolean>;
}
