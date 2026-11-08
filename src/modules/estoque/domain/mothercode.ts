import { DomainError, findSerial, nextId, nowIso, normalizeCode } from "./core";
import { eligibilityProblem } from "./sales";
import type { Db, Id, MotherCode } from "./types";

export const MAX_PER_VOLUME = 200;
const PREFIX = "MC1";

/** Hash FNV-1a 32 bits em base36 (integridade do manifesto; não é segredo). */
export function manifestHash(serials: string[]): string {
  const text = [...serials].sort().join("|");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).toUpperCase().padStart(7, "0");
}

export function parseSerialList(raw: string) {
  const list = raw.split(/[\s,;]+/).map(normalizeCode).filter(Boolean);
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const unique: string[] = [];
  for (const s of list) {
    if (seen.has(s)) duplicates.push(s);
    else {
      seen.add(s);
      unique.push(s);
    }
  }
  return { unique, duplicates };
}

export function previewMotherCode(db: Db, serials: string[]) {
  const invalid = serials.filter((s) => !findSerial(db, s));
  const inOtherCode = serials.filter((s) =>
    db.motherCodes.some((m) => m.status === "ativo" && m.serials.includes(s)),
  );
  const volumes = Math.max(1, Math.ceil(serials.length / MAX_PER_VOLUME));
  return { invalid, inOtherCode, volumes, tokenLength: PREFIX.length + 1 + 7 + 1 + 4 };
}

/** Gerar o código-mãe NÃO movimenta estoque. Divide em volumes se passar da capacidade. */
export function generateMotherCodes(
  db: Db,
  input: { companyId: Id; productId: Id; box: string; serials: string[] },
): MotherCode[] {
  const { unique } = parseSerialList(input.serials.join(" "));
  const pv = previewMotherCode(db, unique);
  if (pv.invalid.length) throw new DomainError("serie_invalida", `Séries inexistentes: ${pv.invalid.join(", ")}.`);
  if (unique.length === 0) throw new DomainError("vazio", "Informe as séries.");
  const out: MotherCode[] = [];
  for (let i = 0; i < unique.length; i += MAX_PER_VOLUME) {
    const chunk = unique.slice(i, i + MAX_PER_VOLUME);
    const n = db.motherCodes.length + 1;
    const mc: MotherCode = {
      id: nextId(db, "mc"),
      companyId: input.companyId,
      token: `${PREFIX}-${manifestHash(chunk)}-${String(n).padStart(4, "0")}`,
      box: pv.volumes > 1 ? `${input.box} (${out.length + 1}/${pv.volumes})` : input.box,
      productId: input.productId,
      version: 1,
      serials: chunk,
      status: "ativo",
      createdAt: nowIso(),
    };
    db.motherCodes.push(mc);
    out.push(mc);
  }
  return out;
}

export function cancelMotherCode(db: Db, id: Id) {
  const m = db.motherCodes.find((x) => x.id === id);
  if (!m) throw new DomainError("codigo", "Código-mãe não encontrado.");
  m.status = "cancelado";
}

export type ScanMode = "conferencia" | "saida" | "transferencia" | "inventario" | "consulta";

export interface ScanResult {
  kind: "serie" | "codigo_mae" | "desconhecido";
  serials: string[];
  issues: { serial?: string; message: string }[];
  motherCode?: MotherCode;
}

/**
 * Leitor universal (F05). Confere versão, integridade, empresa e se todas as séries
 * existem e estão elegíveis. Nunca confirma movimento só pela leitura.
 */
export function resolveScan(db: Db, raw: string, mode: ScanMode, companyId: Id, already: string[] = []): ScanResult {
  const code = normalizeCode(raw);
  if (code.startsWith(PREFIX + "-")) {
    const mc = db.motherCodes.find((m) => m.token === code);
    if (!mc) return { kind: "codigo_mae", serials: [], issues: [{ message: "Código-mãe desconhecido." }] };
    const issues: ScanResult["issues"] = [];
    if (mc.status === "cancelado") issues.push({ message: "Código-mãe cancelado." });
    if (mc.companyId !== companyId) issues.push({ message: "Código-mãe de outra empresa." });
    if (mc.version !== 1) issues.push({ message: "Versão de código não suportada." });
    const expectedHash = code.split("-")[1];
    if (manifestHash(mc.serials) !== expectedHash) issues.push({ message: "Integridade do manifesto falhou." });
    for (const s of mc.serials) {
      if (already.includes(s)) issues.push({ serial: s, message: "Série já lida (releitura)." });
      const ser = findSerial(db, s);
      if (!ser) {
        if (mode !== "conferencia") issues.push({ serial: s, message: "Série inexistente." });
        continue;
      }
      if (mode === "saida" || mode === "transferencia") {
        const p = eligibilityProblem(db, ser, companyId);
        if (p) issues.push({ serial: s, message: p });
      }
    }
    return { kind: "codigo_mae", serials: mc.serials, issues, motherCode: mc };
  }
  const ser = findSerial(db, code);
  if (ser) {
    const issues: ScanResult["issues"] = [];
    if (already.includes(code)) issues.push({ serial: code, message: "Série já lida (releitura)." });
    return { kind: "serie", serials: [code], issues };
  }
  if (mode === "conferencia") return { kind: "serie", serials: [code], issues: [] };
  return { kind: "desconhecido", serials: [], issues: [{ message: `Código ${code} não reconhecido.` }] };
}
