import {
  DomainError,
  atomic,
  audit,
  findSerial,
  idempotent,
  nextId,
  nowIso,
  normalizeCode,
  postMovement,
  mustSerial,
  updateSerial,
} from "./core";
import { createInvoiceDraft, customerFiscalComplete, transmitInvoice, type TransmitOptions } from "./fiscal";
import type { Db, Id, Outbound, OutboundKind, Reservation, Serial } from "./types";

// ---------- Elegibilidade ----------

export function eligibilityProblem(db: Db, s: Serial, companyId: Id, allowReservation?: Id): string | null {
  if (s.ownerCompanyId !== companyId) return "pertence a outra empresa";
  const loc = db.locations.find((l) => l.id === s.locationId);
  if (!loc) return "não está em estoque";
  if (loc.type !== "deposito") return `está em local ${loc.type}`;
  if (s.technical === "quarentena" || s.technical === "defeito" || s.technical === "reparo" || s.technical === "descartado") {
    return "em quarentena ou com defeito";
  }
  if (s.commercial === "reservado") {
    if (!allowReservation || s.reservationId !== allowReservation) return "reservada para outra operação";
    return null;
  }
  if (s.commercial !== "disponivel") return `situação ${s.commercial}`;
  return null;
}

// ---------- Reservas (RN-018: por série específica) ----------

export interface ReserveInput {
  companyId: Id;
  customerId?: Id;
  crmOpportunityId?: string;
  idempotencyKey: string;
  serials: string[];
}

export function reserveSerials(db: Db, input: ReserveInput, by: string): Reservation {
  return idempotent(db, `reserva:${input.idempotencyKey}`, () => {
    if (!input.serials || input.serials.length === 0) {
      throw new DomainError("rn018", "RN-018: a reserva é por série específica; informe as séries.");
    }
    const codes = input.serials.map(normalizeCode);
    if (new Set(codes).size !== codes.length) throw new DomainError("duplicada", "Série repetida na reserva.");
    const res: Reservation = {
      id: nextId(db, "res"),
      companyId: input.companyId,
      customerId: input.customerId,
      crmOpportunityId: input.crmOpportunityId,
      idempotencyKey: input.idempotencyKey,
      serials: codes,
      status: "reservada",
      createdAt: nowIso(),
    };
    for (const c of codes) {
      const s = mustSerial(db, c);
      const problem = eligibilityProblem(db, s, input.companyId);
      if (problem) throw new DomainError("indisponivel", `Série ${c} indisponível: ${problem}.`);
      updateSerial(db, s, { commercial: "reservado" }, by, res.id);
      s.reservationId = res.id;
    }
    db.reservations.push(res);
    audit(db, by, "reserva.criada", res.id, res.companyId);
    return res;
  });
}

export function releaseReservation(db: Db, reservationId: Id, by: string, reason = "liberada") {
  const res = db.reservations.find((r) => r.id === reservationId);
  if (!res) throw new DomainError("reserva", "Reserva não encontrada.");
  if (res.status !== "reservada") return res;
  atomic(db, () => {
    for (const c of res.serials) {
      const s = findSerial(db, c);
      if (s && s.reservationId === res.id) {
        updateSerial(db, s, { commercial: "disponivel" }, by, `${res.id}:${reason}`);
        s.reservationId = undefined;
      }
    }
    res.status = "liberada";
  });
  return res;
}

// ---------- Saídas ----------

export interface NewOutbound {
  companyId: Id;
  kind: OutboundKind;
  customerId?: Id;
  contractId?: Id;
  workOrderId?: Id;
  reservationId?: Id;
  taxTypeId?: Id;
}

export function createOutbound(db: Db, input: NewOutbound, _by: string): Outbound {
  if (input.kind === "venda" || input.kind === "comodato") {
    const missing = customerFiscalComplete(db.customers.find((c) => c.id === input.customerId));
    if (missing.length) {
      throw new DomainError("cliente_incompleto", `Cadastro fiscal do cliente incompleto: ${missing.join(", ")}.`);
    }
  }
  const o: Outbound = {
    id: nextId(db, "sai"),
    companyId: input.companyId,
    number: `SAI-${String(db.outbounds.length + 1).padStart(4, "0")}`,
    kind: input.kind,
    customerId: input.customerId,
    contractId: input.contractId,
    workOrderId: input.workOrderId,
    reservationRef: input.reservationId,
    serials: [],
    unitValue: {},
    taxTypeId: input.taxTypeId,
    status: "rascunho",
    createdAt: nowIso(),
  };
  db.outbounds.push(o);
  return o;
}

