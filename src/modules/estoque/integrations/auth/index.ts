import { getDb } from "../../data/store";
import type { AuthPort } from "../ports";

export const DEMO_PASSWORD = "demo123";
export const DEMO_MFA = "000000";
const KEY = "estoque.demo.session.v1";

/**
 * Autenticação SIMULADA (modo demo). O Argos troca esta implementação por Supabase Auth (com TOTP real).
 * Senha e código fixos só existem no modo demo; nenhum segredo real está no repositório.
 */
export const demoAuth: AuthPort = {
  async signIn(email, password) {
    const p = getDb().profiles.find((x) => x.email.toLowerCase() === email.trim().toLowerCase());
    if (!p || password !== DEMO_PASSWORD) return { error: "E-mail ou senha incorretos" };
    if (!p.active) return { error: "Acesso desativado. Fale com o administrador." };
    return { userId: p.id, needsMfa: p.role === "admin" };
  },
  async verifyMfa(_userId, code) {
    return code === DEMO_MFA;
  },
  async signOut() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignora */
    }
  },
  currentUserId() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as { userId: string }).userId : null;
    } catch {
      return null;
    }
  },
  async listUsers() {
    return getDb().profiles.map((p) => ({ id: p.id, name: p.name, email: p.email }));
  },
};

export function saveSession(userId: string, companyId?: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ userId, companyId }));
  } catch {
    /* ignora */
  }
}
export function loadSession(): { userId: string; companyId?: string } | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export const authPort: AuthPort = demoAuth;
