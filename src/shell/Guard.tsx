import type { ReactNode } from "react";
import { NoPermission } from "../modules/estoque/components/ui";
import type { ScreenDef } from "../modules/estoque/screens/registry";
import { useCtx } from "../modules/estoque/session";
import { useDb } from "../modules/estoque/data/store";

/** Confere a área da pessoa. A conferência definitiva é no servidor (RLS); aqui evita mostrar telas sem acesso. */
export function Guard({ screen, children }: { screen: ScreenDef; children: ReactNode }) {
  const ctx = useCtx();
  const db = useDb();
  void db;
  if (!ctx.company && !ctx.isGroup) return <NoPermission what="Você não tem empresa liberada." />;
  if (screen.adminOnly && !ctx.isAdmin) return <NoPermission what="Esta tela é só para administradores." />;
  if (screen.area !== "geral" && !ctx.can(screen.area, "ver")) return <NoPermission />;
  return <>{children}</>;
}
