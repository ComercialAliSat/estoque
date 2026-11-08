import { lazy, type ComponentType } from "react";

type Group = { screens: Record<string, ComponentType> };
const LOADERS: Record<string, () => Promise<Group>> = {
  A: () => import("./A_acesso"),
  B: () => import("./B_inicio"),
  C: () => import("./C_cadastros"),
  D: () => import("./D_compras"),
  E: () => import("./E_entradas"),
  F: () => import("./F_codigos"),
  G: () => import("./G_saidas"),
  H: () => import("./H_posicao"),
  I: () => import("./I_comercial"),
  J: () => import("./J_operacao"),
  K: () => import("./K_fiscal"),
  L: () => import("./L_gestao"),
  M: () => import("./M_integracoes"),
  N: () => import("./N_admin"),
};

const cache = new Map<string, ComponentType>();
/** Carrega a tela sob demanda (estado "carregando" real via Suspense). */
export function screenComponent(code: string): ComponentType {
  let c = cache.get(code);
  if (!c) {
    c = lazy(async () => {
      const mod = await LOADERS[code[0]]();
      const comp = mod.screens[code];
      if (!comp) throw new Error(`Tela ${code} não implementada`);
      return { default: comp };
    });
    cache.set(code, c);
  }
  return c;
}
