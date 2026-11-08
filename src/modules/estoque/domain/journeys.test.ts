import { beforeEach, describe, expect, it } from "vitest";
import { ADMIN, ADMIN2, ALISAT, OPER, TRAXOR, createSeedDb, nfeKey } from "../data/seed";
import { atomic, balance, DomainError, findSerial } from "./core";
import { closeConference, createInbound, scanSerial, startConference } from "./inbound";
import { createContract, createTransfer, receiveTransfer, registerComodatoReturn, reviewTransfer, sendTransfer, startInventory, countSerial, finishCount, approveInventory, inventoryDiff, addChips, createLink, overdueTransfers } from "./logistics";
import { addOutboundSerial, createOutbound, reserveSerials, releaseReservation, requestOutboundInvoice, reviewOutbound, transmitOutboundInvoice, triageReturn, cancelOutboundAfterInvoiceCancel } from "./sales";
import { invoiceEvent, invoiceXml, inutilize, SIMULATED_LABEL } from "./fiscal";
import { decideOrder, saveOrder, issueOrder } from "./purchasing";
import { createMockCrm } from "../integrations/crm";
import { stockPosition } from "./stock";
import { toCsv, toXls } from "./sheets";
import type { Db } from "./types";

let db: Db;
beforeEach(() => { db = createSeedDb(); });
const throws = (fn: () => unknown, code?: string) => {
  try { fn(); } catch (e) { expect(e).toBeInstanceOf(DomainError); if (code) expect((e as DomainError).code).toBe(code); return; }
  throw new Error("esperava falha");
};

describe("JRN-03 compra nacional → posição → venda → baixa", () => {
  it("pedido aprovado por outro administrador, recebimento parcial, conferência e saldo", () => {
    const o = saveOrder(db, { companyId: TRAXOR, supplierId: "f_br", currency: "BRL", items: [{ productId: "p_sen", qty: 4, unitPrice: 20 }] }, true, ADMIN);
    throws(() => decideOrder(db, o.id, true, ADMIN), "auto_aprovacao");
    throws(() => decideOrder(db, o.id, false, ADMIN2, ""), "motivo");
    decideOrder(db, o.id, true, ADMIN2);
    issueOrder(db, o.id, ADMIN);
    const inb = createInbound(db, { companyId: TRAXOR, supplierId: "f_br", nfeKey: nfeKey(70), destLocationId: "l_dep_t", orderId: o.id, items: [{ productId: "p_sen", qty: 2, unitPrice: 20 }] }, ADMIN);
    startConference(db, inb.id, ADMIN);
    scanSerial(db, inb.id, "S1", inb.items[0].id, ADMIN);
    scanSerial(db, inb.id, "S2", inb.items[0].id, ADMIN);
    closeConference(db, inb.id, ADMIN);
    expect(db.orders.find((x) => x.id === o.id)!.status).toBe("parcial");
    expect(stockPosition(db, [TRAXOR]).find((r) => r.productId === "p_sen" && r.locationId === "l_dep_t")!.physical).toBe(8);
  });
  it("outra pessoa conferindo bloqueia; excesso e quantidade além da nota são recusados", () => {
    const inb = createInbound(db, { companyId: TRAXOR, supplierId: "f_br", nfeKey: nfeKey(71), destLocationId: "l_dep_t", items: [{ productId: "p_cam", qty: 1, unitPrice: 10 }] }, ADMIN);
    startConference(db, inb.id, ADMIN);
    throws(() => startConference(db, inb.id, ADMIN2), "conflito");
    scanSerial(db, inb.id, "Z1", inb.items[0].id, ADMIN);
    throws(() => scanSerial(db, inb.id, "Z2", inb.items[0].id, ADMIN), "excesso");
    throws(() => scanSerial(db, inb.id, "Z1", inb.items[0].id, ADMIN), "serie_repetida");
    throws(() => scanSerial(db, inb.id, "Q1", inb.items[0].id, ADMIN, { manual: true }), "motivo");
  });
});

