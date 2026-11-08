import { DomainError, atomic, audit, findSerial, nextId, requireAdmin, round2, updateSerial } from "./core";
import type { Db, Id, ImportProcess, Inbound, WorkOrder } from "./types";

export function importTotalCosts(c: ImportProcess["costs"]) {
  return round2(c.freight + c.insurance + c.taxes + c.expenses);
}

/** Rateio por valor, quantidade ou peso; a soma é sempre igual ao total (resto vai ao último). */
export function allocate(
  total: number,
  lines: { id: Id; qty: number; value: number; weight: number }[],
  criterion: ImportProcess["criterion"],
): Record<Id, number> {
  const base = (l: { qty: number; value: number; weight: number }) =>
    criterion === "valor" ? l.value : criterion === "quantidade" ? l.qty : l.weight;
  const sum = lines.reduce((a, l) => a + base(l), 0);
  if (lines.length === 0) return {};
  if (sum <= 0) throw new DomainError("rateio_base", `Base de rateio (${criterion}) zerada.`);
  const out: Record<Id, number> = {};
  let acc = 0;
  lines.forEach((l, i) => {
    if (i === lines.length - 1) out[l.id] = round2(total - acc);
    else {
      out[l.id] = round2((total * base(l)) / sum);
      acc = round2(acc + out[l.id]);
    }
  });
  return out;
}

export function importLines(db: Db, imp: ImportProcess) {
  const inbs = db.inbounds.filter((i) => i.importId === imp.id && i.status !== "estornada");
  return inbs.flatMap((i) =>
    i.items.map((it) => ({
      id: it.id,
      qty: it.qty,
      value: round2((it.unitPrice ?? 0) * it.qty * (i.currency === "BRL" ? 1 : i.fx)),
      weight: it.weight,
    })),
  );
}

export function simulateRateio(db: Db, importId: Id) {
  const imp = mustImport(db, importId);
  return allocate(importTotalCosts(imp.costs), importLines(db, imp), imp.criterion);
}

export function mustImport(db: Db, id: Id): ImportProcess {
  const i = db.imports.find((x) => x.id === id);
  if (!i) throw new DomainError("importacao", "Processo de importação não encontrado.");
  return i;
}

/** Fecha o rateio: grava custo rateado nos lotes e atualiza o custo das séries (E08), que passam a definitivas. */
export function closeRateio(db: Db, importId: Id, by: string) {
  requireAdmin(db, by, "fechar rateio");
  atomic(db, () => {
    const imp = mustImport(db, importId);
    if (imp.rateioClosed) throw new DomainError("estado", "Rateio já fechado; use ajuste registrado.");
    const split = simulateRateio(db, importId);
    const total = round2(Object.values(split).reduce((a, b) => a + b, 0));
    if (total !== importTotalCosts(imp.costs)) {
      throw new DomainError("rateio_soma", "A soma do rateio deve ser igual ao total.");
    }
    const inbs = db.inbounds.filter((i) => i.importId === imp.id && i.status !== "estornada");
    for (const inb of inbs) {
      for (const it of inb.items) {
        it.allocated = split[it.id] ?? 0;
        applyLotAllocation(db, inb, it.id, by);
      }
    }
    imp.rateioClosed = true;
    imp.status = "fechado";
    audit(db, by, "importacao.rateio_fechado", imp.id, imp.companyId);
  });
}

function applyLotAllocation(db: Db, inb: Inbound, lotId: Id, by: string) {
  const it = inb.items.find((i) => i.id === lotId)!;
  const per = it.qty ? round2(it.allocated / it.qty) : 0;
  for (const s of db.serials.filter((x) => x.lotId === lotId)) {
    s.allocatedCost = per;
    s.costStatus = "definitivo";
    const total = round2((s.purchasePrice ?? 0) + per + s.assignedCost);
    db.costAdjustments.push({
      id: nextId(db, "adj"),
      serialId: s.id,
      at: new Date().toISOString(),
      by,
      from: s.cost,
      to: total,
      reason: "Fechamento do rateio de importação (D08)",
    });
    updateSerial(db, s, { cost: total }, by, `rateio:${inb.importId}`);
  }
}

/** Custo de assistência/RMA entra no custo do equipamento (J11, RN-016). */
export function addAssignedCost(db: Db, serialCode: string, amount: number, reason: string, by: string) {
  const s = findSerial(db, serialCode);
  if (!s) throw new DomainError("serie_inexistente", "Série não encontrada.");
  if (!(amount >= 0)) throw new DomainError("valor", "Valor inválido.");
  s.assignedCost = round2(s.assignedCost + amount);
  updateSerial(db, s, { cost: round2((s.purchasePrice ?? 0) + s.allocatedCost + s.assignedCost) }, by, reason);
}

export function serialCost(db: Db, code: string): number | null {
  return findSerial(db, code)?.cost ?? null;
}

// ---------- Margem e payback (L01 a L03) ----------

export interface MarginResult {
  revenue: number;
  cost: number;
  margin: number;
  marginPct: number;
  provisional: boolean;
  perSerial: { serial: string; cost: number | null }[];
}

/** Margem de produto: valor de venda menos custo de compra de cada série vendida (sem custo médio). */
export function productMargin(db: Db, lines: { serial: string; saleValue: number }[]): MarginResult {
  let revenue = 0;
  let cost = 0;
  let provisional = false;
  const perSerial = lines.map((l) => {
    const s = findSerial(db, l.serial);
    if (!s) throw new DomainError("serie_inexistente", `Série ${l.serial} não encontrada.`);
    if (s.cost === null) throw new DomainError("sem_custo", `Série ${l.serial} sem custo.`);
    if (s.costStatus === "provisorio") provisional = true;
    revenue += l.saleValue;
    cost += s.cost;
    return { serial: l.serial, cost: s.cost };
  });
  revenue = round2(revenue);
  cost = round2(cost);
  const margin = round2(revenue - cost);
  return { revenue, cost, margin, marginPct: revenue ? round2((margin / revenue) * 100) : 0, provisional, perSerial };
}

/** Custo da OS: pagamento ao técnico + insumos (do estoque com custo de compra, ou avulsos). */
export function workOrderCost(db: Db, wo: Pick<WorkOrder, "techPayment" | "supplies">) {
  const supplies = wo.supplies.reduce((a, s) => {
    let unit = s.unitCost;
    if (s.fromStock && s.productId) {
      const lot = db.serials.find((x) => x.productId === s.productId && x.cost !== null);
      unit = lot?.cost ?? s.unitCost;
    }
    return a + unit * s.qty;
  }, 0);
  return round2((wo.techPayment ?? 0) + supplies);
}

export function serviceMargin(db: Db, wo: Pick<WorkOrder, "charged" | "techPayment" | "supplies">) {
  const cost = workOrderCost(db, wo);
  const margin = round2(wo.charged - cost);
  return { revenue: wo.charged, cost, margin, marginPct: wo.charged ? round2((margin / wo.charged) * 100) : 0 };
}

/** Payback do comodato em meses = custo / mensalidade. */
export function paybackMonths(cost: number, monthlyFee: number): number | null {
  if (!(monthlyFee > 0)) return null;
  return Math.ceil((cost / monthlyFee) * 10) / 10;
}

/** Depreciação linear (taxa e vida útil são dados validados pelo contador, passados como parâmetro). */
export function depreciation(cost: number, usefulLifeMonths: number, monthsInUse: number) {
  if (!(usefulLifeMonths > 0)) return 0;
  const m = Math.min(monthsInUse, usefulLifeMonths);
  return round2((cost / usefulLifeMonths) * m);
}
