import {
  DomainError, atomic, audit, balance, findSerial, isAdmin, mustSerial, nextId, nowIso, normalizeCode,
  postMovement, requireAdmin, round2, updateSerial,
} from "./core";
import { addAssignedCost } from "./costing";
import { createInvoiceDraft, transmitInvoice } from "./fiscal";
import { eligibilityProblem, quarantineLocation } from "./sales";
import type { AssistCase, Chip, Contract, Db, Id, KitOrder, Link, LossRequest, Transfer, WorkOrder } from "./types";

// ---------- Transferências (G10 a G13) ----------

export interface NewTransfer {
  companyId: Id;
  kind: Transfer["kind"];
  fromLocationId: Id;
  toLocationId: Id;
  toCompanyId?: Id;
  serials: string[];
  transferValue?: Record<string, number>;
}

export function createTransfer(db: Db, input: NewTransfer, _by: string): Transfer {
  const from = db.locations.find((l) => l.id === input.fromLocationId);
  const to = db.locations.find((l) => l.id === input.toLocationId);
  if (!from || !to) throw new DomainError("local", "Origem e destino são obrigatórios.");
  if (input.kind === "entre_empresas" && (!input.toCompanyId || to.companyId !== input.toCompanyId)) {
    throw new DomainError("empresa_destino", "Destino deve ser local da empresa de destino.");
  }
  if (input.kind !== "entre_empresas" && (from.companyId !== to.companyId)) {
    throw new DomainError("empresa", "Entre empresas é operação fiscal própria: use o tipo 'entre empresas'.");
  }
  if (input.serials.length === 0) throw new DomainError("sem_series", "Leia ao menos uma série.");
  const codes = input.serials.map(normalizeCode);
  for (const c of codes) {
    const s = mustSerial(db, c);
    if (s.locationId !== input.fromLocationId) throw new DomainError("origem", `Série ${c} não está no local de origem.`);
    if (s.commercial === "reservado") throw new DomainError("reservada", `Série ${c} está reservada e bloqueada para transferência.`);
    if (s.commercial !== "disponivel") throw new DomainError("indisponivel", `Série ${c}: situação ${s.commercial}.`);
  }
  const t: Transfer = {
    id: nextId(db, "tra"),
    companyId: input.companyId,
    toCompanyId: input.toCompanyId,
    kind: input.kind,
    fromLocationId: input.fromLocationId,
    toLocationId: input.toLocationId,
    serials: codes,
    transferValue: input.transferValue ?? {},
    status: "rascunho",
    createdAt: nowIso(),
  };
  db.transfers.push(t);
  return t;
}

/** RN-013: valor de transferência editável por usuário autorizado, com autor e data. */
export function editTransferValue(db: Db, transferId: Id, serial: string, value: number, by: string) {
  const t = mustTransfer(db, transferId);
  if (t.status === "em_transito" || t.status === "recebida") throw new DomainError("estado", "Transferência já enviada.");
  if (!(value >= 0)) throw new DomainError("valor", "Valor inválido.");
  t.transferValue[normalizeCode(serial)] = value;
  audit(db, by, "transferencia.valor", t.id, t.companyId, `${serial}=${value}`);
}

export function mustTransfer(db: Db, id: Id): Transfer {
  const t = db.transfers.find((x) => x.id === id);
  if (!t) throw new DomainError("transferencia", "Transferência não encontrada.");
  return t;
}

export function transitLocation(db: Db, companyId: Id): Id {
  let l = db.locations.find((x) => x.companyId === companyId && x.type === "transito");
  if (!l) {
    l = { id: nextId(db, "loc"), companyId, name: "Em trânsito", type: "transito", responsible: "", active: true };
    db.locations.push(l);
  }
  return l.id;
}

export function reviewTransfer(db: Db, id: Id) {
  const t = mustTransfer(db, id);
  if (t.status !== "rascunho") throw new DomainError("estado", "Transferência já revisada.");
  t.status = "revisada";
}

