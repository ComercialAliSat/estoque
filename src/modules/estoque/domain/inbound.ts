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
  requireAdmin,
  round2,
  updateSerial,
} from "./core";
import type { Db, Id, Inbound, InboundItem, Serial } from "./types";

export function validateNfeKey(key: string): boolean {
  return /^\d{44}$/.test(key.replace(/\s/g, ""));
}

export interface NewInbound {
  companyId: Id;
  supplierId: Id;
  nfeKey: string;
  destLocationId: Id;
  orderId?: Id;
  importId?: Id;
  currency?: string;
  fx?: number;
  items: { productId: Id; qty: number; unitPrice: number | null; weight?: number }[];
}

export function createInbound(db: Db, input: NewInbound, by: string): Inbound {
  const key = input.nfeKey.replace(/\s/g, "");
  if (!validateNfeKey(key)) throw new DomainError("chave_invalida", "Chave de NF-e deve ter 44 dígitos.");
  if (db.inbounds.some((i) => i.nfeKey === key && i.status !== "estornada")) {
    throw new DomainError("chave_duplicada", "Esta chave de NF-e já foi lançada.");
  }
  if (input.items.length === 0) throw new DomainError("sem_itens", "Informe ao menos um item.");
  if (input.currency && input.currency !== "BRL" && !(input.fx && input.fx > 0)) {
    throw new DomainError("cambio", "Compra em moeda estrangeira exige câmbio.");
  }
  const loc = db.locations.find((l) => l.id === input.destLocationId);
  if (!loc || loc.companyId !== input.companyId) {
    throw new DomainError("local_invalido", "Local de destino não pertence à empresa.");
  }
  const items: InboundItem[] = input.items.map((it) => {
    return {
      id: nextId(db, "lot"),
      productId: it.productId,
      qty: it.qty,
      unitPrice: it.unitPrice,
      weight: it.weight ?? 0,
      allocated: 0,
    };
  });
  const inbound: Inbound = {
    id: nextId(db, "ent"),
    companyId: input.companyId,
    number: `ENT-${String(db.inbounds.length + 1).padStart(4, "0")}`,
    supplierId: input.supplierId,
    nfeKey: key,
    orderId: input.orderId,
    importId: input.importId,
    destLocationId: input.destLocationId,
    currency: input.currency ?? "BRL",
    fx: input.fx ?? 1,
    status: "rascunho",
    fiscalStatus: "nao_verificada",
    items,
    scans: [],
    divergences: [],
    createdAt: nowIso(),
  };
  db.inbounds.push(inbound);
  audit(db, by, "entrada.criada", inbound.id, inbound.companyId);
  return inbound;
}

export function startConference(db: Db, inboundId: Id, by: string) {
  const inb = mustInbound(db, inboundId);
  if (inb.status === "fechada" || inb.status === "estornada") {
    throw new DomainError("estado", "Entrada já fechada.");
  }
  if (inb.conferenceBy && inb.conferenceBy !== by) {
    throw new DomainError("conflito", "Outra pessoa já está conferindo esta entrada. Abra somente para ver.");
  }
  if (inb.items.some((i) => i.unitPrice === null || !(i.unitPrice >= 0))) {
    throw new DomainError("preco", "Preço de compra obrigatório em todo item antes de conferir.");
  }
  inb.conferenceBy = by;
  inb.status = "em_conferencia";
}

export function mustInbound(db: Db, id: Id): Inbound {
  const i = db.inbounds.find((x) => x.id === id);
  if (!i) throw new DomainError("entrada_inexistente", "Entrada não encontrada.");
  return i;
}

