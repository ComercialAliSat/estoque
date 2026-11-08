// Tipos do módulo de estoque. Espelham as tabelas est_* (ver supabase/migrations).

export type Id = string;
export type RecordType = "P" | "C" | "S" | "A" | "M";
export type Role = "admin" | "operacao";
export type Area = "estoque" | "financeiro" | "operacoes" | "fiscal" | "auditoria";
export type Action = "ver" | "criar" | "editar" | "aprovar" | "confirmar" | "exportar";

export interface Company {
  id: Id;
  name: string;
  cnpj: string;
  ie: string;
  regime: "presumido" | "real";
  invoiceSeries: string;
  nfeProvider: "simulado" | "real";
  nfeEnv: "homologacao" | "producao";
  certificateOk: boolean;
}

export interface Profile {
  id: Id;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  companyIds: Id[];
  areas: Area[];
  /** permissões por empresa e área (só para Operação). Admin ignora. */
  grants: Grant[];
  canSeeCost: boolean;
}

export interface Grant {
  companyId: Id;
  area: Area;
  actions: Action[];
}

export interface Product {
  id: Id;
  code: string;
  name: string;
  unit: string;
  recordType: "P" | "C";
  klass: "equipamento" | "material" | "kit";
  requiresSerial: boolean;
  requiresIccid: boolean;
  warrantyMonths: number;
  ncm: string;
  active: boolean;
  version: number;
  kitComponents: { productId: Id; qty: number }[];
}

export interface Service {
  id: Id;
  code: string;
  name: string;
  kind: "instalacao" | "manutencao" | "retirada" | "troca" | "administrativo";
  defaultPrice: number;
  defaultCost: number;
  active: boolean;
}

export interface Customer {
  id: Id;
  name: string;
  document: string;
  stateReg: string;
  taxpayer: boolean;
  city: string;
  uf: string;
  companyIds: Id[];
  origin: "crm" | "manual";
  crmId?: string;
  active: boolean;
}

export interface Supplier {
  id: Id;
  name: string;
  country: "BR" | "CN" | "OUTRO";
  document: string;
  currency: string;
  terms: string;
  active: boolean;
}

export type LocationType = "deposito" | "transito" | "tecnico" | "cliente" | "manutencao" | "quarentena";
export interface Location {
  id: Id;
  companyId: Id;
  name: string;
  type: LocationType;
  responsible: string;
  active: boolean;
}

export type CommercialStatus =
  | "disponivel"
  | "reservado"
  | "vendido"
  | "comodato"
  | "em_transito"
  | "perdido"
  | "baixado";
export type TechnicalCondition = "novo" | "bom" | "quarentena" | "defeito" | "reparo" | "descartado";

export interface Serial {
  id: Id;
  serial: string; // único
  productId: Id;
  ownerCompanyId: Id; // dono
  locationId: Id | null; // local
  custody: string; // custódia (texto: pessoa/técnico/cliente)
  commercial: CommercialStatus;
  technical: TechnicalCondition;
  inboundId?: Id;
  lotId?: Id;
  cost: number | null; // preço de compra + rateio (RN-020)
  purchasePrice: number | null;
  allocatedCost: number;
  assignedCost: number; // reparo/RMA (RN-016)
  costStatus: "provisorio" | "definitivo";
  reservationId?: Id;
  iccid?: string;
  createdAt: string;
}

export interface SerialHistory {
  id: Id;
  serialId: Id;
  at: string;
  by: string;
  field: "dono" | "local" | "custodia" | "comercial" | "tecnica" | "custo";
  from: string;
  to: string;
  ref: string;
}

export type MovementKind =
  | "entrada"
  | "saida"
  | "transferencia_saida"
  | "transferencia_entrada"
  | "devolucao"
  | "perda"
  | "ajuste"
  | "consumo_os"
  | "abertura"
  | "estorno";

export interface Movement {
  id: Id;
  companyId: Id;
  productId: Id;
  serialId?: Id;
  qty: number; // sempre positivo; sentido vem de from/to
  kind: MovementKind;
  fromLocationId: Id | null;
  toLocationId: Id | null;
  /** desfecho (RN-011): obrigatório quando não há local de destino */
  outcome?: "venda" | "comodato" | "perda" | "consumo_os" | "devolucao_fornecedor" | "transferencia_externa" | "ajuste";
  refType: string;
  refId: string;
  idempotencyKey: string;
  reason?: string;
  at: string;
  by: string;
  reversalOf?: Id;
}