/** Confirma a saída. Entre empresas exige nota autorizada (RN-015); entre locais depende do parâmetro. */
export function sendTransfer(db: Db, id: Id, by: string) {
  const t = mustTransfer(db, id);
  if (t.status !== "revisada") throw new DomainError("estado", "Revise a transferência antes de enviar.");
  const needsInvoice = t.kind === "entre_empresas" || (t.kind === "entre_locais" && db.params.transferSameCompanyNeedsInvoice);
  atomic(db, () => {
    if (needsInvoice) {
      const inv = createInvoiceDraft(db, {
        companyId: t.companyId, operation: "transferencia", idempotencyKey: `transf:${t.id}`,
        items: t.serials.map((c) => ({
          productId: mustSerial(db, c).productId, serial: c, qty: 1, unitValue: t.transferValue[c] ?? 0, cfop: "",
        })),
      }, by);
      transmitInvoice(db, inv.id, by);
      t.invoiceId = inv.id;
      if (db.invoices.find((i) => i.id === inv.id)!.status !== "autorizada") {
        throw new DomainError("rn015", "Nota não autorizada: a saída não baixa o estoque.");
      }
    }
    const transit = transitLocation(db, t.companyId);
    for (const c of t.serials) {
      const s = mustSerial(db, c);
      postMovement(db, {
        companyId: t.companyId, productId: s.productId, serialId: s.id, qty: 1, kind: "transferencia_saida",
        fromLocationId: t.fromLocationId, toLocationId: t.kind === "entre_empresas" ? null : transit,
        outcome: t.kind === "entre_empresas" ? "transferencia_externa" : undefined,
        refType: "transferencia", refId: t.id, idempotencyKey: `transf-saida:${t.id}:${c}`, by,
      });
      updateSerial(db, s, { locationId: t.kind === "entre_empresas" ? null : transit, commercial: "em_transito" }, by, t.id);
    }
    t.status = "em_transito";
    t.sentAt = nowIso();
  });
}

/** Saída não presume entrega: o recebimento lê as séries; faltantes viram divergência. */
export function receiveTransfer(db: Db, id: Id, scanned: string[], by: string) {
  const t = mustTransfer(db, id);
  if (t.status !== "em_transito") throw new DomainError("estado", "Transferência não está em trânsito.");
  const got = new Set(scanned.map(normalizeCode));
  const missing = t.serials.filter((s) => !got.has(s));
  const extra = [...got].filter((s) => !t.serials.includes(s));
  if (extra.length) throw new DomainError("fora_da_nota", `Série(s) fora da transferência: ${extra.join(", ")}.`);
  atomic(db, () => {
    for (const c of t.serials.filter((s) => got.has(s))) {
      const s = mustSerial(db, c);
      const destCompany = db.locations.find((l) => l.id === t.toLocationId)!.companyId;
      postMovement(db, {
        companyId: destCompany, productId: s.productId, serialId: s.id, qty: 1, kind: "transferencia_entrada",
        fromLocationId: t.kind === "entre_empresas" ? null : s.locationId, toLocationId: t.toLocationId,
        refType: "transferencia", refId: t.id, idempotencyKey: `transf-entrada:${t.id}:${c}`, by,
      });
      const dest = db.locations.find((l) => l.id === t.toLocationId)!;
      updateSerial(db, s, {
        locationId: t.toLocationId, commercial: "disponivel", custody: dest.responsible || dest.name,
        ...(t.kind === "entre_empresas" ? { ownerCompanyId: destCompany } : {}),
      }, by, t.id);
    }
    t.status = missing.length ? "divergente" : "recebida";
    t.receivedAt = nowIso();
  });
  return { missing };
}

export function overdueTransfers(db: Db, today = new Date()) {
  return db.transfers.filter(
    (t) => t.status === "em_transito" && t.sentAt && (today.getTime() - new Date(t.sentAt).getTime()) / 86400000 > db.params.transitDays,
  );
}

