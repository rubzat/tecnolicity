import { describe, it, expect } from 'vitest';
import { EvaluateAlerts } from './evaluate-alerts.js';
import type {
  SavedSearchRepository,
  SavedSearchRecord,
  CreateSavedSearchInput,
  UpdateSavedSearchInput,
} from '../../domain/repositories/saved-search-repository.js';
import type {
  SavedSearchMatchRepository,
  SavedSearchMatchRecord,
} from '../../domain/repositories/saved-search-match-repository.js';
import type {
  VigenteRepository,
  VigenteRecord,
  VigenteFilter,
  VigentePage,
  UpsertVigenteInput,
  VigenteDetalleCache,
} from '../../domain/repositories/vigente-repository.js';
import type {
  UserRepository,
  UserRecord,
  CreateUserInput,
  UpdateUserInput,
} from '../../domain/repositories/user-repository.js';
import type { EmailSender, EmailMessage } from '../../domain/email/email-sender.js';

// --- Fakes -------------------------------------------------------------

class FakeSavedSearchRepository implements SavedSearchRepository {
  rows: SavedSearchRecord[] = [];
  async listByUser(userId: number) {
    return this.rows.filter((r) => r.userId === userId);
  }
  async listActive() {
    return this.rows.filter((r) => r.active);
  }
  async findById(id: number) {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async create(input: CreateSavedSearchInput) {
    const row: SavedSearchRecord = {
      id: this.rows.length + 1,
      userId: input.userId,
      name: input.name,
      filters: input.filters,
      active: true,
      createdAt: new Date(),
    };
    this.rows.push(row);
    return row;
  }
  async update(id: number, patch: UpdateSavedSearchInput) {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return null;
    Object.assign(row, patch);
    return row;
  }
  async delete(id: number) {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => r.id !== id);
    return this.rows.length < before;
  }
}

class FakeSavedSearchMatchRepository implements SavedSearchMatchRepository {
  rows: SavedSearchMatchRecord[] = [];
  private nextId = 1;
  async findState(savedSearchId: number, vigenteId: number) {
    return this.rows.find((r) => r.savedSearchId === savedSearchId && r.vigenteId === vigenteId) ?? null;
  }
  async createState(savedSearchId: number, vigenteId: number, estatus: string | null) {
    this.rows.push({
      id: this.nextId++,
      savedSearchId,
      vigenteId,
      lastEstatus: estatus,
      closingSoonNotifiedAt: null,
      createdAt: new Date(),
    });
  }
  async updateEstatus(savedSearchId: number, vigenteId: number, estatus: string | null) {
    const row = this.rows.find((r) => r.savedSearchId === savedSearchId && r.vigenteId === vigenteId);
    if (row) row.lastEstatus = estatus;
  }
  async markClosingSoonNotified(savedSearchId: number, vigenteId: number) {
    const row = this.rows.find((r) => r.savedSearchId === savedSearchId && r.vigenteId === vigenteId);
    if (row) row.closingSoonNotifiedAt = new Date();
  }
}

class FakeVigenteRepository implements VigenteRepository {
  rows: VigenteRecord[] = [];
  async upsertMany(_rows: UpsertVigenteInput[]) {
    return { inserted: 0, updated: 0 };
  }
  async list(filter: VigenteFilter, page: number, pageSize: number): Promise<VigentePage> {
    const matches = this.rows.filter((r) => {
      if (filter.tipoContratacion && r.tipoContratacion !== filter.tipoContratacion) return false;
      if (filter.tipoProcedimiento && r.tipoProcedimiento !== filter.tipoProcedimiento) return false;
      if (filter.siglas && r.siglasDependencia !== filter.siglas) return false;
      if (filter.entidadFederativa && r.entidadFederativa !== filter.entidadFederativa) return false;
      if (filter.dependencia && !(r.dependencia ?? '').includes(filter.dependencia)) return false;
      if (filter.q && !(r.nombre ?? '').toLowerCase().includes(filter.q.toLowerCase())) return false;
      return true;
    });
    return { data: matches, pagination: { page, page_size: pageSize, total: matches.length, total_pages: 1 } };
  }
  async getByNumero(numero: string) {
    return this.rows.find((r) => r.numeroProcedimiento === numero) ?? null;
  }
  async count() {
    return this.rows.length;
  }
  async getDetalle(): Promise<VigenteDetalleCache | null> {
    return null;
  }
  async updateDetalle() {}
}

