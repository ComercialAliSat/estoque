import { nextId, nowIso, postMovement } from "../domain/core";
import { createContract, createWorkOrder, finalizeWorkOrder, addChips, createLink, sendMaterialsToWO, setWOCosts, createTransfer, reviewTransfer, openAssist, startKitOrder, startInventory } from "../domain/logistics";
import { saveOrder } from "../domain/purchasing";
import { closeConference, createInbound, scanSerial, startConference } from "../domain/inbound";
import { addOutboundSerial, createOutbound, requestOutboundInvoice, reviewOutbound, transmitOutboundInvoice } from "../domain/sales";
import { generateMotherCodes } from "../domain/mothercode";
import type { Db, DecisionPoint } from "../domain/types";

export const TRAXOR = "emp_traxor";
export const ALISAT = "emp_alisat";
export const ADMIN = "u_admin";
export const ADMIN2 = "u_admin2";
export const OPER = "u_oper";
export const OPER_ALISAT = "u_oper_alisat";

export function emptyDb(): Db {
  return {
    companies: [], profiles: [], products: [], services: [], customers: [], suppliers: [], locations: [],
    serials: [], serialHistory: [], movements: [], inbounds: [], costAdjustments: [], orders: [], imports: [],
    motherCodes: [], invoices: [], outbounds: [], taxTypes: [], transfers: [], losses: [], reservations: [],
    returns: [], contracts: [], workOrders: [], assists: [], kitOrders: [], chips: [], links: [], inventories: [],
    audit: [], exports: [], events: [], decisions: [], productTax: [], hcontrol: [],
    areaTemplates: { estoque: ["ver", "criar", "editar", "confirmar", "exportar"], financeiro: ["ver", "criar", "editar", "exportar"], operacoes: ["ver", "criar", "editar", "confirmar"], fiscal: ["ver", "criar", "editar", "confirmar", "exportar"], auditoria: ["ver", "exportar"] },
    params: { transferSameCompanyNeedsInvoice: true, kitCostIncludesAssembly: false, transitDays: 5 },
    idempotency: {}, seq: 0,
  };
}

export const DECISION_POINTS: Omit<DecisionPoint, "decided">[] = [
  { id: "dp_financeira", title: "Regras de venda por financeira parceira", assumed: "Tipo de tributação próprio, escolhido no editor C13.", screen: "/app/cadastros/tributacao" },
  { id: "dp_transf", title: "Transferência dentro da mesma empresa exige nota?", assumed: "Sim (mais seguro).", screen: "/app/admin/parametros" },
  { id: "dp_kit", title: "Custo de kit inclui montagem?", assumed: "Não: soma só os componentes.", screen: "/app/admin/parametros" },
  { id: "dp_cambio", title: "Câmbio da compra em moeda estrangeira", assumed: "Câmbio informado na invoice (D06), guardado por lote.", screen: "/app/importacoes" },
  { id: "dp_etiqueta", title: "Modelo da impressora de etiquetas", assumed: "Impressão do navegador, etiqueta genérica.", screen: "/app/estoque/etiquetas" },
  { id: "dp_convite", title: "Validade do convite/link de senha", assumed: "24 horas.", screen: "/senha/definir" },
  { id: "dp_argos", title: "Ligação com o Argos", assumed: "Desligada; implementação simulada.", screen: "/app/integracoes" },
  { id: "dp_nfe", title: "Provedor de NF-e e Correios", assumed: "Provedor simulado; notas marcadas 'SIMULADA, sem valor fiscal'.", screen: "/app/admin/empresas" },
  { id: "dp_saida_sem_nota", title: "Saída sem nota na mesma empresa", assumed: "Exige nota (parâmetro em N11).", screen: "/app/admin/parametros" },
];

export function nfeKey(n: number) {
  return String(n).padStart(44, "0");
}

