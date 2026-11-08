import { beforeEach, describe, expect, it } from "vitest";
import { createSeedDb, nfeKey, ADMIN, ADMIN2, OPER, OPER_ALISAT, TRAXOR, ALISAT } from "../data/seed";
import { balance, postMovement, DomainError, reverseMovement } from "./core";
import {
  adjustClosedCost, closeConference, createInbound, previewPriceSheet, scanSerial, setSerialPrice, startConference,
} from "./inbound";
import { allocate, closeRateio, paybackMonths, productMargin, serviceMargin, simulateRateio } from "./costing";
import {
  addOutboundSerial, createOutbound, registerShipping, requestOutboundInvoice, reserveSerials, reviewOutbound,
  transmitOutboundInvoice, createReturn,
} from "./sales";
import { generateMotherCodes, resolveScan, manifestHash } from "./mothercode";
import { can, canAccessCompany, canSeeCost, scopeByCompany } from "./permissions";
import { createTransfer, decideLoss, requestLoss, reviewTransfer, sendTransfer, createWorkOrder, finalizeWorkOrder, setWOCosts } from "./logistics";
import { pickTaxType } from "./fiscal";
import type { Db } from "./types";

let db: Db;
beforeEach(() => {
  db = createSeedDb();
});

const fails = (fn: () => unknown, code?: string) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    if (code) expect((e as DomainError).code).toBe(code);
    return;
  }
  throw new Error("esperava falha");
};

describe("idempotência", () => {
  it("fechar a conferência duas vezes não duplica séries nem movimentos", () => {
    const inb = createInbound(db, { companyId: TRAXOR, supplierId: "f_br", nfeKey: nfeKey(50), destLocationId: "l_dep_t", items: [{ productId: "p_cam", qty: 2, unitPrice: 100 }] }, ADMIN);
    startConference(db, inb.id, ADMIN);
    scanSerial(db, inb.id, "X1", inb.items[0].id, ADMIN);
    scanSerial(db, inb.id, "X2", inb.items[0].id, ADMIN);
    const before = db.serials.length;
    const movs = db.movements.length;
    closeConference(db, inb.id, ADMIN);
    closeConference(db, inb.id, ADMIN); // clique duplo
    expect(db.serials.length).toBe(before + 2);
    expect(db.movements.length).toBe(movs + 2);
  });
  it("reserva com a mesma chave devolve a mesma reserva", () => {
    const a = reserveSerials(db, { companyId: TRAXOR, idempotencyKey: "k1", serials: ["CAM0005"] }, ADMIN);
    const b = reserveSerials(db, { companyId: TRAXOR, idempotencyKey: "k1", serials: ["CAM0005"] }, ADMIN);
    expect(b.id).toBe(a.id);
    expect(db.reservations.filter((r) => r.idempotencyKey === "k1")).toHaveLength(1);
  });
  it("transmitir a nota duas vezes não baixa duas vezes nem cria dois números", () => {
    const o = createOutbound(db, { companyId: TRAXOR, kind: "venda", customerId: "c_1", taxTypeId: "t_venda_t" }, ADMIN);
    addOutboundSerial(db, o.id, "CAM0005", 300);
    reviewOutbound(db, o.id);
    requestOutboundInvoice(db, o.id, ADMIN);
    requestOutboundInvoice(db, o.id, ADMIN);
    const movs = db.movements.length;
    transmitOutboundInvoice(db, o.id, ADMIN);
    transmitOutboundInvoice(db, o.id, ADMIN);
    expect(db.movements.length).toBe(movs + 1);
    expect(db.invoices.filter((i) => i.outboundId === o.id)).toHaveLength(1);
  });
  it("série e chave de NF-e são únicas", () => {
    const inb = createInbound(db, { companyId: TRAXOR, supplierId: "f_br", nfeKey: nfeKey(51), destLocationId: "l_dep_t", items: [{ productId: "p_cam", qty: 1, unitPrice: 1 }] }, ADMIN);
    startConference(db, inb.id, ADMIN);
    fails(() => scanSerial(db, inb.id, "cam0001", inb.items[0].id, ADMIN), "serie_outra_nota");
    fails(() => createInbound(db, { companyId: TRAXOR, supplierId: "f_br", nfeKey: nfeKey(1), destLocationId: "l_dep_t", items: [{ productId: "p_cam", qty: 1, unitPrice: 1 }] }, ADMIN), "chave_duplicada");
  });
});