export function mustOutbound(db: Db, id: Id): Outbound {
  const o = db.outbounds.find((x) => x.id === id);
  if (!o) throw new DomainError("saida", "Saída não encontrada.");
  return o;
}

export function addOutboundSerial(db: Db, outboundId: Id, code: string, unitValue = 0) {
  const o = mustOutbound(db, outboundId);
  if (o.status !== "rascunho" && o.status !== "separada") throw new DomainError("estado", "Saída já avançou.");
  const s = mustSerial(db, code);
  if (o.serials.includes(s.serial)) throw new DomainError("repetida", "Série já está nesta saída.");
  const problem = eligibilityProblem(db, s, o.companyId, o.reservationRef);
  if (problem) throw new DomainError("indisponivel", `Série ${s.serial} recusada: ${problem}.`);
  o.serials.push(s.serial);
  o.unitValue[s.serial] = unitValue;
}

export function removeOutboundSerial(db: Db, outboundId: Id, code: string) {
  const o = mustOutbound(db, outboundId);
  o.serials = o.serials.filter((s) => s !== normalizeCode(code));
  delete o.unitValue[normalizeCode(code)];
}

export function reviewOutbound(db: Db, outboundId: Id) {
  const o = mustOutbound(db, outboundId);
  if (o.serials.length === 0) throw new DomainError("vazia", "Nenhuma série separada.");
  o.status = "separada";
}

const OP_BY_KIND: Record<OutboundKind, "venda" | "comodato" | "remessa" | "perda" | "transferencia" | "devolucao"> = {
  venda: "venda",
  comodato: "comodato",
  transferencia: "transferencia",
  perda: "perda",
  os: "remessa",
  devolucao_fornecedor: "devolucao",
};

/** Segue para a nota (K02). Saída fica "aguardando nota" e NÃO baixa estoque (RN-015). */
export function requestOutboundInvoice(db: Db, outboundId: Id, by: string) {
  const o = mustOutbound(db, outboundId);
  if (o.status === "nota_autorizada" || o.status === "enviada") return db.invoices.find((i) => i.id === o.invoiceId)!;
  if (o.status !== "separada" && o.status !== "aguardando_nota") throw new DomainError("estado", "Revise a saída antes da nota.");
  const inv = createInvoiceDraft(
    db,
    {
      companyId: o.companyId,
      operation: OP_BY_KIND[o.kind],
      customerId: o.customerId,
      outboundId: o.id,
      taxTypeId: o.taxTypeId,
      idempotencyKey: `saida:${o.id}`,
      items: o.serials.map((s) => ({
        productId: findSerial(db, s)!.productId,
        serial: s,
        qty: 1,
        unitValue: o.unitValue[s] ?? 0,
        cfop: db.taxTypes.find((t) => t.id === o.taxTypeId)?.cfop ?? "",
      })),
    },
    by,
  );
  o.invoiceId = inv.id;
  o.status = "aguardando_nota";
  return inv;
}

/** Transmite a nota; só com nota autorizada o estoque baixa (RN-015). Idempotente. */
export function transmitOutboundInvoice(db: Db, outboundId: Id, by: string, opts: TransmitOptions = {}) {
  const o = mustOutbound(db, outboundId);
  if (!o.invoiceId) throw new DomainError("sem_nota", "Gere a nota antes de transmitir.");
  return idempotent(db, `baixa-saida:${o.id}:${opts.simulateFailure ?? "ok"}:${o.status}`, () => {
    const inv = transmitInvoice(db, o.invoiceId!, by, opts);
    if (inv.status !== "autorizada") return inv;
    if (o.status === "nota_autorizada" || o.status === "enviada") return inv;
    applyOutboundStock(db, o, by);
    o.status = "nota_autorizada";
    return inv;
  });
}