class FakeUserRepository implements UserRepository {
  rows: UserRecord[] = [];
  async count() {
    return this.rows.length;
  }
  async list() {
    return this.rows;
  }
  async findByUsername(username: string) {
    return this.rows.find((r) => r.username === username) ?? null;
  }
  async findById(id: number) {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async create(input: CreateUserInput) {
    const row: UserRecord = {
      id: this.rows.length + 1,
      username: input.username,
      passwordHash: input.passwordHash,
      email: input.email ?? null,
      active: true,
      lastLoginAt: null,
      createdAt: new Date(),
    };
    this.rows.push(row);
    return row;
  }
  async update(id: number, patch: UpdateUserInput) {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return null;
    Object.assign(row, patch);
    return row;
  }
  async delete(id: number) {
    const before = this.rows.length;
    this.rows = this.rows.filter((r) => r.id !== id);
    return this.rows.length < before;
  }
  async touchLastLogin() {}
  async countOtherActive(excludeId: number) {
    return this.rows.filter((r) => r.id !== excludeId && r.active).length;
  }
}

class FakeEmailSender implements EmailSender {
  sent: EmailMessage[] = [];
  shouldFail = false;
  async send(message: EmailMessage) {
    if (this.shouldFail) throw new Error('send failed');
    this.sent.push(message);
  }
}

function makeVigente(overrides: Partial<VigenteRecord> = {}): VigenteRecord {
  return {
    id: 1,
    numeroProcedimiento: 'AA-001-2026',
    nombre: 'Construcción de carretera',
    caracter: null,
    dependencia: 'SICT',
    siglasDependencia: 'SICT',
    estatus: 'PUBLICADA',
    fechaJuntaAclaraciones: null,
    fechaPresentacionApertura: null,
    tipoProcedimiento: null,
    tipoContratacion: null,
    unidadCompradora: null,
    codigoExpediente: null,
    uuidProcedimiento: null,
    direccionesAnuncio: null,
    entidadFederativa: null,
    scrapedAt: new Date(),
    createdAt: new Date(),
    ...overrides,
  };
}

function makeDeps() {
  const savedSearches = new FakeSavedSearchRepository();
  const matches = new FakeSavedSearchMatchRepository();
  const vigentes = new FakeVigenteRepository();
  const users = new FakeUserRepository();
  const email = new FakeEmailSender();
  const usecase = new EvaluateAlerts({ savedSearches, matches, vigentes, users, email, baseUrl: 'https://tecnolicity.example' });
  return { usecase, savedSearches, matches, vigentes, users, email };
}

// --- Tests ---------------------------------------------------------------

describe('EvaluateAlerts', () => {
  it('new_match: vigente fresca de esta corrida que matchea → un evento, se manda correo, se crea el estado', async () => {
    const { usecase, savedSearches, vigentes, users, email, matches } = makeDeps();
    const user = await users.create({ username: 'ana', passwordHash: 'x', email: 'ana@example.com' });
    const search = await savedSearches.create({ userId: user.id, name: 'Obra SICT', filters: { siglas: 'SICT' } });
    // Ancla fija: la vigente es "nueva" relativa a la búsqueda, sin depender del reloj real.
    search.createdAt = new Date('2026-01-01T00:00:00Z');
    vigentes.rows.push(makeVigente({ id: 1, createdAt: new Date('2026-09-01T06:05:00Z') }));

    const summary = await usecase.execute();

    expect(summary.eventsDetected).toBe(1);
    expect(summary.usersNotified).toBe(1);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]!.to).toBe('ana@example.com');
    expect(email.sent[0]!.subject).toContain('1 nueva(s)');
    const state = await matches.findState(search.id, 1);
    expect(state?.lastEstatus).toBe('PUBLICADA');
  });

  it('línea base silenciosa: vigente vieja que matchea una búsqueda nueva → sin correo, pero se crea el estado', async () => {
    const { usecase, savedSearches, vigentes, users, email, matches } = makeDeps();
    const user = await users.create({ username: 'ana', passwordHash: 'x', email: 'ana@example.com' });
    const search = await savedSearches.create({ userId: user.id, name: 'Obra SICT', filters: { siglas: 'SICT' } });
    // La búsqueda se creó DESPUÉS de que apareciera la vigente → línea base silenciosa.
    search.createdAt = new Date('2026-06-01T00:00:00Z');
    vigentes.rows.push(makeVigente({ id: 1, createdAt: new Date('2026-01-01T00:00:00Z') }));

    const summary = await usecase.execute();

    expect(summary.eventsDetected).toBe(0);
    expect(email.sent).toHaveLength(0);
    const state = await matches.findState(search.id, 1);
    expect(state).not.toBeNull(); // línea base creada igual, para no re-evaluarla como "nueva" mañana
  });

