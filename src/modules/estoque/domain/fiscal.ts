import { DomainError, atomic, audit, idempotent, nextId, nowIso, round2 } from "./core";
import type { Customer, Db, Id, Invoice, TaxType } from "./types";

export const SIMULATED_LABEL = "SIMULADA, sem valor fiscal";

/** RN-017: a regra mais específica vence. Pontua cada critério que bate exatamente. */
export function pickTaxType(
  db: Db,
  q: { companyId: Id; operation: Invoice["operation"]; ufFrom: string; ufTo: string; taxpayer: boolean; partnerFinancier?: boolean },
): TaxType | undefined {
  let best: { t: TaxType; score: number } | undefined;
  for (const t of db.taxTypes) {
    if (!t.active || t.companyId !== q.companyId || t.operation !== q.operation) continue;
    let score = 0;
    if (t.ufFrom !== "*") {
      if (t.ufFrom !== q.ufFrom) continue;
      score += 2;
    }
    if (t.ufTo !== "*") {
      if (t.ufTo !== q.ufTo) continue;
      score += 2;
    }
    if (t.taxpayer !== "qualquer") {
      if ((t.taxpayer === "sim") !== q.taxpayer) continue;
      score += 1;
    }
    if (t.partnerFinancier) {
      if (!q.partnerFinancier) continue;
      score += 3;
    } else if (q.partnerFinancier) {
      continue;
    }
    if (!best || score > best.score) best = { t, score };
  }
  return best?.t;
}

export function previewTaxes(t: TaxType, items: { qty: number; unitValue: number }[]) {
  const base = round2(items.reduce((a, i) => a + i.qty * i.unitValue, 0));
  const rate = t.icms + t.ipi + t.pis + t.cofins;
  const lines = [
    { name: "ICMS", rate: t.icms, value: round2((base * t.icms) / 100) },
    { name: "IPI", rate: t.ipi, value: round2((base * t.ipi) / 100) },
    { name: "PIS", rate: t.pis, value: round2((base * t.pis) / 100) },
    { name: "COFINS", rate: t.cofins, value: round2((base * t.cofins) / 100) },
  ];
  return { base, rate, lines, total: round2(lines.reduce((a, l) => a + l.value, 0)) };
}

export function customerFiscalComplete(c: Customer | undefined): string[] {
  const missing: string[] = [];
  if (!c) return ["cliente"];
  if (!c.document) missing.push("CNPJ/CPF");
  if (!c.uf) missing.push("UF");
  if (!c.city) missing.push("cidade");
  if (c.taxpayer && !c.stateReg) missing.push("inscrição estadual");
  return missing;
}

export interface NewInvoice {
  companyId: Id;
  operation: Invoice["operation"];
  customerId?: Id;
  outboundId?: Id;
  taxTypeId?: Id;
  items: Invoice["items"];
  idempotencyKey: string;
}

/** Cria a nota em rascunho (K02). Clique repetido não gera duas notas (idempotência). */
export function createInvoiceDraft(db: Db, input: NewInvoice, by: string): Invoice {
  return idempotent(db, `nota:${input.idempotencyKey}`, () => {
    const company = db.companies.find((c) => c.id === input.companyId);
    if (!company) throw new DomainError("empresa", "Empresa não encontrada.");
    if (!company.certificateOk && company.nfeProvider !== "simulado") {
      throw new DomainError("config", "Configuração fiscal incompleta (N06).");
    }
    const tt = input.taxTypeId ? db.taxTypes.find((t) => t.id === input.taxTypeId) : undefined;
    const total = round2(input.items.reduce((a, i) => a + i.qty * i.unitValue, 0));
    const taxTotal = tt ? previewTaxes(tt, input.items).total : 0;
    const inv: Invoice = {
      id: nextId(db, "nf"),
      companyId: input.companyId,
      operation: input.operation,
      number: null,
      key: null,
      status: "rascunho",
      simulated: true,
      customerId: input.customerId,
      taxTypeId: input.taxTypeId,
      outboundId: input.outboundId,
      items: input.items,
      total,
      taxTotal,
      events: [{ at: nowIso(), type: "rascunho", by }],
      idempotencyKey: input.idempotencyKey,
      createdAt: nowIso(),
    };
    db.invoices.push(inv);
    audit(db, by, "nota.rascunho", inv.id, inv.companyId);
    return inv;
  });
}

