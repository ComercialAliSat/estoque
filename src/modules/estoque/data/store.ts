// Adaptador de dados "demo": o banco fica em memória e é persistido no localStorage.
// Todas as regras vêm de domain/ (funções puras e testadas). Para produção, o mesmo contrato
// é implementado sobre o Supabase (ver supabase/migrations) — decisão registrada em docs/decisions.md.
import { useSyncExternalStore } from "react";
import { DomainError, atomic } from "../domain/core";
import type { Db } from "../domain/types";
import { createSeedDb } from "./seed";

const KEY = "estoque.demo.db.v1";
let db: Db = load();
let version = 0;
const listeners = new Set<() => void>();

function load(): Db {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (raw) return JSON.parse(raw) as Db;
  } catch {
    /* ignora: cai no seed */
  }
  return createSeedDb();
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    /* sem armazenamento: segue em memória */
  }
}

function emit() {
  version += 1;
  persist();
  listeners.forEach((l) => l());
}

export function getDb(): Db {
  return db;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** Executa uma operação de domínio de forma atômica; em erro, nada muda e a mensagem vem em português. */
export function mutate<T>(fn: (db: Db) => T): Result<T> {
  try {
    const value = atomic(db, () => fn(db));
    emit();
    return { ok: true, value };
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Algo deu errado. Tente de novo; se continuar, avise o administrador." };
  }
}

export function resetDemo() {
  db = createSeedDb();
  emit();
}

export function useDb(): Db {
  useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
  );
  return db;
}