function customerLocation(db: Db, companyId: Id, customerId: Id): Id {
  const c = db.customers.find((x) => x.id === customerId)!;
  let loc = db.locations.find((l) => l.companyId === companyId && l.type === "cliente" && l.name === c.name);
  if (!loc) {
    loc = { id: nextId(db, "loc"), companyId, name: c.name, type: "cliente", responsible: c.name, active: true };
    db.locations.push(loc);
  }
  return loc.id;
}

function applyOutboundStock(db: Db, o: Outbound, by: string) {
  const inv = db.invoices.find((i) => i.id === o.invoiceId);
  if (!inv || inv.status !== "autorizada") {
    throw new DomainError("rn015", "RN-015: o estoque só baixa com nota autorizada.");
  }
  const customer = db.customers.find((c) => c.id === o.customerId);
  for (const code of o.serials) {
    const s = mustSerial(db, code);
    const fromLoc = s.locationId;
    if (o.kind === "venda") {
      postMovement(db, {
        companyId: o.companyId, productId: s.productId, serialId: s.id, qty: 1, kind: "saida",
        fromLocationId: fromLoc, toLocationId: null, outcome: "venda", refType: "saida", refId: o.id,
        idempotencyKey: `saida:${o.id}:${s.serial}`, by,
      });
      updateSerial(db, s, { commercial: "vendido", locationId: null, custody: customer?.name ?? "Cliente" }, by, o.id);
    } else if (o.kind === "comodato") {
      const dest = customerLocation(db, o.companyId, o.customerId!);
      postMovement(db, {
        companyId: o.companyId, productId: s.productId, serialId: s.id, qty: 1, kind: "saida",
        fromLocationId: fromLoc, toLocationId: dest, outcome: "comodato", refType: "saida", refId: o.id,
        idempotencyKey: `saida:${o.id}:${s.serial}`, by,
      });
      updateSerial(db, s, { commercial: "comodato", locationId: dest, custody: customer?.name ?? "Cliente" }, by, o.id);
    } else {
      postMovement(db, {
        companyId: o.companyId, productId: s.productId, serialId: s.id, qty: 1, kind: "saida",
        fromLocationId: fromLoc, toLocationId: null, outcome: o.kind === "devolucao_fornecedor" ? "devolucao_fornecedor" : "venda",
        refType: "saida", refId: o.id, idempotencyKey: `saida:${o.id}:${s.serial}`, by,
      });
      updateSerial(db, s, { commercial: "baixado", locationId: null }, by, o.id);
    }
    if (s.reservationId) {
      const r = db.reservations.find((x) => x.id === s.reservationId);
      if (r) r.status = "consumida";
      s.reservationId = undefined;
    }
  }
  audit(db, by, "saida.baixa", o.id, o.companyId, `${o.serials.length} séries`);
}

/** O envio só é registrado depois da nota autorizada. */
export function registerShipping(db: Db, outboundId: Id, carrier: string, tracking: string) {
  const o = mustOutbound(db, outboundId);
  if (o.status !== "nota_autorizada") {
    throw new DomainError("rn015", "Saída aguardando nota: o envio só é registrado depois da nota autorizada.");
  }
  if (!carrier.trim()) throw new DomainError("transportadora", "Informe a transportadora.");
  o.shipping = { carrier, tracking };
  o.status = "enviada";
}

/** Cancelar nota que baixou estoque estorna a saída. */
export function cancelOutboundAfterInvoiceCancel(db: Db, outboundId: Id, by: string) {
  const o = mustOutbound(db, outboundId);
  atomic(db, () => {
    for (const code of o.serials) {
      const s = mustSerial(db, code);
      const mov = db.movements.find((m) => m.idempotencyKey === `saida:${o.id}:${s.serial}`);
      if (!mov) continue;
      postMovement(db, {
        companyId: mov.companyId, productId: mov.productId, serialId: mov.serialId, qty: 1, kind: "estorno",
        fromLocationId: mov.toLocationId, toLocationId: mov.fromLocationId,
        outcome: mov.toLocationId ? undefined : undefined,
        refType: "saida", refId: o.id, idempotencyKey: `estorno:${mov.id}`, reason: "Nota cancelada", by, reversalOf: mov.id,
      });
      updateSerial(db, s, { commercial: "disponivel", locationId: mov.fromLocationId }, by, `estorno:${o.id}`);
    }
    o.status = "cancelada";
  });
}