// ---------- Perdas e baixas (G14) ----------

export function requestLoss(
  db: Db, input: { companyId: Id; serials: string[]; reason: string; evidence: string }, by: string,
): LossRequest {
  if (!input.reason.trim()) throw new DomainError("motivo", "Informe o motivo da perda.");
  if (input.serials.length === 0) throw new DomainError("sem_series", "Informe as séries.");
  const codes = input.serials.map(normalizeCode);
  const value = round2(codes.reduce((a, c) => a + (mustSerial(db, c).cost ?? 0), 0));
  const l: LossRequest = {
    id: nextId(db, "per"), companyId: input.companyId, serials: codes, reason: input.reason,
    evidence: input.evidence, value, status: "pendente", requestedBy: by, createdAt: nowIso(),
  };
  db.losses.push(l);
  return l;
}

export function decideLoss(db: Db, lossId: Id, approve: boolean, by: string) {
  requireAdmin(db, by, "aprovar perdas");
  const l = db.losses.find((x) => x.id === lossId);
  if (!l) throw new DomainError("perda", "Solicitação não encontrada.");
  if (l.status !== "pendente") throw new DomainError("estado", "Solicitação já decidida.");
  if (l.requestedBy === by) throw new DomainError("auto_aprovacao", "Quem pede não aprova a própria perda.");
  atomic(db, () => {
    if (approve) {
      for (const c of l.serials) {
        const s = mustSerial(db, c);
        postMovement(db, {
          companyId: l.companyId, productId: s.productId, serialId: s.id, qty: 1, kind: "perda",
          fromLocationId: s.locationId, toLocationId: null, outcome: "perda", refType: "perda", refId: l.id,
          idempotencyKey: `perda:${l.id}:${c}`, reason: l.reason, by,
        });
        // O ativo não é apagado, muda de situação.
        updateSerial(db, s, { commercial: "perdido", technical: "descartado", locationId: null }, by, l.id);
      }
    }
    l.status = approve ? "aprovada" : "rejeitada";
    l.decidedBy = by;
  });
}

// ---------- Inventário (H04 a H06) ----------

export function startInventory(db: Db, companyId: Id, locationId: Id | undefined, scope: string) {
  const snapshot: Record<string, number> = {};
  for (const p of db.products) {
    const b = balance(db, companyId, p.id, locationId);
    if (b !== 0) snapshot[p.id] = b;
  }
  const inv = { id: nextId(db, "inv"), companyId, scope, locationId, snapshot, counted: [], status: "contando" as const, createdAt: nowIso() };
  db.inventories.push(inv);
  return inv;
}

export function countSerial(db: Db, invId: Id, code: string) {
  const inv = db.inventories.find((i) => i.id === invId);
  if (!inv || inv.status !== "contando") throw new DomainError("inventario", "Inventário não está em contagem.");
  const c = normalizeCode(code);
  if (!inv.counted.includes(c)) inv.counted.push(c);
  // Leitura não ajusta o saldo.
}

export function inventoryDiff(db: Db, invId: Id) {
  const inv = db.inventories.find((i) => i.id === invId)!;
  const expected = db.serials.filter(
    (s) => s.ownerCompanyId === inv.companyId && s.locationId && (!inv.locationId || s.locationId === inv.locationId),
  ).map((s) => s.serial);
  const missing = expected.filter((s) => !inv.counted.includes(s));
  const surplus = inv.counted.filter((s) => !expected.includes(s));
  return { missing, surplus };
}

export function finishCount(db: Db, invId: Id) {
  const inv = db.inventories.find((i) => i.id === invId)!;
  inv.status = "revisao";
}