describe("RN-011 — nenhuma saída sem desfecho", () => {
  it("movimento que sai do estoque sem destino nem desfecho é recusado", () => {
    fails(() => postMovement(db, { companyId: TRAXOR, productId: "p_cam", qty: 1, kind: "saida", fromLocationId: "l_dep_t", toLocationId: null, refType: "x", refId: "x", idempotencyKey: "t-semdesfecho", by: ADMIN }), "sem_desfecho");
  });
  it("com desfecho, o saldo é derivado do razão", () => {
    const antes = balance(db, TRAXOR, "p_cabo", "l_dep_t");
    postMovement(db, { companyId: TRAXOR, productId: "p_cabo", qty: 2, kind: "saida", fromLocationId: "l_dep_t", toLocationId: null, outcome: "perda", refType: "x", refId: "x", idempotencyKey: "t-ok", by: ADMIN });
    expect(balance(db, TRAXOR, "p_cabo", "l_dep_t")).toBe(antes - 2);
  });
  it("razão é imutável: correção só por estorno", () => {
    const mov = db.movements[0];
    expect(() => {
      (mov as any).qty = 99;
    }).toThrow();
    const e = reverseMovement(db, mov.id, ADMIN, "teste");
    expect(e.reversalOf).toBe(mov.id);
    fails(() => reverseMovement(db, mov.id, ADMIN, "de novo"), "ja_estornado");
  });
  it("perda aprovada leva a série ao desfecho 'perdido' sem apagar o ativo", () => {
    const l = requestLoss(db, { companyId: TRAXOR, serials: ["CAM0005"], reason: "extravio", evidence: "BO" }, OPER);
    fails(() => decideLoss(db, l.id, true, OPER), "somente_admin");
    decideLoss(db, l.id, true, ADMIN);
    const s = db.serials.find((x) => x.serial === "CAM0005")!;
    expect(s.commercial).toBe("perdido");
    expect(db.serials.some((x) => x.serial === "CAM0005")).toBe(true);
  });
  it("quem pede a perda não aprova", () => {
    const l = requestLoss(db, { companyId: TRAXOR, serials: ["CAM0005"], reason: "extravio", evidence: "" }, ADMIN);
    fails(() => decideLoss(db, l.id, true, ADMIN), "auto_aprovacao");
    decideLoss(db, l.id, true, ADMIN2);
  });
});

describe("RN-015 — estoque só baixa com nota autorizada", () => {
  it("saída aguardando nota não baixa e não aceita envio", () => {
    const o = createOutbound(db, { companyId: TRAXOR, kind: "venda", customerId: "c_1", taxTypeId: "t_venda_t" }, ADMIN);
    addOutboundSerial(db, o.id, "CAM0005", 300);
    reviewOutbound(db, o.id);
    requestOutboundInvoice(db, o.id, ADMIN);
    const s = db.serials.find((x) => x.serial === "CAM0005")!;
    expect(s.locationId).toBe("l_dep_t");
    fails(() => registerShipping(db, o.id, "Correios", "AA1"), "rn015");
  });
  it("nota com erro mantém o estoque; autorizada baixa", () => {
    const o = createOutbound(db, { companyId: TRAXOR, kind: "venda", customerId: "c_1", taxTypeId: "t_venda_t" }, ADMIN);
    addOutboundSerial(db, o.id, "CAM0005", 300);
    reviewOutbound(db, o.id);
    requestOutboundInvoice(db, o.id, ADMIN);
    transmitOutboundInvoice(db, o.id, ADMIN, { simulateFailure: "erro" });
    expect(db.serials.find((x) => x.serial === "CAM0005")!.commercial).toBe("disponivel");
    transmitOutboundInvoice(db, o.id, ADMIN);
    expect(db.serials.find((x) => x.serial === "CAM0005")!.commercial).toBe("vendido");
    registerShipping(db, o.id, "Correios", "AA1");
  });
  it("toda nota gerada é marcada como simulada", () => {
    const inv = db.invoices[0];
    expect(inv.simulated).toBe(true);
    expect(inv.events.some((e) => e.reason?.includes("SIMULADA, sem valor fiscal"))).toBe(true);
  });
  it("transferência entre empresas só baixa com nota autorizada e muda o dono no recebimento", () => {
    db.locations.push({ id: "l_x", companyId: ALISAT, name: "Receb. Ali Sat", type: "deposito", responsible: "", active: true });
    const t = createTransfer(db, { companyId: TRAXOR, kind: "entre_empresas", fromLocationId: "l_dep_t", toLocationId: "l_x", toCompanyId: ALISAT, serials: ["CAM0005"] }, ADMIN);
    fails(() => sendTransfer(db, t.id, ADMIN), "estado"); // sem revisão
    reviewTransfer(db, t.id);
    sendTransfer(db, t.id, ADMIN);
    expect(db.invoices.at(-1)!.status).toBe("autorizada");
    expect(db.serials.find((x) => x.serial === "CAM0005")!.ownerCompanyId).toBe(TRAXOR);
  });
});

