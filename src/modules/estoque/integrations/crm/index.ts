import type { Db, IntegrationEvent } from "../../domain/types";
import { findSerial } from "../../domain/core";
import { reserveSerials, releaseReservation } from "../../domain/sales";
import { canSeeCost } from "../../domain/permissions";
import { integrationMode, type CostAnswer, type CostQuery, type CrmPort } from "../ports";

/** Acesso ao banco do módulo: leitura direta e escrita atômica/persistida. */
export interface DbIO {
  read: () => Db;
  write: <T>(fn: (db: Db) => T) => T;
}

/** Implementação simulada: opera no banco do módulo, sem chamar o CRM de verdade. */
export function createMockCrm(io: DbIO, userId: () => string): CrmPort {
  return {
    async queryCost(q: CostQuery, companyId: string): Promise<CostAnswer[]> {
      const db = io.read();
      const profile = db.profiles.find((p) => p.id === userId());
      if (!canSeeCost(profile, companyId)) throw new Error("Sem permissão de custo.");
      if (q.serial) {
        const s = findSerial(db, q.serial);
        if (!s || s.ownerCompanyId !== companyId) return [];
        return [{ productId: s.productId, serial: s.serial, cost: s.cost, provisional: s.costStatus === "provisorio" }];
      }
      return db.serials
        .filter((s) => s.productId === q.productId && s.ownerCompanyId === companyId && s.commercial === "disponivel")
        .map((s) => ({ productId: s.productId, serial: s.serial, cost: s.cost, provisional: s.costStatus === "provisorio" }));
    },
    async reserve(input) {
      const r = io.write((db) => reserveSerials(db, input, userId()));
      return { reservationId: r.id };
    },
    async handleEvent(event) {
      io.write((db) => {
      // Reprocessar não duplica: evento já processado é ignorado.
      const existing = db.events.find((e) => e.idempotencyKey === event.idempotencyKey);
      if (existing?.status === "processado") return;
      const ev: IntegrationEvent =
        existing ??
        (() => {
          const e: IntegrationEvent = {
            id: `evt_${db.events.length + 1}`,
            system: "crm",
            type: event.type,
            idempotencyKey: event.idempotencyKey,
            payload: event.payload,
            status: "recebido",
            attempts: 0,
            at: new Date().toISOString(),
          };
          db.events.push(e);
          return e;
        })();
      ev.attempts += 1;
      try {
        if (event.type === "opportunity.cancelled") {
          const r = db.reservations.find(
            (x) => x.crmOpportunityId === event.payload?.opportunityId && x.status === "reservada",
          );
          if (r) releaseReservation(db, r.id, userId(), "oportunidade cancelada");
        }
        ev.status = "processado";
        ev.error = undefined;
      } catch (e) {
        ev.status = "erro";
        ev.error = (e as Error).message;
      }
      });
    },
  };
}

/** Esboço da implementação real (desligada por configuração). */
export function createRealCrm(): CrmPort {
  const off = (): never => {
    throw new Error("Integração real com o CRM está desligada (VITE_INTEGRATION_CRM=mock).");
  };
  return { queryCost: off, reserve: off, handleEvent: off };
}

export function getCrm(io: DbIO, userId: () => string): CrmPort {
  return integrationMode("CRM") === "real" ? createRealCrm() : createMockCrm(io, userId);
}