/** Ajuste = movimento compensatório com motivo; aprovado por administrador; nunca muda dono. */
export function approveInventory(db: Db, invId: Id, reason: string, by: string) {
  requireAdmin(db, by, "aprovar ajustes de inventário");
  if (!reason.trim()) throw new DomainError("motivo", "Ajuste exige motivo.");
  const inv = db.inventories.find((i) => i.id === invId)!;
  if (inv.status !== "revisao") throw new DomainError("estado", "Finalize a contagem antes.");
  atomic(db, () => {
    const { missing } = inventoryDiff(db, invId);
    for (const c of missing) {
      const s = mustSerial(db, c);
      postMovement(db, {
        companyId: inv.companyId, productId: s.productId, serialId: s.id, qty: 1, kind: "ajuste",
        fromLocationId: s.locationId, toLocationId: null, outcome: "ajuste", refType: "inventario", refId: inv.id,
        idempotencyKey: `inv:${inv.id}:${c}`, reason, by,
      });
      updateSerial(db, s, { locationId: null, commercial: "perdido" }, by, inv.id);
    }
    inv.status = "ajustado";
  });
}

// ---------- Contratos / comodato ----------

export function createContract(
  db: Db, input: { companyId: Id; customerId: Id; start: string; end: string; monthlyFee: number; serials: string[] }, _by: string,
): Contract {
  if (!(input.monthlyFee > 0)) throw new DomainError("mensalidade", "Informe a mensalidade (tipo M).");
  const c: Contract = {
    id: nextId(db, "ctr"), companyId: input.companyId, number: `CTR-${String(db.contracts.length + 1).padStart(4, "0")}`,
    customerId: input.customerId, start: input.start, end: input.end, monthlyFee: input.monthlyFee,
    serials: input.serials.map(normalizeCode), status: "ativo", returned: [],
  };
  for (const s of c.serials) {
    const ser = mustSerial(db, s);
    const p = eligibilityProblem(db, ser, input.companyId);
    if (p) throw new DomainError("indisponivel", `Série ${s} indisponível: ${p}.`);
    const prod = db.products.find((x) => x.id === ser.productId);
    if (prod?.recordType !== "C") throw new DomainError("tipo", `Série ${s} não é produto imobilizado (C).`);
  }
  db.contracts.push(c);
  return c;
}

export function registerComodatoReturn(db: Db, contractId: Id, serials: string[], reason: string, by: string) {
  const c = db.contracts.find((x) => x.id === contractId);
  if (!c) throw new DomainError("contrato", "Contrato não encontrado.");
  const codes = serials.map(normalizeCode);
  for (const s of codes) if (!c.serials.includes(s)) throw new DomainError("fora_contrato", `Série ${s} não é deste contrato.`);
  atomic(db, () => {
    // Nunca libera para uso sem triagem: vai à quarentena.
    const q = quarantineLocation(db, c.companyId);
    for (const s of codes) {
      const ser = mustSerial(db, s);
      postMovement(db, {
        companyId: c.companyId, productId: ser.productId, serialId: ser.id, qty: 1, kind: "devolucao",
        fromLocationId: ser.locationId, toLocationId: q, refType: "comodato", refId: c.id,
        idempotencyKey: `retorno:${c.id}:${s}`, by,
      });
      updateSerial(db, ser, { locationId: q, technical: "quarentena", commercial: "disponivel", custody: "Quarentena" }, by, c.id);
      if (!c.returned.includes(s)) c.returned.push(s);
    }
    const r = {
      id: nextId(db, "dev"), companyId: c.companyId, origin: "comodato" as const, customerId: c.customerId,
      serials: codes, reason: reason || "Retorno de comodato", status: "triagem" as const, createdAt: nowIso(),
    };
    db.returns.push(r);
  });
}

// ---------- OS e assistência ----------