/** Lê uma série na conferência. Repetida ou já existente (outra nota) é recusada. */
export function scanSerial(
  db: Db,
  inboundId: Id,
  rawSerial: string,
  itemId: Id,
  by: string,
  opts: { manual?: boolean; reason?: string } = {},
) {
  const inb = mustInbound(db, inboundId);
  if (inb.status === "fechada" || inb.status === "estornada") {
    throw new DomainError("estado", "Entrada já fechada.");
  }
  const serial = normalizeCode(rawSerial);
  if (!serial) throw new DomainError("serie_vazia", "Leitura vazia.");
  if (opts.manual && !opts.reason?.trim()) {
    throw new DomainError("motivo", "Digitar série à mão exige motivo.");
  }
  const item = inb.items.find((i) => i.id === itemId);
  if (!item) throw new DomainError("item", "Item da nota não encontrado.");
  if (inb.scans.some((s) => s.serial === serial)) {
    throw new DomainError("serie_repetida", `Série ${serial} já foi lida nesta nota.`);
  }
  if (db.serials.some((s) => s.serial === serial) || otherInboundHasScan(db, inb, serial)) {
    throw new DomainError("serie_outra_nota", `Série ${serial} já existe ou pertence a outra nota.`);
  }
  if (inb.scans.filter((s) => s.itemId === itemId).length >= item.qty) {
    throw new DomainError("excesso", "Quantidade lida passa do item da nota (registre divergência).");
  }
  // Padrão do lote: preço da nota
  inb.scans.push({
    serial,
    itemId,
    manual: !!opts.manual,
    reason: opts.reason,
    price: item.unitPrice,
    at: nowIso(),
  });
  if (inb.conferenceBy === undefined) inb.conferenceBy = by;
}

function otherInboundHasScan(db: Db, inb: Inbound, serial: string) {
  return db.inbounds.some(
    (o) => o.id !== inb.id && o.status !== "estornada" && o.scans.some((s) => s.serial === serial),
  );
}

export function undoScan(db: Db, inboundId: Id, serial: string) {
  const inb = mustInbound(db, inboundId);
  if (inb.status === "fechada") throw new DomainError("estado", "Entrada já fechada.");
  inb.scans = inb.scans.filter((s) => s.serial !== normalizeCode(serial));
}

/** Edita o preço do lote: recalcula só as séries que não foram alteradas à mão. */
export function setLotPrice(db: Db, inboundId: Id, itemId: Id, price: number, by: string) {
  requireAdmin(db, by, "editar custos");
  const inb = mustInbound(db, inboundId);
  if (inb.status === "fechada") {
    throw new DomainError("fechada", "Entrada fechada: use ajuste de custo com motivo.");
  }
  if (!(price >= 0)) throw new DomainError("preco", "Preço inválido.");
  const item = inb.items.find((i) => i.id === itemId);
  if (!item) throw new DomainError("item", "Item não encontrado.");
  for (const sc of inb.scans) {
    if (sc.itemId === itemId && !sc.priceChangedBy) sc.price = price;
  }
  item.unitPrice = price;
}

export function setSerialPrice(
  db: Db,
  inboundId: Id,
  serial: string,
  price: number | null,
  reason: string,
  by: string,
) {
  requireAdmin(db, by, "editar custos");
  const inb = mustInbound(db, inboundId);
  if (inb.status === "fechada") {
    throw new DomainError("fechada", "Entrada fechada: use ajuste de custo com motivo.");
  }
  if (!reason.trim()) throw new DomainError("motivo", "Alterar preço de uma série exige motivo.");
  if (price !== null && !(price >= 0)) throw new DomainError("preco", "Preço inválido.");
  const sc = inb.scans.find((s) => s.serial === normalizeCode(serial));
  if (!sc) throw new DomainError("serie", "Série não lida nesta nota.");
  sc.price = price;
  sc.priceChangedBy = by;
  sc.priceReason = reason;
}

/** Importação de planilha série+preço: valida tudo antes; nada grava se houver erro (prévia). */
export function previewPriceSheet(db: Db, inboundId: Id, rows: { serial: string; price: number }[]) {
  const inb = mustInbound(db, inboundId);
  const errors: { line: number; message: string }[] = [];
  rows.forEach((r, i) => {
    if (!inb.scans.some((s) => s.serial === normalizeCode(r.serial))) {
      errors.push({ line: i + 1, message: `Série ${r.serial} não lida nesta nota.` });
    }
    if (!(r.price >= 0) || Number.isNaN(r.price)) errors.push({ line: i + 1, message: "Preço inválido." });
  });
  return { ok: errors.length === 0, errors, count: rows.length };
}

export function applyPriceSheet(
  db: Db,
  inboundId: Id,
  rows: { serial: string; price: number }[],
  by: string,
) {
  const pv = previewPriceSheet(db, inboundId, rows);
  if (!pv.ok) throw new DomainError("planilha", "Planilha com erros: corrija e envie de novo.");
  atomic(db, () => {
    for (const r of rows) setSerialPrice(db, inboundId, r.serial, r.price, "Importação de planilha", by);
  });
}