describe("RN-018 — reserva por série específica", () => {
  it("recusa reserva sem séries e série já reservada ou em outra empresa", () => {
    fails(() => reserveSerials(db, { companyId: TRAXOR, idempotencyKey: "q", serials: [] }, ADMIN), "rn018");
    reserveSerials(db, { companyId: TRAXOR, idempotencyKey: "a", serials: ["CAM0005"] }, ADMIN);
    fails(() => reserveSerials(db, { companyId: TRAXOR, idempotencyKey: "b", serials: ["CAM0005"] }, ADMIN), "indisponivel");
    fails(() => reserveSerials(db, { companyId: TRAXOR, idempotencyKey: "c", serials: ["ACAM001"] }, ADMIN), "indisponivel");
  });
  it("série reservada para outra operação é recusada na separação e bloqueada em transferência", () => {
    reserveSerials(db, { companyId: TRAXOR, idempotencyKey: "a", serials: ["CAM0005"] }, ADMIN);
    const o = createOutbound(db, { companyId: TRAXOR, kind: "venda", customerId: "c_1" }, ADMIN);
    fails(() => addOutboundSerial(db, o.id, "CAM0005"), "indisponivel");
    db.locations.push({ id: "l_dep2", companyId: TRAXOR, name: "Dep 2", type: "deposito", responsible: "", active: true });
    fails(() => createTransfer(db, { companyId: TRAXOR, kind: "entre_locais", fromLocationId: "l_dep_t", toLocationId: "l_dep2", serials: ["CAM0005"] }, ADMIN), "reservada");
  });
  it("série em quarentena é recusada na separação", () => {
    createReturn(db, { companyId: TRAXOR, origin: "cliente", customerId: "c_1", serials: ["CAM0004"], reason: "defeito" }, ADMIN);
    const o = createOutbound(db, { companyId: TRAXOR, kind: "venda", customerId: "c_1" }, ADMIN);
    fails(() => addOutboundSerial(db, o.id, "CAM0004"), "indisponivel");
  });
  it("cliente sem cadastro fiscal completo bloqueia a venda", () => {
    db.customers.push({ id: "c_x", name: "Sem doc", document: "", stateReg: "", taxpayer: false, city: "", uf: "", companyIds: [TRAXOR], origin: "manual", active: true });
    fails(() => createOutbound(db, { companyId: TRAXOR, kind: "venda", customerId: "c_x" }, ADMIN), "cliente_incompleto");
  });
});