  it('status_change: vigente ya conocida cambia de estatus → evento, correo, se actualiza el estado tras el envío', async () => {
    const { usecase, savedSearches, vigentes, users, email, matches } = makeDeps();
    const user = await users.create({ username: 'ana', passwordHash: 'x', email: 'ana@example.com' });
    const search = await savedSearches.create({ userId: user.id, name: 'Obra SICT', filters: { siglas: 'SICT' } });
    await matches.createState(search.id, 1, 'PUBLICADA');
    vigentes.rows.push(makeVigente({ id: 1, estatus: 'EN EVALUACIÓN' }));

    const summary = await usecase.execute();

    expect(summary.eventsDetected).toBe(1);
    expect(email.sent[0]!.text).toContain('PUBLICADA');
    expect(email.sent[0]!.text).toContain('EN EVALUACIÓN');
    const state = await matches.findState(search.id, 1);
    expect(state?.lastEstatus).toBe('EN EVALUACIÓN');
  });

  it('closing_soon: vigente cierra en 2 días y nunca se avisó → evento, correo, se marca como notificada', async () => {
    const { usecase, savedSearches, vigentes, users, email, matches } = makeDeps();
    const user = await users.create({ username: 'ana', passwordHash: 'x', email: 'ana@example.com' });
    const search = await savedSearches.create({ userId: user.id, name: 'Obra SICT', filters: { siglas: 'SICT' } });
    const now = new Date('2026-09-01T12:00:00Z');
    await matches.createState(search.id, 1, 'PUBLICADA');
    vigentes.rows.push(
      makeVigente({ id: 1, fechaPresentacionApertura: new Date('2026-09-03T12:00:00Z') }),
    );

    const summary = await usecase.execute(now);

    expect(summary.eventsDetected).toBe(1);
    const state = await matches.findState(search.id, 1);
    expect(state?.closingSoonNotifiedAt).not.toBeNull();
  });

  it('closing_soon: no se repite si ya se había notificado', async () => {
    const { usecase, savedSearches, vigentes, users, email, matches } = makeDeps();
    const user = await users.create({ username: 'ana', passwordHash: 'x', email: 'ana@example.com' });
    const search = await savedSearches.create({ userId: user.id, name: 'Obra SICT', filters: { siglas: 'SICT' } });
    const now = new Date('2026-09-01T12:00:00Z');
    await matches.createState(search.id, 1, 'PUBLICADA');
    await matches.markClosingSoonNotified(search.id, 1);
    vigentes.rows.push(
      makeVigente({ id: 1, fechaPresentacionApertura: new Date('2026-09-03T12:00:00Z') }),
    );

    const summary = await usecase.execute(now);

    expect(summary.eventsDetected).toBe(0);
    expect(email.sent).toHaveLength(0);
  });

  it('búsquedas inactivas no se evalúan', async () => {
    const { usecase, savedSearches, vigentes, users, email } = makeDeps();
    const user = await users.create({ username: 'ana', passwordHash: 'x', email: 'ana@example.com' });
    const search = await savedSearches.create({ userId: user.id, name: 'Obra SICT', filters: { siglas: 'SICT' } });
    await savedSearches.update(search.id, { active: false });
    vigentes.rows.push(makeVigente({ id: 1, createdAt: new Date() }));

    const summary = await usecase.execute();

    expect(summary.searchesEvaluated).toBe(0);
    expect(email.sent).toHaveLength(0);
  });

  it('usuario sin email: no se manda correo y el estado NO se persiste (reintenta al día siguiente)', async () => {
    const { usecase, savedSearches, vigentes, users, email, matches } = makeDeps();
    const user = await users.create({ username: 'ana', passwordHash: 'x', email: null });
    const search = await savedSearches.create({ userId: user.id, name: 'Obra SICT', filters: { siglas: 'SICT' } });
    search.createdAt = new Date('2026-01-01T00:00:00Z');
    vigentes.rows.push(makeVigente({ id: 1, createdAt: new Date('2026-09-01T06:05:00Z') }));

    const summary = await usecase.execute();

    expect(summary.eventsDetected).toBe(1);
    expect(summary.usersNotified).toBe(0);
    expect(email.sent).toHaveLength(0);
    expect(await matches.findState(search.id, 1)).toBeNull();
  });