export function requestDivergence(
  db: Db,
  inboundId: Id,
  d: { kind: "falta" | "excesso" | "item_errado" | "avaria"; itemId?: Id; qty: number; reason: string },
  by: string,
) {
  const inb = mustInbound(db, inboundId);
  if (!d.reason.trim()) throw new DomainError("motivo", "Divergência exige motivo.");
  inb.divergences.push({ id: nextId(db, "div"), ...d, status: "pendente", requestedBy: by });
  inb.status = "divergente";
}

export function decideDivergence(db: Db, inboundId: Id, divId: Id, approve: boolean, by: string) {
  requireAdmin(db, by, "aprovar divergências");
  const inb = mustInbound(db, inboundId);
  const d = inb.divergences.find((x) => x.id === divId);
  if (!d) throw new DomainError("div", "Divergência não encontrada.");
  if (d.requestedBy === by) throw new DomainError("auto_aprovacao", "Quem pede não aprova a própria divergência.");
  d.status = approve ? "aprovada" : "rejeitada";
  d.approvedBy = by;
  if (inb.divergences.every((x) => x.status !== "pendente")) inb.status = "em_conferencia";
}

export interface ConferenceSummary {
  expected: number;
  read: number;
  missingPrice: number;
  pendingDivergences: number;
  unreadByItem: { itemId: Id; missing: number }[];
}

export function conferenceSummary(inb: Inbound): ConferenceSummary {
  const expected = inb.items.reduce((a, i) => a + i.qty, 0);
  return {
    expected,
    read: inb.scans.length,
    missingPrice: inb.scans.filter((s) => s.price === null || s.price === undefined).length,
    pendingDivergences: inb.divergences.filter((d) => d.status === "pendente").length,
    unreadByItem: inb.items.map((i) => ({
      itemId: i.id,
      missing: i.qty - inb.scans.filter((s) => s.itemId === i.id).length,
    })),
  };
}

/**
 * Fecha a conferência. RN-020: só fecha com preço em todas as séries.
 * Aplica todas as séries ou nenhuma. Idempotente (clique duplo não duplica).
 */
export function closeConference(db: Db, inboundId: Id, by: string): Serial[] {
  return idempotent(db, `fechar-conferencia:${inboundId}`, () => {
    const inb = mustInbound(db, inboundId);
    if (inb.status === "fechada") throw new DomainError("estado", "Entrada já fechada.");
    if (inb.status === "estornada") throw new DomainError("estado", "Entrada estornada.");
    const sum = conferenceSummary(inb);
    if (inb.scans.length === 0) throw new DomainError("sem_leituras", "Nenhuma série lida.");
    if (sum.missingPrice > 0) {
      throw new DomainError("rn020", `RN-020: ${sum.missingPrice} série(s) sem preço de compra. Preencha todos antes de fechar.`);
    }
    if (sum.pendingDivergences > 0) {
      throw new DomainError("divergencia", "Há divergências aguardando aprovação.");
    }
    const unresolved = sum.unreadByItem.filter((u) => u.missing > 0);
    const approvedShort = inb.divergences.filter((d) => d.status === "aprovada" && d.kind === "falta");
    for (const u of unresolved) {
      const covered = approvedShort.filter((d) => d.itemId === u.itemId).reduce((a, d) => a + d.qty, 0);
      if (covered < u.missing) {
        throw new DomainError("falta", "Há itens não conferidos sem divergência aprovada.");
      }
    }
    const created: Serial[] = [];
    const provisional = !!inb.importId && !db.imports.find((i) => i.id === inb.importId)?.rateioClosed;
    for (const sc of inb.scans) {
      const item = inb.items.find((i) => i.id === sc.itemId)!;
      const price = round2((sc.price as number) * (inb.currency === "BRL" ? 1 : inb.fx));
      const perUnitAllocated = item.qty ? round2(item.allocated / item.qty) : 0;
      const s: Serial = {
        id: nextId(db, "ser"),
        serial: sc.serial,
        productId: item.productId,
        ownerCompanyId: inb.companyId,
        locationId: inb.destLocationId,
        custody: db.locations.find((l) => l.id === inb.destLocationId)?.name ?? "",
        commercial: "disponivel",
        technical: "novo",
        inboundId: inb.id,
        lotId: item.id,
        cost: round2(price + perUnitAllocated),
        purchasePrice: price,
        allocatedCost: perUnitAllocated,
        assignedCost: 0,
        costStatus: provisional ? "provisorio" : "definitivo",
        createdAt: nowIso(),
      };
      if (db.serials.some((x) => x.serial === s.serial)) {
        throw new DomainError("serie_duplicada", `Série ${s.serial} já existe.`);
      }
      db.serials.push(s);
      db.serialHistory.push({
        id: nextId(db, "sh"),
        serialId: s.id,
        at: nowIso(),
        by,
        field: "local",
        from: "",
        to: s.locationId ?? "",
        ref: inb.id,
      });
      postMovement(db, {
        companyId: inb.companyId,
        productId: s.productId,
        serialId: s.id,
        qty: 1,
        kind: "entrada",
        fromLocationId: null,
        toLocationId: s.locationId,
        refType: "entrada",
        refId: inb.id,
        idempotencyKey: `entrada:${inb.id}:${s.serial}`,
        by,
      });
      created.push(s);
    }
    inb.status = "fechada";
    inb.closedAt = nowIso();
    inb.conferenceBy = by;
    for (const o of inb.orderId ? db.orders.filter((x) => x.id === inb.orderId) : []) {
      for (const it of inb.items) {
        const line = o.items.find((l) => l.productId === it.productId);
        if (line) line.received += inb.scans.filter((s) => s.itemId === it.id).length;
      }
      o.status = o.items.every((l) => l.received >= l.qty) ? "recebido" : "parcial";
    }
    audit(db, by, "entrada.fechada", inb.id, inb.companyId, `${created.length} séries`);
    return created;
  });
}

