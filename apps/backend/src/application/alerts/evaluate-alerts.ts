import type { SavedSearchRepository, SavedSearchRecord } from '../../domain/repositories/saved-search-repository.js';
import type { SavedSearchMatchRepository } from '../../domain/repositories/saved-search-match-repository.js';
import type { VigenteRepository, VigenteRecord } from '../../domain/repositories/vigente-repository.js';
import type { UserRepository } from '../../domain/repositories/user-repository.js';
import type { EmailSender } from '../../domain/email/email-sender.js';
import { buildDigest, type DigestEvent } from './digest-builder.js';

/** Ventana de "cierre próximo" — fija en 3 días (ver spec). */
const CLOSING_SOON_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
/** Cap generoso: la tabla vigente_procedures tiene ~1-2k filas (ver vigente-repository.ts). */
const MAX_VIGENTES_PER_SEARCH = 5000;

export interface EvaluateAlertsDeps {
  savedSearches: SavedSearchRepository;
  matches: SavedSearchMatchRepository;
  vigentes: VigenteRepository;
  users: UserRepository;
  email: EmailSender;
  /** Origen público del frontend, para construir los links del correo (env.CORS_ORIGIN). */
  baseUrl: string;
}

export interface EvaluateAlertsSummary {
  searchesEvaluated: number;
  usersNotified: number;
  eventsDetected: number;
}

interface PendingEvent {
  event: DigestEvent;
  persist: () => Promise<void>;
}

/**
 * Caso de uso central de alertas (PR13). Se dispara pegado al cron diario del
 * scraper de vigentes — ver infrastructure/scheduler/vigente-cron.ts.
 *
 * Para cada búsqueda guardada activa, matchea contra `vigente_procedures`
 * (reusando VigenteRepository.list, sin paginar) y detecta 3 tipos de
 * eventos: new_match, status_change, closing_soon. Los eventos de un mismo
 * usuario se agrupan en un solo correo digest. La persistencia del "ya
 * notificado" ocurre SOLO después de un envío exitoso, para que un fallo de
 * red se reintente automáticamente en la corrida del día siguiente.
 */
export class EvaluateAlerts {
  constructor(private readonly deps: EvaluateAlertsDeps) {}

  async execute(scrapeRunStartedAt: Date, now: Date = new Date()): Promise<EvaluateAlertsSummary> {
    const searches = await this.deps.savedSearches.listActive();
    const eventsByUser = new Map<number, PendingEvent[]>();
    let eventsDetected = 0;

    for (const search of searches) {
      const filters = search.filters;
      const page = await this.deps.vigentes.list(
        {
          tipoContratacion: filters.tipoContratacion,
          tipoProcedimiento: filters.tipoProcedimiento,
          dependencia: filters.dependencia,
          siglas: filters.siglas,
          entidadFederativa: filters.entidadFederativa,
          q: filters.q,
        },
        1,
        MAX_VIGENTES_PER_SEARCH,
      );

      for (const vigente of page.data) {
        const pending = await this.evaluateOne(search, vigente, scrapeRunStartedAt, now);
        if (pending.length === 0) continue;
        eventsDetected += pending.length;
        const list = eventsByUser.get(search.userId) ?? [];
        list.push(...pending);
        eventsByUser.set(search.userId, list);
      }
    }

    let usersNotified = 0;
    for (const [userId, pending] of eventsByUser) {
      const sent = await this.notifyUser(userId, pending);
      if (sent) usersNotified += 1;
    }

    return { searchesEvaluated: searches.length, usersNotified, eventsDetected };
  }

  private async evaluateOne(
    search: SavedSearchRecord,
    vigente: VigenteRecord,
    scrapeRunStartedAt: Date,
    now: Date,
  ): Promise<PendingEvent[]> {
    const pending: PendingEvent[] = [];
    const state = await this.deps.matches.findState(search.id, vigente.id);
    let closingSoonAlreadyNotified = state?.closingSoonNotifiedAt != null;

    if (!state) {
      const isFreshFromThisRun = vigente.createdAt.getTime() >= scrapeRunStartedAt.getTime();
      if (isFreshFromThisRun) {
        pending.push({
          event: {
            type: 'new_match',
            savedSearchName: search.name,
            vigenteNombre: vigente.nombre,
            numeroProcedimiento: vigente.numeroProcedimiento,
            dependencia: vigente.dependencia,
          },
          persist: () => this.deps.matches.createState(search.id, vigente.id, vigente.estatus),
        });
      } else {
        // Línea base silenciosa: no hay correo pendiente para esto, así que
        // se persiste de inmediato (no depende de ningún envío exitoso).
        await this.deps.matches.createState(search.id, vigente.id, vigente.estatus);
      }
      closingSoonAlreadyNotified = false;
    } else if (state.lastEstatus !== vigente.estatus) {
      pending.push({
        event: {
          type: 'status_change',
          savedSearchName: search.name,
          vigenteNombre: vigente.nombre,
          numeroProcedimiento: vigente.numeroProcedimiento,
          dependencia: vigente.dependencia,
          fromEstatus: state.lastEstatus,
          toEstatus: vigente.estatus,
        },
        persist: () => this.deps.matches.updateEstatus(search.id, vigente.id, vigente.estatus),
      });
    }

    const closesAt = vigente.fechaPresentacionApertura;
    if (
      closesAt &&
      closesAt.getTime() > now.getTime() &&
      closesAt.getTime() - now.getTime() <= CLOSING_SOON_WINDOW_MS &&
      !closingSoonAlreadyNotified
    ) {
      pending.push({
        event: {
          type: 'closing_soon',
          savedSearchName: search.name,
          vigenteNombre: vigente.nombre,
          numeroProcedimiento: vigente.numeroProcedimiento,
          dependencia: vigente.dependencia,
          fechaPresentacionApertura: closesAt,
        },
        persist: () => this.deps.matches.markClosingSoonNotified(search.id, vigente.id),
      });
    }

    return pending;
  }

  /** Manda el digest y, solo si tuvo éxito, corre los `persist()` en orden (createState debe correr antes que markClosingSoonNotified para el mismo par). */
  private async notifyUser(userId: number, pending: PendingEvent[]): Promise<boolean> {
    try {
      const user = await this.deps.users.findById(userId);
      if (!user?.email) {
        console.warn(`[alerts] usuario ${userId} tiene ${pending.length} evento(s) pendiente(s) pero no tiene email configurado — se omite`);
        return false;
      }

      const digest = buildDigest(pending.map((p) => p.event), this.deps.baseUrl);
      await this.deps.email.send({ to: user.email, subject: digest.subject, text: digest.text, html: digest.html });

      for (const p of pending) {
        await p.persist();
      }
      return true;
    } catch (err) {
      console.error(`[alerts] no se pudo notificar al usuario ${userId}:`, err);
      return false;
    }
  }
}