export function createWorkOrder(
  db: Db, input: Omit<WorkOrder, "id" | "number" | "status" | "createdAt" | "serialsOut" | "serialsIn" | "supplies" | "techPayment"> & { serialsIn?: string[] }, _by: string,
): WorkOrder {
  const svc = db.services.find((s) => s.id === input.serviceId);
  if (!svc) throw new DomainError("servico", "Escolha um serviço do catálogo.");
  if ((svc.kind === "retirada" || svc.kind === "troca") && !(input.serialsIn && input.serialsIn.length)) {
    throw new DomainError("serie_obrigatoria", "Série obrigatória em retirada e troca.");
  }
  const wo: WorkOrder = {
    ...input, id: nextId(db, "os"), number: `OS-${String(db.workOrders.length + 1).padStart(4, "0")}`,
    serialsOut: [], serialsIn: (input.serialsIn ?? []).map(normalizeCode), supplies: [], techPayment: null,
    status: "aberta", createdAt: nowIso(),
  };
  db.workOrders.push(wo);
  return wo;
}

export function mustWO(db: Db, id: Id): WorkOrder {
  const w = db.workOrders.find((x) => x.id === id);
  if (!w) throw new DomainError("os", "OS não encontrada.");
  return w;
}

export function sendMaterialsToWO(db: Db, woId: Id, serial: string) {
  const wo = mustWO(db, woId);
  const s = mustSerial(db, serial);
  const p = eligibilityProblem(db, s, wo.companyId, undefined);
  if (p && s.commercial !== "reservado") throw new DomainError("indisponivel", `Série ${s.serial}: ${p}.`);
  if (!wo.serialsOut.includes(s.serial)) wo.serialsOut.push(s.serial);
}

export function setWOCosts(
  db: Db, woId: Id, by: string,
  c: { charged?: number; techPayment?: number | null; zeroReason?: string; supplies?: WorkOrder["supplies"] },
) {
  if (!isAdmin(db, by) && !db.profiles.find((p) => p.id === by)?.canSeeCost) {
    throw new DomainError("sem_permissao_custo", "Sem permissão para lançar custos.");
  }
  const wo = mustWO(db, woId);
  if (c.charged !== undefined) wo.charged = c.charged;
  if (c.techPayment !== undefined) wo.techPayment = c.techPayment;
  if (c.zeroReason !== undefined) wo.techPaymentZeroReason = c.zeroReason;
  if (c.supplies) wo.supplies = c.supplies;
}

/** Finaliza numa única operação: pendência impede; sem saída sem desfecho (RN-011). */
export function finalizeWorkOrder(db: Db, woId: Id, by: string) {
  const wo = mustWO(db, woId);
  if (wo.status === "finalizada") return wo;
  atomic(db, () => {
    if (wo.techPayment === null) throw new DomainError("custos_os", "Lance os custos da OS (J23) antes de finalizar.");
    if (wo.techPayment === 0 && !wo.techPaymentZeroReason?.trim()) {
      throw new DomainError("custos_os", "Pagamento ao técnico igual a zero exige motivo.");
    }
    const svc = db.services.find((s) => s.id === wo.serviceId)!;
    if ((svc.kind === "retirada" || svc.kind === "troca") && wo.serialsIn.length === 0) {
      throw new DomainError("serie_obrigatoria", "Pendência: série retirada não registrada.");
    }
    const customer = db.customers.find((c) => c.id === wo.customerId);
    for (const c of wo.serialsOut) {
      const s = mustSerial(db, c);
      updateSerial(db, s, { custody: customer?.name ?? "Cliente", commercial: wo.origin === "comodato" ? "comodato" : "vendido" }, by, wo.id);
    }
    const q = quarantineLocation(db, wo.companyId);
    for (const c of wo.serialsIn) {
      const s = mustSerial(db, c);
      postMovement(db, {
        companyId: wo.companyId, productId: s.productId, serialId: s.id, qty: 1, kind: "devolucao",
        fromLocationId: s.locationId && s.locationId !== q ? s.locationId : null, toLocationId: q,
        refType: "os", refId: wo.id, idempotencyKey: `os-retirada:${wo.id}:${c}`, by,
      });
      updateSerial(db, s, { locationId: q, technical: "quarentena", commercial: "disponivel", custody: "Quarentena" }, by, wo.id);
    }
    const dep = db.locations.find((l) => l.companyId === wo.companyId && l.type === "deposito");
    wo.supplies.forEach((su, i) => {
      if (su.fromStock && su.productId && dep) {
        if (balance(db, wo.companyId, su.productId, dep.id) < su.qty) {
          throw new DomainError("saldo", "Saldo insuficiente do insumo no depósito.");
        }
        postMovement(db, {
          companyId: wo.companyId, productId: su.productId, qty: su.qty, kind: "consumo_os",
          fromLocationId: dep.id, toLocationId: null, outcome: "consumo_os", refType: "os", refId: wo.id,
          idempotencyKey: `os-insumo:${wo.id}:${i}`, by,
        });
      }
    });
    wo.status = "finalizada";
    audit(db, by, "os.finalizada", wo.id, wo.companyId);
  });
  return wo;
}