describe("RN-020 — preço de compra por lote e por série", () => {
  const novo = () => {
    const inb = createInbound(db, { companyId: TRAXOR, supplierId: "f_br", nfeKey: nfeKey(60), destLocationId: "l_dep_t", items: [{ productId: "p_cam", qty: 2, unitPrice: 100 }] }, ADMIN);
    startConference(db, inb.id, ADMIN);
    scanSerial(db, inb.id, "Y1", inb.items[0].id, ADMIN);
    scanSerial(db, inb.id, "Y2", inb.items[0].id, ADMIN);
    return inb;
  };
  it("não fecha com série sem preço; fecha tudo ou nada", () => {
    const inb = novo();
    setSerialPrice(db, inb.id, "Y2", null, "limpar", ADMIN);
    const n = db.serials.length;
    fails(() => closeConference(db, inb.id, ADMIN), "rn020");
    expect(db.serials.length).toBe(n);
    setSerialPrice(db, inb.id, "Y2", 110, "preço da série", ADMIN);
    closeConference(db, inb.id, ADMIN);
    expect(db.serials.find((s) => s.serial === "Y2")!.cost).toBe(110);
    expect(db.serials.find((s) => s.serial === "Y1")!.cost).toBe(100);
  });
  it("editar preço de uma série exige motivo e só administrador", () => {
    const inb = novo();
    fails(() => setSerialPrice(db, inb.id, "Y1", 5, "", ADMIN), "motivo");
    fails(() => setSerialPrice(db, inb.id, "Y1", 5, "x", OPER), "somente_admin");
  });
  it("depois de fechada só ajuste com motivo e histórico", () => {
    const inb = novo();
    closeConference(db, inb.id, ADMIN);
    fails(() => setSerialPrice(db, inb.id, "Y1", 5, "x", ADMIN), "fechada");
    fails(() => adjustClosedCost(db, "Y1", 90, "", ADMIN), "motivo");
    adjustClosedCost(db, "Y1", 90, "NF corrigida", ADMIN);
    expect(db.serials.find((s) => s.serial === "Y1")!.cost).toBe(90);
    expect(db.costAdjustments.at(-1)!.reason).toBe("NF corrigida");
  });
  it("planilha com série fora da nota não grava nada", () => {
    const inb = novo();
    expect(previewPriceSheet(db, inb.id, [{ serial: "Y1", price: 1 }, { serial: "ZZ", price: 2 }]).ok).toBe(false);
  });
  it("importação: custo provisório até fechar o rateio, depois definitivo", () => {
    const s = db.serials.find((x) => x.serial === "SEN0001")!;
    expect(s.costStatus).toBe("provisorio");
    const antes = s.cost!;
    closeRateio(db, "imp_1", ADMIN);
    expect(s.costStatus).toBe("definitivo");
    expect(s.cost!).toBeGreaterThan(antes);
    // soma do rateio = total
    const total = 600 + 100 + 900 + 200;
    const soma = db.serials.filter((x) => x.productId === "p_sen").reduce((a, x) => a + x.allocatedCost, 0);
    expect(Math.abs(soma - total)).toBeLessThan(0.1);
  });
  it("rateio por valor, quantidade e peso soma sempre o total", () => {
    const lines = [{ id: "a", qty: 1, value: 10, weight: 3 }, { id: "b", qty: 2, value: 20, weight: 1 }, { id: "c", qty: 3, value: 33.33, weight: 7 }];
    for (const c of ["valor", "quantidade", "peso"] as const) {
      const r = allocate(100, lines, c);
      expect(Math.round(Object.values(r).reduce((a, b) => a + b, 0) * 100) / 100).toBe(100);
    }
    expect(Object.keys(simulateRateio(db, "imp_1"))).not.toHaveLength(0);
  });
});

describe("margem e payback", () => {
  it("margem de produto = venda - custo da série vendida (sem custo médio)", () => {
    const m = productMargin(db, [{ serial: "CAM0004", saleValue: 350 }]);
    expect(m.cost).toBe(120);
    expect(m.margin).toBe(230);
    expect(m.marginPct).toBeCloseTo(65.71, 1);
  });
  it("série com custo diferente mantém seu próprio custo", () => {
    adjustClosedCost(db, "CAM0004", 150, "ajuste", ADMIN);
    expect(productMargin(db, [{ serial: "CAM0004", saleValue: 350 }]).cost).toBe(150);
    expect(productMargin(db, [{ serial: "CAM0005", saleValue: 350 }]).cost).toBe(120);
  });
  it("custo provisório aparece marcado", () => {
    expect(productMargin(db, [{ serial: "SEN0001", saleValue: 100 }]).provisional).toBe(true);
  });
  it("margem de serviço = cobrado - técnico - insumos", () => {
    const r = serviceMargin(db, { charged: 180, techPayment: 90, supplies: [{ description: "x", qty: 2, unitCost: 5, fromStock: false }] });
    expect(r.cost).toBe(100);
    expect(r.margin).toBe(80);
    expect(r.marginPct).toBeCloseTo(44.44, 1);
  });
  it("payback em meses", () => {
    expect(paybackMonths(210, 60)).toBe(3.5);
    expect(paybackMonths(210, 0)).toBeNull();
  });
  it("OS: exige custos lançados; zero exige motivo; retirada exige série", () => {
    fails(() => createWorkOrder(db, { companyId: TRAXOR, serviceId: "s_ret", customerId: "c_1", plate: "A", technician: "t", technicianKind: "interno", charged: 100, origin: "manual" }, ADMIN), "serie_obrigatoria");
    const wo = createWorkOrder(db, { companyId: TRAXOR, serviceId: "s_man", customerId: "c_1", plate: "A", technician: "t", technicianKind: "interno", charged: 150, origin: "manual" }, ADMIN);
    fails(() => finalizeWorkOrder(db, wo.id, ADMIN), "custos_os");
    setWOCosts(db, wo.id, ADMIN, { techPayment: 0 });
    fails(() => finalizeWorkOrder(db, wo.id, ADMIN), "custos_os");
    setWOCosts(db, wo.id, ADMIN, { zeroReason: "técnico interno" });
    expect(finalizeWorkOrder(db, wo.id, ADMIN).status).toBe("finalizada");
    fails(() => setWOCosts(db, wo.id, OPER, { techPayment: 5 }), "sem_permissao_custo");
  });
});

