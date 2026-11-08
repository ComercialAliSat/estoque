// Passagem de leituras entre o leitor universal (F05) e a operação de origem (G03, G11, H05).
import type { ScanMode } from "./domain/mothercode";

const KEY = "estoque.leitura.pendente";
export interface PendingScan {
  mode: ScanMode;
  serials: string[];
  returnTo: string;
}

export function setPending(v: PendingScan) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* ignora */
  }
}

/** Consome (e apaga) as leituras pendentes do modo informado. */
export function takePending(mode: ScanMode): PendingScan | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as PendingScan;
    if (v.mode !== mode) return null;
    sessionStorage.removeItem(KEY);
    return v;
  } catch {
    return null;
  }
}