export function openAssist(db: Db, input: { companyId: Id; serial: string; defect: string }, by: string): AssistCase {
  if (!input.defect.trim()) throw new DomainError("defeito", "Descreva o defeito.");
  const s = mustSerial(db, input.serial);
  const prod = db.products.find((p) => p.id === s.productId);
  const saleDate = db.outbounds.find((o) => o.serials.includes(s.serial) && (o.status === "nota_autorizada" || o.status === "enviada"))?.createdAt ?? s.createdAt;
  const until = new Date(saleDate);
  until.setMonth(until.getMonth() + (prod?.warrantyMonths ?? 0));
  const q = quarantineLocation(db, input.companyId);
  const c: AssistCase = {
    id: nextId(db, "ast"), companyId: input.companyId, serial: s.serial, defect: input.defect,
    warrantyUntil: prod?.warrantyMonths ? until.toISOString().slice(0, 10) : null,
    status: "triagem", repairCost: 0, createdAt: nowIso(),
  };
  // Item fica em quarentena (não aparece como disponível)
  updateSerial(db, s, { technical: "defeito", ...(s.commercial === "disponivel" ? { locationId: q } : {}) }, by, c.id);
  db.assists.push(c);
  return c;
}

export function closeAssistRepair(db: Db, assistId: Id, cost: number, by: string) {
  const a = db.assists.find((x) => x.id === assistId);
  if (!a) throw new DomainError("assistencia", "Chamado não encontrado.");
  atomic(db, () => {
    a.repairCost = cost;
    addAssignedCost(db, a.serial, cost, `assistencia:${a.id}`, by); // RN-016
    a.status = "encerrado";
  });
}

// ---------- Kits ----------

export function startKitOrder(db: Db, input: { companyId: Id; kitProductId: Id; qty: number }): KitOrder {
  const kit = db.products.find((p) => p.id === input.kitProductId);
  if (!kit || kit.klass !== "kit" || kit.kitComponents.length === 0) throw new DomainError("kit", "Produto não é um kit com componentes.");
  const dep = db.locations.find((l) => l.companyId === input.companyId && l.type === "deposito");
  for (const comp of kit.kitComponents) {
    const have = dep ? balance(db, input.companyId, comp.productId, dep.id) : 0;
    if (have < comp.qty * input.qty) throw new DomainError("componente", "Componente indisponível: não é possível iniciar.");
  }
  const o: KitOrder = { id: nextId(db, "kit"), companyId: input.companyId, kitProductId: input.kitProductId, qty: input.qty, status: "em_montagem", built: [] };
  db.kitOrders.push(o);
  return o;
}

