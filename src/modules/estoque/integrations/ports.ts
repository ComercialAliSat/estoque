// Portas (interfaces) das integrações. Cada uma tem implementação simulada (padrão) e esboço da real.

export interface CostQuery {
  productId?: string;
  serial?: string;
}
export interface CostAnswer {
  productId: string;
  serial?: string;
  cost: number | null;
  provisional: boolean;
}

export interface CrmPort {
  /** CRM consulta o custo de compra por produto/série ao montar o orçamento do projeto. */
  queryCost(q: CostQuery, companyId: string): Promise<CostAnswer[]>;
  /** Reserva por série específica, com chave de idempotência. */
  reserve(input: {
    companyId: string;
    idempotencyKey: string;
    serials: string[];
    crmOpportunityId: string;
    customerId?: string;
  }): Promise<{ reservationId: string }>;
  /** Evento de oportunidade ganha/cancelada vindo do CRM. */
  handleEvent(event: {
    idempotencyKey: string;
    type: "opportunity.won" | "opportunity.cancelled";
    payload: any;
  }): Promise<void>;
}

export interface ArgosPort {
  linkDemand(workOrderId: string, demandId: string): Promise<void>;
  listUsers(): Promise<{ id: string; name: string; email: string }[]>;
}

export interface NfePort {
  transmit(invoiceId: string): Promise<{ status: "autorizada" | "com_erro" | "nao_transmitida"; message?: string }>;
  consultKey(key: string): Promise<{ found: boolean; items: any[] }>;
}

export interface CorreiosPort {
  track(code: string): Promise<{ status: string; events: { at: string; text: string }[] }>;
}

/** Autenticação e lista de usuários por interface: o Argos troca a implementação depois. */
export interface AuthPort {
  signIn(email: string, password: string): Promise<{ userId: string; needsMfa: boolean } | { error: string }>;
  verifyMfa(userId: string, code: string): Promise<boolean>;
  signOut(): Promise<void>;
  currentUserId(): string | null;
  listUsers(): Promise<{ id: string; name: string; email: string }[]>;
}

export type IntegrationMode = "mock" | "real";
export function integrationMode(name: "CRM" | "ARGOS" | "NFE" | "CORREIOS"): IntegrationMode {
  const v = (import.meta as any).env?.[`VITE_INTEGRATION_${name}`];
  return v === "real" ? "real" : "mock";
}