describe("JRN-06/07 reserva do CRM → saída → nota simulada → envio", () => {
  it("reserva, separa só a série reservada, nota simulada com aviso e baixa", () => {
    const r = reserveSerials(db, { companyId: TRAXOR, idempotencyKey: "crm:OPP-9", serials: ["CAM0005"], crmOpportunityId: "OPP-9", customerId: "c_2" }, ADMIN);
    const o = createOutbound(db, { companyId: TRAXOR, kind: "venda", customerId: "c_2", reservationId: r.id, taxTypeId: "t_venda_t2" }, ADMIN);
    addOutboundSerial(db, o.id, "CAM0005", 400);
    reviewOutbound(db, o.id);
    const inv = requestOutboundInvoice(db, o.id, ADMIN);
    expect(db.serials.find((s) => s.serial === "CAM0005")!.locationId).toBe("l_dep_t");
    transmitOutboundInvoice(db, o.id, ADMIN);
    const done = db.invoices.find((i) => i.id === inv.id)!;
    expect(done.status).toBe("autorizada");
    expect(invoiceXml(db, done)).toContain(SIMULATED_LABEL);
    expect(db.reservations.find((x) => x.id === r.id)!.status).toBe("consumida");
    expect(findSerial(db, "CAM0005")!.commercial).toBe("vendido");
  });
  it("cancelar a nota que baixou estoque estorna a saída", () => {
    const o = createOutbound(db, { companyId: TRAXOR, kind: "venda", customerId: "c_1" }, ADMIN);
    addOutboundSerial(db, o.id, "CAM0005", 1);
    reviewOutbound(db, o.id);
    const inv = requestOutboundInvoice(db, o.id, ADMIN);
    transmitOutboundInvoice(db, o.id, ADMIN);
    const antes = balance(db, TRAXOR, "p_cam", "l_dep_t");
    throws(() => invoiceEvent(db, inv.id, "cancelamento", "curto", ADMIN), "motivo");
    invoiceEvent(db, inv.id, "cancelamento", "Cancelamento por erro de digitação", ADMIN);
    cancelOutboundAfterInvoiceCancel(db, o.id, ADMIN);
    expect(balance(db, TRAXOR, "p_cam", "l_dep_t")).toBe(antes + 1);
    expect(findSerial(db, "CAM0005")!.commercial).toBe("disponivel");
  });
  it("liberar reserva (oportunidade cancelada) devolve a série; reprocessar evento do CRM não duplica", async () => {
    let calls = 0;
    const crm = createMockCrm({ read: () => db, write: (fn) => { calls++; return atomic(db, () => fn(db)); } }, () => ADMIN);
    await crm.reserve({ companyId: TRAXOR, idempotencyKey: "k-crm", serials: ["CAM0005"], crmOpportunityId: "OPP-5" });
    await crm.reserve({ companyId: TRAXOR, idempotencyKey: "k-crm", serials: ["CAM0005"], crmOpportunityId: "OPP-5" });
    expect(db.reservations.filter((r) => r.idempotencyKey === "k-crm")).toHaveLength(1);
    await crm.handleEvent({ idempotencyKey: "ev-1", type: "opportunity.cancelled", payload: { opportunityId: "OPP-5" } });
    await crm.handleEvent({ idempotencyKey: "ev-1", type: "opportunity.cancelled", payload: { opportunityId: "OPP-5" } });
    expect(findSerial(db, "CAM0005")!.commercial).toBe("disponivel");
    expect(db.events.filter((e) => e.idempotencyKey === "ev-1")).toHaveLength(1);
    expect(calls).toBeGreaterThan(0);
  });
  it("CRM só consulta custo com permissão de custo", async () => {
    const crm = createMockCrm({ read: () => db, write: (fn) => fn(db) }, () => OPER);
    await expect(crm.queryCost({ serial: "CAM0005" }, TRAXOR)).rejects.toThrow();
    const adm = createMockCrm({ read: () => db, write: (fn) => fn(db) }, () => ADMIN);
    const [a] = await adm.queryCost({ serial: "CAM0005" }, TRAXOR);
    expect(a.cost).toBe(120);
    expect(await adm.queryCost({ serial: "CAM0005" }, ALISAT)).toEqual([]); // outra empresa
    const byProduct = await adm.queryCost({ productId: "p_sen" }, TRAXOR);
    expect(byProduct.every((x) => x.provisional)).toBe(true);
  });
});

