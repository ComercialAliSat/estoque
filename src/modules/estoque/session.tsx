import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useDb } from "./data/store";
import { authPort, loadSession, saveSession } from "./integrations/auth";
import { can as canFn, canSeeCost, visibleCompanies } from "./domain/permissions";
import type { Action, Area, Company, Db, Profile } from "./domain/types";

export const GROUP = "grupo";

export interface Ctx {
  db: Db;
  user: Profile;
  companyId: string; // id ou "grupo"
  company: Company | null;
  companyIds: string[]; // empresas em escopo (uma, ou todas na visão Grupo)
  isGroup: boolean;
  readOnly: boolean; // visão Grupo é só leitura
  isAdmin: boolean;
  seeCost: boolean;
  can: (area: Area, action: Action) => boolean;
  setCompany: (id: string) => void;
  logout: () => void;
}

interface Session {
  user: Profile | null;
  companyId: string | null;
  signedIn: (userId: string) => void;
  setCompany: (id: string) => void;
  logout: () => void;
}

const SessionCtx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const db = useDb();
  const [stored, setStored] = useState(() => loadSession());
  const user = stored ? (db.profiles.find((p) => p.id === stored.userId && p.active) ?? null) : null;

  const signedIn = useCallback((userId: string) => {
    const s = { userId, companyId: undefined };
    saveSession(userId);
    setStored(s);
  }, []);
  const setCompany = useCallback((id: string) => {
    setStored((cur) => {
      if (!cur) return cur;
      saveSession(cur.userId, id);
      return { ...cur, companyId: id };
    });
  }, []);
  const logout = useCallback(() => {
    void authPort.signOut();
    setStored(null);
  }, []);

  const value = useMemo<Session>(
    () => ({ user, companyId: stored?.companyId ?? null, signedIn, setCompany, logout }),
    [user, stored, signedIn, setCompany, logout],
  );
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSession(): Session {
  const s = useContext(SessionCtx);
  if (!s) throw new Error("SessionProvider ausente");
  return s;
}

/** Contexto de trabalho (usuário + empresa atual). Só use dentro de telas autenticadas. */
export function useCtx(): Ctx {
  const db = useDb();
  const { user, companyId, setCompany, logout } = useSession();
  if (!user) throw new Error("Sem usuário na sessão");
  const mine = visibleCompanies(db, user);
  const cid = companyId && (companyId === GROUP || mine.some((c) => c.id === companyId)) ? companyId : (mine[0]?.id ?? "");
  const isGroup = cid === GROUP;
  const companyIds = isGroup ? mine.map((c) => c.id) : cid ? [cid] : [];
  const company = isGroup ? null : (mine.find((c) => c.id === cid) ?? null);
  return {
    db,
    user,
    companyId: cid,
    company,
    companyIds,
    isGroup,
    readOnly: isGroup,
    isAdmin: user.role === "admin",
    seeCost: companyIds.some((id) => canSeeCost(user, id)),
    can: (area, action) => !isGroup || action === "ver" ? companyIds.some((id) => canFn(user, id, area, action)) : false,
    setCompany,
    logout,
  };
}