/** Entrada fechada: ajuste de custo só com motivo e histórico (RN-020). */
export function adjustClosedCost(db: Db, serialCode: string, newPurchasePrice: number, reason: string, by: string) {
  requireAdmin(db, by, "ajustar custos");
  if (!reason.trim()) throw new DomainError("motivo", "Ajuste de custo exige motivo.");
  if (!(newPurchasePrice >= 0)) throw new DomainError("preco", "Preço inválido.");
  const s = findSerial(db, serialCode);
  if (!s) throw new DomainError("serie_inexistente", "Série não encontrada.");
  const prev = s.cost;
  s.purchasePrice = round2(newPurchasePrice);
  const total = round2(s.purchasePrice + s.allocatedCost + s.assignedCost);
  db.costAdjustments.push({
    id: nextId(db, "adj"),
    serialId: s.id,
    at: nowIso(),
    by,
    from: prev,
    to: total,
    reason,
  });
  updateSerial(db, s, { cost: total }, by, "ajuste_custo");
}

/** Estorno de entrada fechada: só se nenhuma série saiu do local de entrada. */
export function reverseInbound(db: Db, inboundId: Id, by: string, reason: string) {
  requireAdmin(db, by, "estornar entradas");
  if (!reason.trim()) throw new DomainError("motivo", "Estorno exige motivo.");
  atomic(db, () => {
    const inb = mustInbound(db, inboundId);
    if (inb.status !== "fechada") throw new DomainError("estado", "Só entrada fechada pode ser estornada.");
    for (const sc of inb.scans) {
      const s = findSerial(db, sc.serial)!;
      if (s.commercial !== "disponivel" || s.locationId !== inb.destLocationId) {
        throw new DomainError("serie_movimentada", `Série ${s.serial} já foi movimentada; estorne a operação posterior primeiro.`);
      }
    }
    for (const sc of inb.scans) {
      const s = findSerial(db, sc.serial)!;
      const mov = db.movements.find((m) => m.idempotencyKey === `entrada:${inb.id}:${s.serial}`)!;
      postMovement(db, {
        companyId: mov.companyId,
        productId: mov.productId,
        serialId: mov.serialId,
        qty: 1,
        kind: "estorno",
        fromLocationId: mov.toLocationId,
        toLocationId: null,
        outcome: "ajuste",
        refType: "entrada",
        refId: inb.id,
        idempotencyKey: `estorno:${mov.id}`,
        reason,
        by,
        reversalOf: mov.id,
      });
      updateSerial(db, s, { locationId: null, commercial: "baixado", technical: "descartado" }, by, `estorno:${inb.id}`);
    }
    inb.status = "estornada";
    audit(db, by, "entrada.estornada", inb.id, inb.companyId, reason);
  });
}