export function createSeedDb(): Db {
  const db = emptyDb();

  db.companies.push(
    { id: TRAXOR, name: "Traxor", cnpj: "00.000.000/0001-00", ie: "ISENTO-DEMO", regime: "presumido", invoiceSeries: "1", nfeProvider: "simulado", nfeEnv: "homologacao", certificateOk: false },
    { id: ALISAT, name: "Ali Sat", cnpj: "00.000.000/0002-00", ie: "ISENTO-DEMO", regime: "real", invoiceSeries: "1", nfeProvider: "simulado", nfeEnv: "homologacao", certificateOk: false },
  );

  db.profiles.push(
    { id: ADMIN, name: "Administrador Demo", email: "admin@demo.local", role: "admin", active: true, companyIds: [TRAXOR, ALISAT], areas: ["estoque", "financeiro", "operacoes", "fiscal", "auditoria"], grants: [], canSeeCost: true },
    { id: ADMIN2, name: "Segundo Administrador", email: "admin2@demo.local", role: "admin", active: true, companyIds: [TRAXOR, ALISAT], areas: ["estoque", "financeiro", "operacoes", "fiscal", "auditoria"], grants: [], canSeeCost: true },
    { id: OPER, name: "Operação Estoque (Traxor)", email: "oper@demo.local", role: "operacao", active: true, companyIds: [TRAXOR], areas: ["estoque", "operacoes"],
      grants: [
        { companyId: TRAXOR, area: "estoque", actions: ["ver", "criar", "editar", "confirmar", "exportar"] },
        { companyId: TRAXOR, area: "operacoes", actions: ["ver", "criar", "editar", "confirmar"] },
      ], canSeeCost: false },
    { id: OPER_ALISAT, name: "Operação Ali Sat", email: "oper2@demo.local", role: "operacao", active: true, companyIds: [ALISAT], areas: ["estoque"],
      grants: [{ companyId: ALISAT, area: "estoque", actions: ["ver", "criar"] }], canSeeCost: false },
  );

  const prod = (id: string, code: string, name: string, recordType: "P" | "C", klass: "equipamento" | "material" | "kit", serial: boolean, warranty: number, ncm: string, kit: { productId: string; qty: number }[] = []) =>
    db.products.push({ id, code, name, unit: "UN", recordType, klass, requiresSerial: serial, requiresIccid: false, warrantyMonths: warranty, ncm, active: true, version: 1, kitComponents: kit });
  prod("p_cam", "CAM-100", "Câmera veicular DC-100", "P", "equipamento", true, 12, "85258999");
  prod("p_trk", "TRK-200", "Rastreador RT-200", "C", "equipamento", true, 0, "85176290");
  prod("p_sen", "SEN-010", "Sensor de porta SP-10", "P", "equipamento", true, 6, "90318099");
  prod("p_cabo", "CAB-001", "Cabo de alimentação (metro)", "P", "material", false, 0, "85444900");
  prod("p_kit", "KIT-001", "Kit Câmera + Sensor", "P", "kit", true, 12, "85258999", [{ productId: "p_cam", qty: 1 }, { productId: "p_sen", qty: 1 }]);

  db.services.push(
    { id: "s_inst", code: "SRV-INST", name: "Instalação", kind: "instalacao", defaultPrice: 180, defaultCost: 90, active: true },
    { id: "s_man", code: "SRV-MAN", name: "Manutenção", kind: "manutencao", defaultPrice: 150, defaultCost: 70, active: true },
    { id: "s_ret", code: "SRV-RET", name: "Retirada", kind: "retirada", defaultPrice: 100, defaultCost: 50, active: true },
    { id: "s_troca", code: "SRV-TRC", name: "Troca", kind: "troca", defaultPrice: 200, defaultCost: 100, active: true },
    { id: "s_desat", code: "SRV-ADM", name: "Desativação (serviço administrativo)", kind: "administrativo", defaultPrice: 0, defaultCost: 0, active: true },
  );

  db.customers.push(
    { id: "c_1", name: "Transportes Exemplo Ltda", document: "11.111.111/0001-11", stateReg: "123456789", taxpayer: true, city: "Porto Alegre", uf: "RS", companyIds: [TRAXOR, ALISAT], origin: "manual", active: true },
    { id: "c_2", name: "Logística Demo S/A", document: "22.222.222/0001-22", stateReg: "", taxpayer: false, city: "Curitiba", uf: "PR", companyIds: [TRAXOR], origin: "crm", crmId: "crm-77", active: true },
  );

  db.suppliers.push(
    { id: "f_br", name: "Fornecedor Nacional Demo", country: "BR", document: "33.333.333/0001-33", currency: "BRL", terms: "30 dias", active: true },
    { id: "f_cn", name: "Shenzhen Demo Co.", country: "CN", document: "CN-DEMO-001", currency: "USD", terms: "T/T", active: true },
  );

  const loc = (id: string, companyId: string, name: string, type: Db["locations"][number]["type"], responsible = "") =>
    db.locations.push({ id, companyId, name, type, responsible, active: true });
  loc("l_dep_t", TRAXOR, "Depósito Traxor", "deposito");
  loc("l_trans_t", TRAXOR, "Em trânsito (Traxor)", "transito");
  loc("l_quar_t", TRAXOR, "Quarentena (Traxor)", "quarentena");
  loc("l_tec_t", TRAXOR, "Técnico terceiro — João", "tecnico", "João (N3)");
  loc("l_dep_a", ALISAT, "Depósito Ali Sat", "deposito");
  loc("l_quar_a", ALISAT, "Quarentena (Ali Sat)", "quarentena");

  // Tipos de tributação: EXEMPLOS com alíquota zero. Regra fiscal real é preenchida pelo Fiscal em C13.
  const tax = (id: string, companyId: string, name: string, operation: Db["taxTypes"][number]["operation"], ufTo: string, taxpayer: "sim" | "nao" | "qualquer", cfop: string) =>
    db.taxTypes.push({ id, companyId, name: `[EXEMPLO] ${name}`, operation, ufFrom: "RS", ufTo, taxpayer, partnerFinancier: false, cfop, cst: "", icms: 0, ipi: 0, pis: 0, cofins: 0, message: "Exemplo — validar com o Fiscal/contador antes de usar.", version: 1, active: true });
  tax("t_venda_t", TRAXOR, "Venda dentro do estado", "venda", "RS", "qualquer", "");
  tax("t_venda_t2", TRAXOR, "Venda para outro estado", "venda", "*", "qualquer", "");
  tax("t_com_t", TRAXOR, "Remessa em comodato", "comodato", "*", "qualquer", "");
  tax("t_transf_t", TRAXOR, "Transferência", "transferencia", "*", "qualquer", "");
  tax("t_venda_a", ALISAT, "Venda", "venda", "*", "qualquer", "");

  // ----- Entrada nacional Traxor (fechada): 5 câmeras + 4 rastreadores -----
  const in1 = createInbound(db, {
    companyId: TRAXOR, supplierId: "f_br", nfeKey: nfeKey(1), destLocationId: "l_dep_t",
    items: [{ productId: "p_cam", qty: 5, unitPrice: 120 }, { productId: "p_trk", qty: 4, unitPrice: 210 }],
  }, ADMIN);
  startConference(db, in1.id, ADMIN);
  for (let i = 1; i <= 5; i++) scanSerial(db, in1.id, `CAM${String(i).padStart(4, "0")}`, in1.items[0].id, ADMIN);
  for (let i = 1; i <= 4; i++) scanSerial(db, in1.id, `TRK${String(i).padStart(4, "0")}`, in1.items[1].id, ADMIN);
  closeConference(db, in1.id, ADMIN);

  // ----- Importação Traxor com custo provisório (rateio ainda aberto) -----
  db.imports.push({
    id: "imp_1", companyId: TRAXOR, invoiceNo: "INV-2026-001", supplierId: "f_cn", currency: "USD", fx: 5.4,
    status: "recebido", costs: { freight: 600, insurance: 100, taxes: 900, expenses: 200 }, criterion: "valor",
    rateioClosed: false, eta: "2026-11-01", documents: [{ name: "invoice.pdf", type: "invoice", at: nowIso(), by: ADMIN }],
  });
  const in2 = createInbound(db, {
    companyId: TRAXOR, supplierId: "f_cn", nfeKey: nfeKey(2), destLocationId: "l_dep_t", importId: "imp_1",
    currency: "USD", fx: 5.4, items: [{ productId: "p_sen", qty: 6, unitPrice: 8, weight: 0.2 }],
  }, ADMIN);
  startConference(db, in2.id, ADMIN);
  for (let i = 1; i <= 6; i++) scanSerial(db, in2.id, `SEN${String(i).padStart(4, "0")}`, in2.items[0].id, ADMIN);
  closeConference(db, in2.id, ADMIN);

  // ----- Entrada Ali Sat -----
  const in3 = createInbound(db, {
    companyId: ALISAT, supplierId: "f_br", nfeKey: nfeKey(3), destLocationId: "l_dep_a",
    items: [{ productId: "p_cam", qty: 3, unitPrice: 125 }],
  }, ADMIN);
  startConference(db, in3.id, ADMIN);
  for (let i = 1; i <= 3; i++) scanSerial(db, in3.id, `ACAM${String(i).padStart(3, "0")}`, in3.items[0].id, ADMIN);
  closeConference(db, in3.id, ADMIN);

  // ----- Entrada em conferência (para navegar na E04) -----
  const in4 = createInbound(db, {
    companyId: TRAXOR, supplierId: "f_br", nfeKey: nfeKey(4), destLocationId: "l_dep_t",
    items: [{ productId: "p_cam", qty: 3, unitPrice: 119.9 }],
  }, ADMIN);
  startConference(db, in4.id, ADMIN);
  scanSerial(db, in4.id, "CAM0101", in4.items[0].id, ADMIN);
  in4.conferenceBy = undefined; // liberada para qualquer conferente continuar

  // Material sem série: saldo de abertura
  postMovement(db, {
    companyId: TRAXOR, productId: "p_cabo", qty: 50, kind: "abertura", fromLocationId: null, toLocationId: "l_dep_t",
    refType: "abertura", refId: "seed", idempotencyKey: "abertura:p_cabo", by: ADMIN,
  });

  // Código-mãe de uma caixa de câmeras
  generateMotherCodes(db, { companyId: TRAXOR, productId: "p_cam", box: "Caixa 01", serials: ["CAM0001", "CAM0002", "CAM0003"] });

  // ----- Venda (câmera) com nota simulada -----
  const sale = createOutbound(db, { companyId: TRAXOR, kind: "venda", customerId: "c_1", taxTypeId: "t_venda_t" }, ADMIN);
  addOutboundSerial(db, sale.id, "CAM0004", 350);
  reviewOutbound(db, sale.id);
  requestOutboundInvoice(db, sale.id, ADMIN);
  transmitOutboundInvoice(db, sale.id, ADMIN);

  // ----- Comodato (2 rastreadores) -----
  const ctr = createContract(db, { companyId: TRAXOR, customerId: "c_1", start: "2026-11-01", end: "2027-10-31", monthlyFee: 60, serials: ["TRK0001", "TRK0002"] }, ADMIN);
  const com = createOutbound(db, { companyId: TRAXOR, kind: "comodato", customerId: "c_1", contractId: ctr.id, taxTypeId: "t_com_t" }, ADMIN);
  addOutboundSerial(db, com.id, "TRK0001", 0);
  addOutboundSerial(db, com.id, "TRK0002", 0);
  reviewOutbound(db, com.id);
  requestOutboundInvoice(db, com.id, ADMIN);
  transmitOutboundInvoice(db, com.id, ADMIN);

  // ----- OS de instalação finalizada -----
  const wo = createWorkOrder(db, {
    companyId: TRAXOR, serviceId: "s_inst", customerId: "c_1", contractId: ctr.id, plate: "ABC1D23",
    technician: "João (N3)", technicianKind: "terceiro", charged: 180, origin: "comodato",
  }, ADMIN);
  sendMaterialsToWO(db, wo.id, "TRK0003");
  setWOCosts(db, wo.id, ADMIN, { techPayment: 90, supplies: [{ productId: "p_cabo", description: "Cabo de alimentação", qty: 3, unitCost: 2.5, fromStock: true }] });
  finalizeWorkOrder(db, wo.id, ADMIN);

  // Chips e vínculo
  addChips(db, TRAXOR, [
    { iccid: "8955010000000000001", operator: "Operadora Demo", plan: "M2M 50MB", cost: 8 },
    { iccid: "8955010000000000002", operator: "Operadora Demo", plan: "M2M 50MB", cost: 8 },
    { iccid: "8955010000000000003", operator: "Operadora Demo", plan: "M2M 50MB", cost: 8 },
  ]);
  createLink(db, TRAXOR, { serial: "TRK0001", iccid: "8955010000000000001", platform: "Plataforma Demo", externalId: "PLAT-1001", plate: "ABC1D23", customerId: "c_1" }, ADMIN);

  // Evento de integração com erro para a fila (M03)
  db.events.push({ id: nextId(db, "evt"), system: "crm", type: "opportunity.won", idempotencyKey: "crm-evt-demo-1", payload: { opportunityId: "OPP-1" }, status: "erro", attempts: 1, error: "Séries não informadas na oportunidade.", at: nowIso() });

  // Para navegar de manhã: pedido aguardando aprovação, transferência revisada, chamado de assistência, ordem de kit e inventário.
  saveOrder(db, { companyId: TRAXOR, supplierId: "f_br", currency: "BRL", items: [{ productId: "p_cam", qty: 10, unitPrice: 118 }] }, true, ADMIN2);
  const tr = createTransfer(db, { companyId: TRAXOR, kind: "tecnico_terceiro", fromLocationId: "l_dep_t", toLocationId: "l_tec_t", serials: ["CAM0002"] }, ADMIN);
  reviewTransfer(db, tr.id);
  openAssist(db, { companyId: TRAXOR, serial: "CAM0003", defect: "Sem imagem (demonstração)" }, ADMIN);
  startKitOrder(db, { companyId: TRAXOR, kitProductId: "p_kit", qty: 1 });
  startInventory(db, TRAXOR, "l_dep_t", "Local Depósito Traxor");

  // Oportunidade ganha no CRM aguardando reserva (I01/I02)
  db.events.push({ id: nextId(db, "evt"), system: "crm", type: "opportunity.won", idempotencyKey: "crm-evt-demo-2", payload: { opportunityId: "OPP-2", customerId: "c_2", value: 1500, items: [{ productId: "p_cam", qty: 2 }] }, status: "recebido", attempts: 0, at: nowIso() });

  db.decisions = DECISION_POINTS.map((d) => ({ ...d, decided: false }));
  // O rateio da importação fica aberto de propósito: custo provisório visível em E08/L03.
  return db;
}