// ---------- Devoluções (sempre pela quarentena) ----------

export function quarantineLocation(db: Db, companyId: Id): Id {
  let q = db.locations.find((l) => l.companyId === companyId && l.type === "quarentena");
  if (!q) {
    q = { id: nextId(db, "loc"), companyId, name: "Quarentena", type: "quarentena", responsible: "", active: true };
    db.locations.push(q);
  }
  return q.id;
}

export function createReturn(
  db: Db,
  input: { companyId: Id; origin: "cliente" | "comodato" | "fornecedor"; customerId?: Id; serials: string[]; reason: string },
  by: string,
) {
  return atomic(db, () => {
    if (!input.reason.trim()) throw new DomainError("motivo", "Informe o motivo da devolução.");
    if (input.serials.length === 0) throw new DomainError("sem_series", "Leia ao menos uma série.");
    const quarantine = quarantineLocation(db, input.companyId);
    const codes = input.serials.map(normalizeCode);
    for (const c of codes) {
      const s = mustSerial(db, c);
      if (input.origin !== "fornecedor") {
        const left = db.outbounds.some(
          (o) => o.customerId === input.customerId && o.serials.includes(c) && (o.status === "nota_autorizada" || o.status === "enviada"),
        );
        if (!left) throw new DomainError("serie_nao_saiu", `Série ${c} não saiu para este cliente.`);
      }
      postMovement(db, {
        companyId: input.companyId, productId: s.productId, serialId: s.id, qty: 1, kind: "devolucao",
        fromLocationId: s.locationId && s.locationId !== quarantine ? s.locationId : null, toLocationId: quarantine,
        outcome: undefined, refType: "devolucao", refId: c,
        idempotencyKey: `devolucao:${c}:${db.returns.length}`, by,
      });
      updateSerial(db, s, { locationId: quarantine, commercial: "disponivel", technical: "quarentena", custody: "Quarentena" }, by, "devolucao");
    }
    const r = {
      id: nextId(db, "dev"), companyId: input.companyId, origin: input.origin, customerId: input.customerId,
      serials: codes, reason: input.reason, status: "triagem" as const, createdAt: nowIso(),
    };
    db.returns.push(r);
    return r;
  });
}

export function triageReturn(
  db: Db, returnId: Id, decision: "liberar" | "assistencia" | "baixa", by: string, depositId?: Id,
) {
  const r = db.returns.find((x) => x.id === returnId);
  if (!r) throw new DomainError("devolucao", "Devolução não encontrada.");
  if (r.status !== "triagem") throw new DomainError("estado", "Triagem já concluída.");
  atomic(db, () => {
    for (const c of r.serials) {
      const s = mustSerial(db, c);
      if (decision === "liberar") {
        const dep = depositId ?? db.locations.find((l) => l.companyId === r.companyId && l.type === "deposito")?.id;
        if (!dep) throw new DomainError("deposito", "Sem depósito para liberar.");
        postMovement(db, {
          companyId: r.companyId, productId: s.productId, serialId: s.id, qty: 1, kind: "transferencia_saida",
          fromLocationId: s.locationId, toLocationId: dep, refType: "triagem", refId: r.id,
          idempotencyKey: `triagem:${r.id}:${c}`, by,
        });
        updateSerial(db, s, { locationId: dep, technical: "bom", commercial: "disponivel", custody: "Depósito" }, by, r.id);
      } else if (decision === "assistencia") {
        updateSerial(db, s, { technical: "defeito" }, by, r.id);
      }
    }
    r.status = decision === "liberar" ? "liberada" : decision === "assistencia" ? "assistencia" : "baixa";
  });
}

export function outboundFinalized(o: Outbound) {
  return o.status === "nota_autorizada" || o.status === "enviada";
}

export { findSerial };