/** Consome componentes lidos e cria o item do kit com custo somado. */
export function buildKitUnit(db: Db, orderId: Id, kitSerial: string, componentSerials: string[], by: string) {
  const o = db.kitOrders.find((x) => x.id === orderId);
  if (!o) throw new DomainError("ordem", "Ordem não encontrada.");
  atomic(db, () => {
    const kit = db.products.find((p) => p.id === o.kitProductId)!;
    const dep = db.locations.find((l) => l.companyId === o.companyId && l.type === "deposito")!;
    let cost = 0;
    for (const c of componentSerials) {
      const s = mustSerial(db, c);
      const p = eligibilityProblem(db, s, o.companyId);
      if (p) throw new DomainError("indisponivel", `Componente ${c}: ${p}.`);
      cost += s.cost ?? 0;
      postMovement(db, {
        companyId: o.companyId, productId: s.productId, serialId: s.id, qty: 1, kind: "consumo_os",
        fromLocationId: s.locationId, toLocationId: null, outcome: "consumo_os", refType: "kit", refId: o.id,
        idempotencyKey: `kit-comp:${o.id}:${c}`, by,
      });
      updateSerial(db, s, { locationId: null, commercial: "baixado" }, by, o.id);
    }
    const code = normalizeCode(kitSerial);
    if (findSerial(db, code)) throw new DomainError("serie_duplicada", "Série do kit já existe.");
    const total = round2(cost);
    db.serials.push({
      id: nextId(db, "ser"), serial: code, productId: kit.id, ownerCompanyId: o.companyId, locationId: dep.id,
      custody: dep.name, commercial: "disponivel", technical: "novo", cost: total, purchasePrice: total,
      allocatedCost: 0, assignedCost: 0, costStatus: "definitivo", createdAt: nowIso(),
    });
    const ks = findSerial(db, code)!;
    postMovement(db, {
      companyId: o.companyId, productId: kit.id, serialId: ks.id, qty: 1, kind: "entrada",
      fromLocationId: null, toLocationId: dep.id, refType: "kit", refId: o.id, idempotencyKey: `kit-novo:${o.id}:${code}`, by,
    });
    o.built.push(code);
    if (o.built.length >= o.qty) o.status = "concluida";
  });
}

// ---------- Chips e vínculos ----------

const ICCID_RE = /^\d{19,20}$/;

export function addChips(db: Db, companyId: Id, rows: { iccid: string; operator: string; plan: string; cost: number; holder?: Chip["holder"] }[]) {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const id = r.iccid.replace(/\s/g, "");
    if (!ICCID_RE.test(id)) errors.push(`ICCID inválido: ${r.iccid}`);
    else if (seen.has(id) || db.chips.some((c) => c.iccid === id)) errors.push(`ICCID duplicado: ${id}`);
    seen.add(id);
  }
  if (errors.length) throw new DomainError("chips", errors.join("; "));
  for (const r of rows) {
    db.chips.push({
      id: nextId(db, "chip"), companyId, iccid: r.iccid.replace(/\s/g, ""), operator: r.operator, plan: r.plan,
      holder: r.holder ?? "ali_sat", status: "livre", cost: r.cost,
    });
  }
}

export function createLink(db: Db, companyId: Id, l: Omit<Link, "id" | "companyId" | "from" | "to">, by: string) {
  return atomic(db, () => {
    if (l.externalId && db.links.some((x) => x.to === null && x.externalId === l.externalId && x.serial !== normalizeCode(l.serial))) {
      throw new DomainError("id_externo", "ID externo em conflito com outro vínculo ativo.");
    }
    const serial = normalizeCode(l.serial);
    mustSerial(db, serial);
    for (const old of db.links.filter((x) => x.to === null && x.serial === serial)) old.to = nowIso();
    if (l.iccid) {
      const chip = db.chips.find((c) => c.iccid === l.iccid);
      if (!chip) throw new DomainError("chip", "ICCID não cadastrado.");
      if (db.links.some((x) => x.to === null && x.iccid === l.iccid && x.serial !== serial)) {
        throw new DomainError("chip_em_uso", "Chip já vinculado a outro equipamento.");
      }
      chip.status = "vinculado";
    }
    const link: Link = { id: nextId(db, "lnk"), companyId, ...l, serial, from: nowIso(), to: null };
    db.links.push(link);
    audit(db, by, "vinculo.criado", link.id, companyId);
    return link;
  });
}