  it('fallo de envío: no se persiste el estado y no frena la evaluación de otros usuarios', async () => {
    const { usecase, savedSearches, vigentes, users, email, matches } = makeDeps();
    const failingUser = await users.create({ username: 'ana', passwordHash: 'x', email: 'ana@example.com' });
    const okUser = await users.create({ username: 'beto', passwordHash: 'x', email: 'beto@example.com' });
    const searchA = await savedSearches.create({ userId: failingUser.id, name: 'Búsqueda A', filters: { siglas: 'SICT' } });
    const searchB = await savedSearches.create({ userId: okUser.id, name: 'Búsqueda B', filters: { siglas: 'IMSS' } });
    searchA.createdAt = new Date('2026-01-01T00:00:00Z');
    searchB.createdAt = new Date('2026-01-01T00:00:00Z');
    vigentes.rows.push(
      makeVigente({ id: 1, siglasDependencia: 'SICT', createdAt: new Date('2026-09-01T06:05:00Z') }),
      makeVigente({ id: 2, numeroProcedimiento: 'BB-002-2026', siglasDependencia: 'IMSS', createdAt: new Date('2026-09-01T06:05:00Z') }),
    );
    email.shouldFail = true;

    const summary = await usecase.execute();
    expect(summary.eventsDetected).toBe(2);
    expect(summary.usersNotified).toBe(0);
    expect(email.sent).toHaveLength(0);
    expect(await matches.findState(searchA.id, 1)).toBeNull();
    expect(await matches.findState(searchB.id, 2)).toBeNull();

    // Segunda corrida: la frescura está anclada a search.createdAt (fijo), así
    // que los mismos new_match se vuelven a detectar y ahora sí se envían.
    email.shouldFail = false;
    const secondSummary = await usecase.execute();
    expect(secondSummary.eventsDetected).toBe(2);
    expect(secondSummary.usersNotified).toBe(2);
    expect(email.sent).toHaveLength(2);
    expect(email.sent.map((m) => m.to).sort()).toEqual(['ana@example.com', 'beto@example.com']);
    expect(email.sent[0]!.subject).toContain('1 nueva(s)');
    expect(await matches.findState(searchA.id, 1)).not.toBeNull();
    expect(await matches.findState(searchB.id, 2)).not.toBeNull();
  });

  it('agrupa varios eventos del mismo usuario en un solo correo (digest)', async () => {
    const { usecase, savedSearches, vigentes, users, email } = makeDeps();
    const user = await users.create({ username: 'ana', passwordHash: 'x', email: 'ana@example.com' });
    const searchA = await savedSearches.create({ userId: user.id, name: 'Búsqueda A', filters: { siglas: 'SICT' } });
    const searchB = await savedSearches.create({ userId: user.id, name: 'Búsqueda B', filters: { siglas: 'IMSS' } });
    searchA.createdAt = new Date('2026-01-01T00:00:00Z');
    searchB.createdAt = new Date('2026-01-01T00:00:00Z');
    vigentes.rows.push(
      makeVigente({ id: 1, siglasDependencia: 'SICT', createdAt: new Date('2026-09-01T06:05:00Z') }),
      makeVigente({ id: 2, numeroProcedimiento: 'BB-002-2026', siglasDependencia: 'IMSS', createdAt: new Date('2026-09-01T06:05:00Z') }),
    );

    const summary = await usecase.execute();

    expect(summary.eventsDetected).toBe(2);
    expect(email.sent).toHaveLength(1); // un solo correo, no dos
    expect(email.sent[0]!.subject).toContain('2 nueva(s)');
  });

  it('new_match + closing_soon en la misma corrida: createState corre ANTES que markClosingSoonNotified', async () => {
    const { usecase, savedSearches, vigentes, users, email, matches } = makeDeps();
    const user = await users.create({ username: 'ana', passwordHash: 'x', email: 'ana@example.com' });
    const search = await savedSearches.create({ userId: user.id, name: 'Obra SICT', filters: { siglas: 'SICT' } });
    search.createdAt = new Date('2026-01-01T00:00:00Z');
    const now = new Date('2026-09-01T12:00:00Z');
    // Vigente vista por primera vez (sin fila de estado previa) que además cierra en 2 días.
    vigentes.rows.push(
      makeVigente({
        id: 1,
        createdAt: new Date('2026-09-01T06:05:00Z'),
        fechaPresentacionApertura: new Date('2026-09-03T12:00:00Z'),
      }),
    );

    const summary = await usecase.execute(now);

    // (a) los dos eventos viajan en un solo correo
    expect(summary.eventsDetected).toBe(2);
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]!.text).toContain('Nueva coincidencia');
    expect(email.sent[0]!.text).toContain('Cierre próximo');

    // (b) markClosingSoonNotified es un UPDATE plano sin upsert: si su closure
    // hubiera corrido antes que la de createState, no habría fila que actualizar
    // y closingSoonNotifiedAt se quedaría en null sin error alguno.
    const state = await matches.findState(search.id, 1);
    expect(state).not.toBeNull();
    expect(state!.lastEstatus).toBe('PUBLICADA');
    expect(state!.closingSoonNotifiedAt).not.toBeNull();
  });
});
