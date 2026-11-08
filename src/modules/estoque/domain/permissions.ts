import type { Action, Area, Db, Id, Profile } from "./types";

/** Administrador tem tudo nas empresas dele; Operação só o que foi concedido por usuário/empresa/área. */
export function canAccessCompany(p: Profile | undefined, companyId: Id): boolean {
  return !!p && p.active && p.companyIds.includes(companyId);
}

export function can(p: Profile | undefined, companyId: Id, area: Area, action: Action): boolean {
  if (!canAccessCompany(p, companyId)) return false;
  if (p!.role === "admin") return true;
  return p!.grants.some((g) => g.companyId === companyId && g.area === area && g.actions.includes(action));
}

/** Só administradores veem e editam custos (a menos que a permissão de custo seja concedida). */
export function canSeeCost(p: Profile | undefined, companyId: Id): boolean {
  return !!p && canAccessCompany(p, companyId) && (p.role === "admin" || p.canSeeCost);
}

export function visibleCompanies(db: Db, p: Profile | undefined) {
  return db.companies.filter((c) => canAccessCompany(p, c.id));
}

/** Escopo de leitura: mesmo que a tela passe outro company_id, o dado de outra empresa não sai. */
export function scopeByCompany<T extends { companyId: Id }>(rows: T[], p: Profile | undefined, companyId: Id): T[] {
  if (!canAccessCompany(p, companyId)) return [];
  return rows.filter((r) => r.companyId === companyId);
}

export const AREA_TEMPLATES: Record<Area, { label: string; actions: Action[] }> = {
  estoque: { label: "Estoque", actions: ["ver", "criar", "editar", "confirmar", "exportar"] },
  financeiro: { label: "Financeiro", actions: ["ver", "criar", "editar", "exportar"] },
  operacoes: { label: "Operações", actions: ["ver", "criar", "editar", "confirmar"] },
  fiscal: { label: "Fiscal", actions: ["ver", "criar", "editar", "confirmar", "exportar"] },
  auditoria: { label: "Auditoria", actions: ["ver", "exportar"] },
};