describe("código-mãe e leitor universal", () => {
  it("gera, lê e valida o manifesto; gerar não movimenta estoque", () => {
    const movs = db.movements.length;
    const [mc] = generateMotherCodes(db, { companyId: TRAXOR, productId: "p_cam", box: "Cx 2", serials: ["cam0005", "CAM0004", "CAM0005"] });
    expect(db.movements.length).toBe(movs);
    expect(mc.serials).toEqual(["CAM0005", "CAM0004"]);
    const r = resolveScan(db, mc.token, "saida", TRAXOR);
    expect(r.kind).toBe("codigo_mae");
    expect(r.issues.some((i) => i.serial === "CAM0004")).toBe(true); // vendida: não elegível
    expect(r.issues.some((i) => i.serial === "CAM0005")).toBe(false);
  });
  it("detecta integridade, cancelado, outra empresa e releitura", () => {
    const [mc] = generateMotherCodes(db, { companyId: TRAXOR, productId: "p_cam", box: "Cx 3", serials: ["CAM0005"] });
    expect(resolveScan(db, mc.token, "consulta", ALISAT).issues.some((i) => i.message.includes("outra empresa"))).toBe(true);
    expect(resolveScan(db, mc.token, "consulta", TRAXOR, ["CAM0005"]).issues.some((i) => i.message.includes("releitura"))).toBe(true);
    mc.serials.push("CAM0001");
    expect(resolveScan(db, mc.token, "consulta", TRAXOR).issues.some((i) => i.message.includes("Integridade"))).toBe(true);
    mc.status = "cancelado";
    expect(resolveScan(db, mc.token, "consulta", TRAXOR).issues.some((i) => i.message.includes("cancelado"))).toBe(true);
    expect(manifestHash(["A", "B"])).toBe(manifestHash(["B", "A"]));
  });
  it("divide em volumes quando passa da capacidade", () => {
    const many = Array.from({ length: 450 }, (_, i) => `BIG${i}`);
    for (const s of many) db.serials.push({ ...db.serials[0], id: `big${s}`, serial: s });
    const out = generateMotherCodes(db, { companyId: TRAXOR, productId: "p_cam", box: "Pallet", serials: many });
    expect(out).toHaveLength(3);
  });
});

describe("permissões e separação entre empresas", () => {
  it("usuário de uma empresa não acessa a outra", () => {
    const op = db.profiles.find((p) => p.id === OPER_ALISAT);
    expect(canAccessCompany(op, ALISAT)).toBe(true);
    expect(canAccessCompany(op, TRAXOR)).toBe(false);
    expect(scopeByCompany(db.locations, op, TRAXOR)).toEqual([]);
    expect(scopeByCompany(db.locations, op, ALISAT).every((l) => l.companyId === ALISAT)).toBe(true);
    expect(can(op, TRAXOR, "estoque", "ver")).toBe(false);
  });
  it("operação só faz o que foi concedido; custo só para quem tem permissão", () => {
    const op = db.profiles.find((p) => p.id === OPER);
    expect(can(op, TRAXOR, "estoque", "ver")).toBe(true);
    expect(can(op, TRAXOR, "fiscal", "ver")).toBe(false);
    expect(can(op, TRAXOR, "estoque", "aprovar")).toBe(false);
    expect(canSeeCost(op, TRAXOR)).toBe(false);
    expect(canSeeCost(db.profiles.find((p) => p.id === ADMIN), ALISAT)).toBe(true);
  });
  it("usuário desativado perde o acesso", () => {
    const op = db.profiles.find((p) => p.id === OPER)!;
    op.active = false;
    expect(canAccessCompany(op, TRAXOR)).toBe(false);
  });
  it("série de uma empresa não é separada por outra", () => {
    const o = createOutbound(db, { companyId: ALISAT, kind: "venda", customerId: "c_1" }, ADMIN);
    fails(() => addOutboundSerial(db, o.id, "CAM0005"), "indisponivel");
  });
});

describe("tributação (RN-017)", () => {
  it("a regra mais específica vence", () => {
    const geral = pickTaxType(db, { companyId: TRAXOR, operation: "venda", ufFrom: "RS", ufTo: "SP", taxpayer: true });
    expect(geral?.id).toBe("t_venda_t2");
    const interna = pickTaxType(db, { companyId: TRAXOR, operation: "venda", ufFrom: "RS", ufTo: "RS", taxpayer: true });
    expect(interna?.id).toBe("t_venda_t");
  });
});