function fakeKey(db: Db, companyId: Id, n: number): string {
  // 44 dígitos fictícios; prefixo 99 deixa claro que não é chave real.
  const base = `99${String(companyId.length).padStart(2, "0")}${String(n).padStart(9, "0")}${String(db.seq).padStart(10, "0")}`;
  return base.padEnd(44, "0").slice(0, 44);
}

export interface TransmitOptions {
  /** Teste de falha do provedor simulado. */
  simulateFailure?: "erro" | "nao_transmitida";
}

/**
 * Provedor SIMULADO de NF-e. Nunca gera algo que pareça nota real:
 * todo XML/PDF traz "SIMULADA, sem valor fiscal".
 * Idempotente: transmitir duas vezes não cria dois números.
 */
export function transmitInvoice(db: Db, invoiceId: Id, by: string, opts: TransmitOptions = {}): Invoice {
  const inv = db.invoices.find((i) => i.id === invoiceId);
  if (!inv) throw new DomainError("nota", "Nota não encontrada.");
  if (inv.status === "autorizada") return inv;
  if (inv.status === "cancelada" || inv.status === "inutilizada") {
    throw new DomainError("estado", "Nota cancelada ou inutilizada.");
  }
  if (opts.simulateFailure) {
    inv.status = opts.simulateFailure === "erro" ? "com_erro" : "nao_transmitida";
    inv.events.push({
      at: nowIso(),
      type: opts.simulateFailure,
      reason: opts.simulateFailure === "erro" ? "Rejeição simulada: verifique os dados do destinatário." : "Falha de comunicação simulada.",
      by,
    });
    return inv;
  }
  const last = db.invoices.filter((i) => i.companyId === inv.companyId && i.number !== null).length;
  inv.number = last + 1;
  inv.key = fakeKey(db, inv.companyId, inv.number);
  inv.status = "autorizada";
  inv.events.push({ at: nowIso(), type: "autorizada", reason: SIMULATED_LABEL, by });
  audit(db, by, "nota.autorizada_simulada", inv.id, inv.companyId);
  return inv;
}

export function invoiceXml(db: Db, inv: Invoice): string {
  const company = db.companies.find((c) => c.id === inv.companyId);
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!-- ${SIMULATED_LABEL} -->`,
    `<NFeSimulada>`,
    `  <aviso>${SIMULATED_LABEL}</aviso>`,
    `  <emitente>${company?.name ?? ""}</emitente>`,
    `  <numero>${inv.number ?? ""}</numero>`,
    `  <chave>${inv.key ?? ""}</chave>`,
    `  <situacao>${inv.status}</situacao>`,
    `  <total>${inv.total.toFixed(2)}</total>`,
    ...inv.items.map((i) => `  <item serie="${i.serial ?? ""}" qtd="${i.qty}" valor="${i.unitValue.toFixed(2)}" cfop="${i.cfop}"/>`),
    `</NFeSimulada>`,
  ].join("\n");
}

export function invoiceEvent(db: Db, invoiceId: Id, type: "cancelamento" | "carta_correcao", reason: string, by: string) {
  const inv = db.invoices.find((i) => i.id === invoiceId);
  if (!inv) throw new DomainError("nota", "Nota não encontrada.");
  if (reason.trim().length < 15) throw new DomainError("motivo", "Motivo deve ter no mínimo 15 caracteres.");
  if (inv.status !== "autorizada") throw new DomainError("estado", "Só nota autorizada recebe evento.");
  atomic(db, () => {
    inv.events.push({ at: nowIso(), type, reason, by });
    if (type === "cancelamento") inv.status = "cancelada";
  });
}

export function inutilize(db: Db, companyId: Id, from: number, to: number, reason: string, by: string) {
  if (!reason.trim()) throw new DomainError("motivo", "Justificativa obrigatória.");
  if (from > to) throw new DomainError("faixa", "Faixa inválida.");
  const used = db.invoices.some((i) => i.companyId === companyId && i.number !== null && i.number >= from && i.number <= to);
  if (used) throw new DomainError("numero_usado", "Só números não usados podem ser inutilizados.");
  audit(db, by, "nota.inutilizacao", `${from}-${to}`, companyId, reason);
}