export type InboundStatus = "rascunho" | "em_conferencia" | "divergente" | "fechada" | "estornada";
export interface Inbound {
  id: Id;
  companyId: Id;
  number: string;
  supplierId: Id;
  nfeKey: string;
  orderId?: Id;
  importId?: Id;
  destLocationId: Id;
  currency: string;
  fx: number;
  status: InboundStatus;
  fiscalStatus: "autorizada" | "nao_verificada";
  items: InboundItem[];
  scans: Scan[];
  divergences: Divergence[];
  conferenceBy?: string;
  closedAt?: string;
  createdAt: string;
}
export interface InboundItem {
  id: Id; // lote
  productId: Id;
  qty: number;
  unitPrice: number | null;
  weight: number;
  allocated: number; // custo rateado no lote
}
export interface Scan {
  serial: string;
  itemId: Id;
  manual: boolean;
  reason?: string;
  price: number | null;
  priceChangedBy?: string;
  priceReason?: string;
  at: string;
}
export interface Divergence {
  id: Id;
  kind: "falta" | "excesso" | "item_errado" | "avaria";
  itemId?: Id;
  qty: number;
  reason: string;
  status: "pendente" | "aprovada" | "rejeitada";
  requestedBy: string;
  approvedBy?: string;
}

export interface CostAdjustment {
  id: Id;
  serialId: Id;
  at: string;
  by: string;
  from: number | null;
  to: number;
  reason: string;
}

export interface PurchaseOrder {
  id: Id;
  companyId: Id;
  number: string;
  supplierId: Id;
  status: "rascunho" | "aguardando" | "aprovado" | "rejeitado" | "emitido" | "parcial" | "recebido" | "encerrado" | "cancelado";
  currency: string;
  items: { productId: Id; qty: number; unitPrice: number; received: number }[];
  requestedBy: string;
  approvedBy?: string;
  rejectReason?: string;
  createdAt: string;
}

export interface ImportProcess {
  id: Id;
  companyId: Id;
  orderId?: Id;
  invoiceNo: string;
  supplierId: Id;
  currency: string;
  fx: number;
  status: "aberto" | "em_transito" | "recebido" | "fechado";
  costs: { freight: number; insurance: number; taxes: number; expenses: number };
  criterion: "valor" | "quantidade" | "peso";
  rateioClosed: boolean;
  eta: string;
  documents: { name: string; type: string; at: string; by: string }[];
}

export interface MotherCode {
  id: Id;
  companyId: Id;
  token: string;
  box: string;
  productId: Id;
  version: number;
  serials: string[];
  status: "ativo" | "cancelado";
  createdAt: string;
}

export type InvoiceStatus =
  | "rascunho"
  | "em_transmissao"
  | "autorizada"
  | "com_erro"
  | "nao_transmitida"
  | "cancelada"
  | "inutilizada";
export interface Invoice {
  id: Id;
  companyId: Id;
  operation: "venda" | "comodato" | "remessa" | "retorno" | "devolucao" | "transferencia" | "perda";
  number: number | null;
  key: string | null;
  status: InvoiceStatus;
  simulated: true;
  customerId?: Id;
  taxTypeId?: Id;
  outboundId?: Id;
  items: { productId: Id; serial?: string; qty: number; unitValue: number; cfop: string }[];
  total: number;
  taxTotal: number;
  events: { at: string; type: string; reason?: string; by: string }[];
  idempotencyKey: string;
  createdAt: string;
}

export type OutboundKind = "venda" | "comodato" | "transferencia" | "perda" | "os" | "devolucao_fornecedor";
export interface Outbound {
  id: Id;
  companyId: Id;
  number: string;
  kind: OutboundKind;
  customerId?: Id;
  destLocationId?: Id;
  contractId?: Id;
  workOrderId?: Id;
  reservationRef?: string;
  serials: string[];
  unitValue: Record<string, number>;
  taxTypeId?: Id;
  status: "rascunho" | "separada" | "aguardando_nota" | "nota_autorizada" | "enviada" | "cancelada";
  invoiceId?: Id;
  shipping?: { carrier: string; tracking: string };
  createdAt: string;
}

export interface TaxType {
  id: Id;
  companyId: Id;
  name: string;
  operation: Invoice["operation"];
  ufFrom: string;
  ufTo: string; // "*" = qualquer
  taxpayer: "sim" | "nao" | "qualquer";
  partnerFinancier: boolean;
  cfop: string;
  cst: string;
  icms: number;
  ipi: number;
  pis: number;
  cofins: number;
  message: string;
  version: number;
  active: boolean;
}

export interface Transfer {
  id: Id;
  companyId: Id;
  toCompanyId?: Id;
  kind: "entre_locais" | "entre_empresas" | "tecnico_terceiro";
  fromLocationId: Id;
  toLocationId: Id;
  serials: string[];
  transferValue: Record<string, number>;
  status: "rascunho" | "revisada" | "em_transito" | "recebida" | "divergente";
  invoiceId?: Id;
  sentAt?: string;
  receivedAt?: string;
  createdAt: string;
}

export interface LossRequest {
  id: Id;
  companyId: Id;
  serials: string[];
  reason: string;
  evidence: string;
  value: number;
  status: "pendente" | "aprovada" | "rejeitada";
  requestedBy: string;
  decidedBy?: string;
  createdAt: string;
}

export interface Reservation {
  id: Id;
  companyId: Id;
  customerId?: Id;
  crmOpportunityId?: string;
  idempotencyKey: string;
  serials: string[];
  status: "reservada" | "liberada" | "consumida";
  createdAt: string;
}