describe("JRN-08/09 comodato e retorno", () => {
  it("retorno vai à quarentena, não libera sem triagem; propriedade não muda", () => {
    const sers = db.contracts[0].serials;
    expect(findSerial(db, sers[0])!.ownerCompanyId).toBe(TRAXOR);
    expect(findSerial(db, sers[0])!.commercial).toBe("comodato");
    registerComodatoReturn(db, db.contracts[0].id, [sers[1]], "retorno parcial", ADMIN);
    const s = findSerial(db, sers[1])!;
    expect(s.technical).toBe("quarentena");
    expect(db.locations.find((l) => l.id === s.locationId)!.type).toBe("quarentena");
    throws(() => addOutboundSerial(db, createOutbound(db, { companyId: TRAXOR, kind: "venda", customerId: "c_1" }, ADMIN).id, sers[1]), "indisponivel");
    triageReturn(db, db.returns.at(-1)!.id, "liberar", ADMIN);
    expect(findSerial(db, sers[1])!.commercial).toBe("disponivel");
    expect(findSerial(db, sers[1])!.ownerCompanyId).toBe(TRAXOR);
  });
  it("comodato exige produto imobilizado (C) e mensalidade", () => {
    throws(() => createContract(db, { companyId: TRAXOR, customerId: "c_1", start: "2026-01-01", end: "2026-12-31", monthlyFee: 50, serials: ["CAM0005"] }, ADMIN), "tipo");
    throws(() => createContract(db, { companyId: TRAXOR, customerId: "c_1", start: "2026-01-01", end: "2026-12-31", monthlyFee: 0, serials: ["TRK0004"] }, ADMIN), "mensalidade");
  });
});

describe("JRN-10 técnico terceiro e entre empresas", () => {
  it("envio ao N3 (sem nota: mesma empresa), trânsito, recebimento com divergência", () => {
    const t = createTransfer(db, { companyId: TRAXOR, kind: "tecnico_terceiro", fromLocationId: "l_dep_t", toLocationId: "l_tec_t", serials: ["CAM0005", "TRK0004"] }, ADMIN);
    reviewTransfer(db, t.id);
    const n = db.invoices.length;
    sendTransfer(db, t.id, ADMIN);
    expect(findSerial(db, "CAM0005")!.commercial).toBe("em_transito");
    expect(db.invoices.length).toBe(n); // JRN-10: nota só entre empresas
    const r = receiveTransfer(db, t.id, ["CAM0005"], ADMIN);
    expect(r.missing).toEqual(["TRK0004"]);
    expect(db.transfers.find((x) => x.id === t.id)!.status).toBe("divergente");
    expect(findSerial(db, "CAM0005")!.locationId).toBe("l_tec_t");
    expect(findSerial(db, "CAM0005")!.ownerCompanyId).toBe(TRAXOR); // local muda, dono não
  });
  it("parâmetro desliga a nota entre locais; entre empresas muda o dono só no recebimento", () => {
    db.params.transferSameCompanyNeedsInvoice = false;
    db.locations.push({ id: "l_dep2", companyId: TRAXOR, name: "Dep 2", type: "deposito", responsible: "", active: true });
    const t = createTransfer(db, { companyId: TRAXOR, kind: "entre_locais", fromLocationId: "l_dep_t", toLocationId: "l_dep2", serials: ["CAM0005"] }, ADMIN);
    reviewTransfer(db, t.id);
    const n = db.invoices.length;
    sendTransfer(db, t.id, ADMIN);
    expect(db.invoices.length).toBe(n);
    receiveTransfer(db, t.id, ["CAM0005"], ADMIN);
    expect(findSerial(db, "CAM0005")!.locationId).toBe("l_dep2");
    db.locations.push({ id: "l_recv", companyId: ALISAT, name: "Recebimento Ali Sat", type: "deposito", responsible: "", active: true });
    const t2 = createTransfer(db, { companyId: TRAXOR, toCompanyId: ALISAT, kind: "entre_empresas", fromLocationId: "l_dep_t", toLocationId: "l_recv", serials: ["TRK0004"] }, ADMIN);
    reviewTransfer(db, t2.id);
    sendTransfer(db, t2.id, ADMIN);
    expect(findSerial(db, "TRK0004")!.ownerCompanyId).toBe(TRAXOR);
    receiveTransfer(db, t2.id, ["TRK0004"], ADMIN);
    expect(findSerial(db, "TRK0004")!.ownerCompanyId).toBe(ALISAT);
    expect(findSerial(db, "TRK0004")!.locationId).toBe("l_recv");
    expect(balance(db, ALISAT, "p_trk", "l_recv")).toBe(1);
    throws(() => createTransfer(db, { companyId: TRAXOR, kind: "entre_locais", fromLocationId: "l_dep_t", toLocationId: "l_dep_a", serials: ["CAM0001"] }, ADMIN), "empresa");
  });
  it("trânsito atrasado gera aviso", () => {
    const t = createTransfer(db, { companyId: TRAXOR, kind: "tecnico_terceiro", fromLocationId: "l_dep_t", toLocationId: "l_tec_t", serials: ["CAM0005"] }, ADMIN);
    reviewTransfer(db, t.id);
    sendTransfer(db, t.id, ADMIN);
    expect(overdueTransfers(db)).toHaveLength(0);
    expect(overdueTransfers(db, new Date(Date.now() + 10 * 86400000))).toHaveLength(1);
  });
});

