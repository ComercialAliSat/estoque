import { DomainError, audit, nextId, nowIso, requireAdmin } from "./core";
import type { Db, Id, ImportProcess, PurchaseOrder } from "./types";

export interface OrderInput {
  id?: Id;
  companyId: Id;
  supplierId: Id;
  currency: string;
  items: { productId: Id; qty: number; unitPrice: number }[];
}

function validate(input: OrderInput) {
  if (!input.supplierId) throw new DomainError("fornecedor", "Escolha o fornecedor.");
  if (input.items.length === 0) throw new DomainError("sem_itens", "Informe ao menos um item.");
  for (const it of input.items) {
    if (!it.productId) throw new DomainError("produto", "Escolha o produto de cada linha.");
    if (!(it.qty > 0)) throw new DomainError("qtd", "Quantidade deve ser maior que zero.");
    if (!(it.unitPrice >= 0)) throw new DomainError("preco", "Preço inválido.");
  }
}

/** Pedido não gera estoque. Salvar rascunho ou enviar para aprovação. */
export function saveOrder(db: Db, input: OrderInput, submit: boolean, by: string): PurchaseOrder {
  if (submit) validate(input);
  let o = input.id ? db.orders.find((x) => x.id === input.id) : undefined;
  if (o && o.status !== "rascunho" && o.status !== "rejeitado") {
    throw new DomainError("estado", "Só pedido em rascunho ou rejeitado pode ser editado.");
  }
  if (!o) {
    o = {
      id: nextId(db, "ped"), companyId: input.companyId, number: `PC-${String(db.orders.length + 1).padStart(4, "0")}`,
      supplierId: input.supplierId, status: "rascunho", currency: input.currency, items: [], requestedBy: by, createdAt: nowIso(),
    };
    db.orders.push(o);
  }
  o.supplierId = input.supplierId;
  o.currency = input.currency;
  o.items = input.items.map((i) => ({ ...i, received: 0 }));
  o.requestedBy = by;
  o.rejectReason = undefined;
  o.status = submit ? "aguardando" : "rascunho";
  audit(db, by, submit ? "pedido.enviado" : "pedido.rascunho", o.id, o.companyId);
  return o;
}

/** Quem pede não aprova o próprio pedido; aprovação por administrador; rejeição exige motivo. */
export function decideOrder(db: Db, id: Id, approve: boolean, by: string, reason = "") {
  requireAdmin(db, by, "aprovar compras");
  const o = db.orders.find((x) => x.id === id);
  if (!o) throw new DomainError("pedido", "Pedido não encontrado.");
  if (o.status !== "aguardando") throw new DomainError("estado", "Pedido não está aguardando aprovação.");
  if (o.requestedBy === by) throw new DomainError("auto_aprovacao", "Quem pede não aprova o próprio pedido.");
  if (!approve && !reason.trim()) throw new DomainError("motivo", "Rejeição exige motivo.");
  o.status = approve ? "aprovado" : "rejeitado";
  o.approvedBy = approve ? by : undefined;
  o.rejectReason = approve ? undefined : reason;
  audit(db, by, approve ? "pedido.aprovado" : "pedido.rejeitado", o.id, o.companyId, reason);
}

export function issueOrder(db: Db, id: Id, by: string) {
  const o = db.orders.find((x) => x.id === id);
  if (!o || o.status !== "aprovado") throw new DomainError("estado", "Só pedido aprovado pode ser emitido ao fornecedor.");
  o.status = "emitido";
  audit(db, by, "pedido.emitido", o.id, o.companyId);
}

export function cancelOrder(db: Db, id: Id, by: string) {
  const o = db.orders.find((x) => x.id === id);
  if (!o) throw new DomainError("pedido", "Pedido não encontrado.");
  if (o.items.some((i) => i.received > 0)) throw new DomainError("recebido", "Pedido com recebimento não pode ser cancelado; encerre com autorização.");
  o.status = "cancelado";
  audit(db, by, "pedido.cancelado", o.id, o.companyId);
}

export function closeOrderWithPending(db: Db, id: Id, by: string) {
  requireAdmin(db, by, "encerrar pedido com pendência");
  const o = db.orders.find((x) => x.id === id);
  if (!o) throw new DomainError("pedido", "Pedido não encontrado.");
  o.status = "encerrado";
  audit(db, by, "pedido.encerrado_com_pendencia", o.id, o.companyId);
}

export function createImport(
  db: Db,
  input: { companyId: Id; orderId?: Id; invoiceNo: string; supplierId: Id; currency: string; fx: number | null; eta: string },
  by: string,
): ImportProcess {
  if (!input.invoiceNo.trim()) throw new DomainError("invoice", "Informe a invoice.");
  if (!input.supplierId) throw new DomainError("fornecedor", "Escolha o fornecedor.");
  if (input.currency !== "BRL" && !(input.fx && input.fx > 0)) throw new DomainError("cambio", "Invoice em moeda estrangeira exige câmbio.");
  const imp: ImportProcess = {
    id: nextId(db, "imp"), companyId: input.companyId, orderId: input.orderId, invoiceNo: input.invoiceNo,
    supplierId: input.supplierId, currency: input.currency, fx: input.fx ?? 1, status: "aberto",
    costs: { freight: 0, insurance: 0, taxes: 0, expenses: 0 }, criterion: "valor", rateioClosed: false, eta: input.eta, documents: [],
  };
  db.imports.push(imp);
  audit(db, by, "importacao.criada", imp.id, imp.companyId);
  return imp;
}

export function closeImport(db: Db, id: Id, by: string) {
  const i = db.imports.find((x) => x.id === id);
  if (!i) throw new DomainError("importacao", "Processo não encontrado.");
  if (!i.rateioClosed) throw new DomainError("rateio", "Só fecha com o rateio fechado (D08).");
  i.status = "fechado";
  audit(db, by, "importacao.fechada", i.id, i.companyId);
}
