import type { Db, Id, Movement, Serial, SerialHistory } from "./types";

export class DomainError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "DomainError";
  }
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function nowIso(): string {
  return new Date().toISOString();
}

export function nextId(db: Db, prefix: string): Id {
  db.seq += 1;
  return `${prefix}_${db.seq.toString(36).padStart(4, "0")}`;
}

/** Executa tudo ou nada: se algo falhar, o estado volta ao que era (usado em fechar conferência etc.). */
export function atomic<T>(db: Db, fn: () => T): T {
  const snapshot = structuredClone(db);
  try {
    return fn();
  } catch (e) {
    for (const k of Object.keys(snapshot) as (keyof Db)[]) {
      (db as any)[k] = (snapshot as any)[k];
    }
    throw e;
  }
}

/** Operações críticas idempotentes: a mesma chave devolve o resultado guardado, sem repetir efeito. */
export function idempotent<T>(db: Db, key: string, fn: () => T): T {
  if (key in db.idempotency) return db.idempotency[key] as T;
  const result = atomic(db, fn);
  db.idempotency[key] = result;
  return result;
}

export function audit(db: Db, by: string, action: string, ref: string, companyId?: Id, detail?: string) {
  db.audit.push({ id: nextId(db, "aud"), at: nowIso(), by, companyId, action, ref, detail });
}

export function findSerial(db: Db, code: string): Serial | undefined {
  const norm = normalizeCode(code);
  return db.serials.find((s) => s.serial === norm);
}

export function mustSerial(db: Db, code: string): Serial {
  const s = findSerial(db, code);
  if (!s) throw new DomainError("serie_inexistente", `Série ${normalizeCode(code)} não encontrada.`);
  return s;
}

export function normalizeCode(code: string): string {
  return code.trim().replace(/\s+/g, "").toUpperCase();
}

type SerialPatch = Partial<
  Pick<Serial, "ownerCompanyId" | "locationId" | "custody" | "commercial" | "technical" | "cost">
>;
const FIELD_NAME: Record<keyof SerialPatch, SerialHistory["field"]> = {
  ownerCompanyId: "dono",
  locationId: "local",
  custody: "custodia",
  commercial: "comercial",
  technical: "tecnica",
  cost: "custo",
};

/** Altera atributos da série e registra histórico por data (dono, local, custódia etc. são campos separados). */
export function updateSerial(db: Db, s: Serial, patch: SerialPatch, by: string, ref: string) {
  for (const key of Object.keys(patch) as (keyof SerialPatch)[]) {
    const next = patch[key];
    const prev = s[key];
    if (next === prev) continue;
    db.serialHistory.push({
      id: nextId(db, "sh"),
      serialId: s.id,
      at: nowIso(),
      by,
      field: FIELD_NAME[key],
      from: String(prev ?? ""),
      to: String(next ?? ""),
      ref,
    });
    (s as any)[key] = next;
  }
}

/**
 * Razão de movimentações: só acrescenta (imutável). Saldo nunca é atualizado direto.
 * RN-011: nenhuma saída sem desfecho — sem local de destino exige `outcome`.
 */
export function postMovement(db: Db, m: Omit<Movement, "id" | "at">): Movement {
  if (db.movements.some((x) => x.idempotencyKey === m.idempotencyKey)) {
    return db.movements.find((x) => x.idempotencyKey === m.idempotencyKey)!;
  }
  if (m.qty <= 0) throw new DomainError("qtd_invalida", "Quantidade deve ser positiva.");
  if (!m.fromLocationId && !m.toLocationId) {
    throw new DomainError("mov_sem_local", "Movimento precisa de origem ou destino.");
  }
  if (m.fromLocationId && !m.toLocationId && !m.outcome) {
    throw new DomainError("sem_desfecho", "Não existe saída sem desfecho (RN-011): informe o desfecho da saída.");
  }
  const mov: Movement = Object.freeze({ ...m, id: nextId(db, "mov"), at: nowIso() }) as Movement;
  db.movements.push(mov);
  return mov;
}

/** Estorno: movimento contrário que aponta para o original; o original nunca é editado. */
export function reverseMovement(db: Db, movementId: Id, by: string, reason: string): Movement {
  const orig = db.movements.find((m) => m.id === movementId);
  if (!orig) throw new DomainError("mov_inexistente", "Movimento não encontrado.");
  if (!reason.trim()) throw new DomainError("motivo", "Estorno exige motivo.");
  if (db.movements.some((m) => m.reversalOf === movementId)) {
    throw new DomainError("ja_estornado", "Movimento já estornado.");
  }
  return postMovement(db, {
    companyId: orig.companyId,
    productId: orig.productId,
    serialId: orig.serialId,
    qty: orig.qty,
    kind: "estorno",
    fromLocationId: orig.toLocationId,
    toLocationId: orig.fromLocationId,
    outcome: orig.toLocationId ? "ajuste" : undefined,
    refType: orig.refType,
    refId: orig.refId,
    idempotencyKey: `estorno:${movementId}`,
    reason,
    by,
    reversalOf: movementId,
  });
}

/** Saldo derivado do razão (nunca gravado). */
export function balance(db: Db, companyId: Id, productId: Id, locationId?: Id): number {
  let total = 0;
  for (const m of db.movements) {
    if (m.companyId !== companyId || m.productId !== productId) continue;
    if (locationId) {
      if (m.toLocationId === locationId) total += m.qty;
      if (m.fromLocationId === locationId) total -= m.qty;
    } else {
      // saldo da empresa: soma só locais da empresa (entradas e saídas externas)
      if (m.toLocationId) total += m.qty;
      if (m.fromLocationId) total -= m.qty;
    }
  }
  return total;
}

export function locationById(db: Db, id: Id | null | undefined) {
  return id ? db.locations.find((l) => l.id === id) : undefined;
}

export function isAdmin(db: Db, userId: Id): boolean {
  return db.profiles.find((p) => p.id === userId)?.role === "admin";
}

export function requireAdmin(db: Db, userId: Id, what: string) {
  if (!isAdmin(db, userId)) {
    throw new DomainError("somente_admin", `Somente administradores podem ${what}.`);
  }
}