describe("JRN-15 inventário e demais", () => {
  it("leitura não ajusta; ajuste aprovado por administrador gera movimento compensatório e nunca muda dono", () => {
    const inv = startInventory(db, TRAXOR, "l_dep_t", "Depósito");
    const before = balance(db, TRAXOR, "p_cam", "l_dep_t");
    for (const s of db.serials.filter((x) => x.locationId === "l_dep_t").map((x) => x.serial).filter((s) => s !== "CAM0005")) countSerial(db, inv.id, s);
    expect(inventoryDiff(db, inv.id).missing).toEqual(["CAM0005"]);
    expect(balance(db, TRAXOR, "p_cam", "l_dep_t")).toBe(before);
    finishCount(db, inv.id);
    throws(() => approveInventory(db, inv.id, "ok", OPER), "somente_admin");
    throws(() => approveInventory(db, inv.id, "", ADMIN), "motivo");
    approveInventory(db, inv.id, "Recontagem confirmou a falta", ADMIN);
    expect(balance(db, TRAXOR, "p_cam", "l_dep_t")).toBe(before - 1);
    expect(findSerial(db, "CAM0005")!.ownerCompanyId).toBe(TRAXOR);
  });
  it("chips: ICCID único; chip em uso não vai para outro equipamento", () => {
    throws(() => addChips(db, TRAXOR, [{ iccid: "8955010000000000001", operator: "x", plan: "y", cost: 1 }]), "chips");
    throws(() => addChips(db, TRAXOR, [{ iccid: "123", operator: "x", plan: "y", cost: 1 }]), "chips");
    throws(() => createLink(db, TRAXOR, { serial: "CAM0005", iccid: "8955010000000000001" }, ADMIN), "chip_em_uso");
    throws(() => createLink(db, TRAXOR, { serial: "CAM0005", externalId: "PLAT-1001" }, ADMIN), "id_externo");
    createLink(db, TRAXOR, { serial: "CAM0005", iccid: "8955010000000000002", externalId: "PLAT-2" }, ADMIN);
    const first = createLink(db, TRAXOR, { serial: "CAM0005", iccid: "8955010000000000003" }, ADMIN);
    expect(db.links.filter((l) => l.serial === "CAM0005" && l.to === null)).toEqual([first]); // troca encerra o anterior sem apagar
    expect(db.links.filter((l) => l.serial === "CAM0005")).toHaveLength(2);
  });
  it("liberar reserva e inutilizar numeração", () => {
    const r = reserveSerials(db, { companyId: TRAXOR, idempotencyKey: "z", serials: ["CAM0005"] }, ADMIN);
    releaseReservation(db, r.id, ADMIN);
    expect(findSerial(db, "CAM0005")!.commercial).toBe("disponivel");
    throws(() => inutilize(db, TRAXOR, 1, 1, "teste", ADMIN), "numero_usado");
    inutilize(db, TRAXOR, 900, 901, "Numeração pulada", ADMIN);
  });
  it("exportações CSV/Excel escapam separadores e acentos", () => {
    const csv = toCsv(["a", "b"], [["x;y", 'aspas "ok"'], [1, null]]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"x;y"');
    expect(csv).toContain('"aspas ""ok"""');
    expect(toXls(["h"], [["<b>"]])).toContain("&lt;b&gt;");
  });
});
