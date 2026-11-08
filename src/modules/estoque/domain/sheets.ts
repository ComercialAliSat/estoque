// Exportação Excel/CSV sem dependências externas.
const BOM = String.fromCharCode(0xfeff);
export type Cell = string | number | null | undefined;

function esc(v: Cell): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: Cell[][]): string {
  return BOM + [headers, ...rows].map((r) => r.map(esc).join(";")).join("\r\n");
}

function html(v: Cell): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** .xls em HTML: abre direto no Excel. */
export function toXls(headers: string[], rows: Cell[][], title = "Planilha"): string {
  const th = headers.map((h) => `<th>${html(h)}</th>`).join("");
  const body = rows.map((r) => `<tr>${r.map((c) => `<td>${html(c)}</td>`).join("")}</tr>`).join("");
  return `<html><head><meta charset="utf-8"><title>${html(title)}</title></head><body><table border="1"><tr>${th}</tr>${body}</table></body></html>`;
}

/** Lê CSV simples (separador ; ou ,) para importações com prévia. */
export function parseCsv(text: string): string[][] {
  const clean = text.startsWith(BOM) ? text.slice(1) : text;
  const sep = clean.split("\n")[0]?.includes(";") ? ";" : ",";
  return clean
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, "")));
}