export interface ReturnRecord {
  id: Id;
  companyId: Id;
  origin: "cliente" | "comodato" | "fornecedor";
  customerId?: Id;
  serials: string[];
  reason: string;
  status: "triagem" | "liberada" | "assistencia" | "baixa";
  createdAt: string;
}

export interface Contract {
  id: Id;
  companyId: Id;
  number: string;
  customerId: Id;
  start: string;
  end: string;
  monthlyFee: number;
  serials: string[];
  status: "ativo" | "encerrado";
  returned: string[];
}

export interface WorkOrder {
  id: Id;
  companyId: Id;
  number: string;
  serviceId: Id;
  customerId: Id;
  contractId?: Id;
  plate: string;
  technician: string;
  technicianKind: "interno" | "terceiro";
  serialsOut: string[];
  serialsIn: string[];
  charged: number;
  techPayment: number | null;
  techPaymentZeroReason?: string;
  supplies: { productId?: Id; description: string; qty: number; unitCost: number; fromStock: boolean }[];
  status: "aberta" | "em_execucao" | "finalizada" | "cancelada";
  origin: "crm" | "manual" | "comodato";
  createdAt: string;
}

export interface AssistCase {
  id: Id;
  companyId: Id;
  serial: string;
  defect: string;
  warrantyUntil: string | null;
  status: "triagem" | "reparo" | "substituicao" | "sem_defeito" | "encerrado" | "baixa";
  repairCost: number;
  createdAt: string;
}

export interface KitOrder {
  id: Id;
  companyId: Id;
  kitProductId: Id;
  qty: number;
  status: "aberta" | "em_montagem" | "concluida";
  built: string[];
}

export interface Chip {
  id: Id;
  companyId: Id;
  iccid: string; // único
  operator: string;
  plan: string;
  holder: "ali_sat" | "cliente";
  status: "livre" | "vinculado";
  cost: number;
}

export interface Link {
  id: Id;
  companyId: Id;
  serial: string;
  iccid?: string;
  platform?: string;
  externalId?: string;
  plate?: string;
  customerId?: Id;
  from: string;
  to: string | null;
}

export interface Inventory {
  id: Id;
  companyId: Id;
  scope: string;
  locationId?: Id;
  snapshot: Record<string, number>;
  counted: string[];
  status: "contando" | "revisao" | "ajustado";
  createdAt: string;
}

export interface AuditEntry {
  id: Id;
  at: string;
  by: string;
  companyId?: Id;
  action: string;
  ref: string;
  detail?: string;
}

export interface ExportLog {
  id: Id;
  at: string;
  by: string;
  companyId?: Id;
  screen: string;
  format: "csv" | "xls";
  rows: number;
}

export interface IntegrationEvent {
  id: Id;
  system: "crm" | "argos" | "nfe" | "correios";
  type: string;
  idempotencyKey: string;
  payload: unknown;
  status: "recebido" | "processado" | "erro" | "tratado";
  attempts: number;
  error?: string;
  at: string;
}

export interface DecisionPoint {
  id: Id;
  title: string;
  assumed: string;
  screen: string;
  decided: boolean;
  note?: string;
  decidedBy?: string;
  decidedAt?: string;
}

export interface ProductTax {
  productId: Id;
  uf: string;
  ncm: string;
  cfop: string;
}

export interface HControlLoad {
  id: Id;
  at: string;
  by: string;
  companyId: Id;
  status: "previa" | "concluida" | "descartada";
  counts: Record<string, number>;
  errors: { file: string; line: number; message: string }[];
}

export interface Params {
  transferSameCompanyNeedsInvoice: boolean;
  kitCostIncludesAssembly: boolean;
  transitDays: number;
}

export interface Db {
  companies: Company[];
  profiles: Profile[];
  products: Product[];
  services: Service[];
  customers: Customer[];
  suppliers: Supplier[];
  locations: Location[];
  serials: Serial[];
  serialHistory: SerialHistory[];
  movements: Movement[];
  inbounds: Inbound[];
  costAdjustments: CostAdjustment[];
  orders: PurchaseOrder[];
  imports: ImportProcess[];
  motherCodes: MotherCode[];
  invoices: Invoice[];
  outbounds: Outbound[];
  taxTypes: TaxType[];
  transfers: Transfer[];
  losses: LossRequest[];
  reservations: Reservation[];
  returns: ReturnRecord[];
  contracts: Contract[];
  workOrders: WorkOrder[];
  assists: AssistCase[];
  kitOrders: KitOrder[];
  chips: Chip[];
  links: Link[];
  inventories: Inventory[];
  audit: AuditEntry[];
  exports: ExportLog[];
  events: IntegrationEvent[];
  decisions: DecisionPoint[];
  productTax: ProductTax[];
  hcontrol: HControlLoad[];
  areaTemplates: Record<Area, Action[]>;
  params: Params;
  idempotency: Record<string, unknown>;
  seq: number;
}
