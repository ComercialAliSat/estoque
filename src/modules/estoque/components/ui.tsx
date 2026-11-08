import {
  createContext, useCallback, useContext, useState,
  type ButtonHTMLAttributes, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import { mutate, type Result } from "../data/store";
import type { Db } from "../domain/types";
import { toCsv, toXls, type Cell } from "../domain/sheets";
import { download } from "../format";
import { useCtx } from "../session";

// ---------- Toast ----------
interface ToastApi {
  ok: (m: string) => void;
  err: (m: string) => void;
}
const ToastCtx = createContext<ToastApi>({ ok: () => {}, err: () => {} });
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; kind: "ok" | "err"; text: string }[]>([]);
  const push = useCallback((kind: "ok" | "err", text: string) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, kind, text }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), kind === "err" ? 8000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={{ ok: (m) => push("ok", m), err: (m) => push("err", m) }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2" role="status" aria-live="polite">
        {items.map((i) => (
          <div key={i.id} className={`rounded-lg px-4 py-3 text-sm shadow-lg ${i.kind === "ok" ? "bg-emerald-700 text-white" : "bg-red-700 text-white"}`}>
            {i.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Executa uma operação de domínio, mostra o resultado e opcionalmente navega. Clique duplo é ignorado enquanto roda. */
export function useAct() {
  const toast = useToast();
  const nav = useNavigate();
  return useCallback(
    <T,>(fn: (db: Db) => T, opts: { ok?: string | ((v: T) => string); go?: string | ((v: T) => string); then?: (v: T) => void } = {}): Result<T> => {
      const r = mutate(fn);
      if (!r.ok) {
        toast.err(r.error);
        return r;
      }
      if (opts.ok) toast.ok(typeof opts.ok === "function" ? opts.ok(r.value) : opts.ok);
      opts.then?.(r.value);
      if (opts.go) nav(typeof opts.go === "function" ? opts.go(r.value) : opts.go);
      return r;
    },
    [toast, nav],
  );
}

// ---------- Básicos ----------
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" };
export function Btn({ variant = "primary", className = "", ...p }: BtnProps) {
  const base = "inline-flex items-center justify-center gap-1 rounded-md px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50";
  const v = {
    primary: "bg-sky-700 text-white hover:bg-sky-800",
    secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
    danger: "bg-red-700 text-white hover:bg-red-800",
    ghost: "text-sky-800 hover:bg-sky-50",
  }[variant];
  return <button type="button" {...p} className={`${base} ${v} ${className}`} />;
}

export function LinkBtn({ to, children, variant = "secondary" }: { to: string; children: ReactNode; variant?: "primary" | "secondary" }) {
  const v = variant === "primary" ? "bg-sky-700 text-white hover:bg-sky-800" : "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50";
  return (
    <Link to={to} className={`inline-flex items-center rounded-md px-3 py-2 text-sm font-medium ${v}`}>
      {children}
    </Link>
  );
}

export function Card({ title, children, actions, className = "" }: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
          <div className="flex gap-2">{actions}</div>
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ code, title, subtitle, actions }: { code: string; title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <div className="text-xs font-mono text-slate-400">{code}</div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </div>
  );
}

const TONES = {
  gray: "bg-slate-100 text-slate-700",
  green: "bg-emerald-100 text-emerald-800",
  amber: "bg-amber-100 text-amber-900",
  red: "bg-red-100 text-red-800",
  blue: "bg-sky-100 text-sky-800",
};
export function Badge({ tone = "gray", children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>;
}

export const toneFor = (s: string): keyof typeof TONES =>
  /autoriz|fechad|conclu|recebid|ativo|aprovad|disponivel|liberad|ok|processado|finalizad|bom|novo|definitivo/i.test(s) ? "green"
  : /erro|rejeit|cancel|estorn|perdid|defeito|descart|inutil/i.test(s) ? "red"
  : /pendente|aguard|provis|quarentena|transito|trânsito|diverg|reservad|triagem|rascunho|conferencia|contando|revisao/i.test(s) ? "amber"
  : "gray";
export const StatusBadge = ({ s }: { s: string }) => <Badge tone={toneFor(s)}>{s.replace(/_/g, " ")}</Badge>;

// ---------- Formulário ----------
const inputCls = "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm focus:border-sky-600 focus:outline-none focus:ring-1 focus:ring-sky-600 disabled:bg-slate-100";
export function Field({ label, hint, children, className = "" }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block text-sm ${className}`}>
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}
export const Input = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={`${inputCls} ${p.className ?? ""}`} />;
export const Select = (p: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={`${inputCls} ${p.className ?? ""}`} />;
export const Textarea = (p: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={`${inputCls} ${p.className ?? ""}`} />;

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="max-h-[90vh] w-full max-w-lg overflow-auto rounded-xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold">{title}</h3>
          <Btn variant="ghost" onClick={onClose} aria-label="Fechar">✕</Btn>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Confirmação para ações que não voltam. */
export function ConfirmButton({ label, message, onConfirm, variant = "danger", disabled }: { label: string; message: string; onConfirm: () => void; variant?: "primary" | "danger" | "secondary"; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Btn variant={variant} disabled={disabled} onClick={() => setOpen(true)}>{label}</Btn>
      {open && (
        <Modal title="Confirmar" onClose={() => setOpen(false)}>
          <p className="mb-4 text-sm text-slate-700">{message}</p>
          <div className="flex justify-end gap-2">
            <Btn variant="secondary" onClick={() => setOpen(false)}>Voltar</Btn>
            <Btn variant={variant === "secondary" ? "primary" : variant} onClick={() => { setOpen(false); onConfirm(); }}>{label}</Btn>
          </div>
        </Modal>
      )}
    </>
  );
}

/** Pede um motivo (obrigatório) antes de executar. */
export function ReasonButton({ label, title, onSubmit, variant = "secondary", disabled, minLength = 1 }: { label: string; title?: string; onSubmit: (reason: string) => void; variant?: "primary" | "secondary" | "danger" | "ghost"; disabled?: boolean; minLength?: number }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <>
      <Btn variant={variant} disabled={disabled} onClick={() => setOpen(true)}>{label}</Btn>
      {open && (
        <Modal title={title ?? label} onClose={() => setOpen(false)}>
          <Field label="Motivo (obrigatório)">
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="mt-4 flex justify-end gap-2">
            <Btn variant="secondary" onClick={() => setOpen(false)}>Cancelar</Btn>
            <Btn disabled={reason.trim().length < minLength} onClick={() => { onSubmit(reason.trim()); setOpen(false); setReason(""); }}>Confirmar</Btn>
          </div>
        </Modal>
      )}
    </>
  );
}

// ---------- Estados ----------
export const Empty = ({ text, action }: { text: string; action?: ReactNode }) => (
  <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-600">
    <p className="mb-3">{text}</p>
    {action}
  </div>
);
export const Loading = () => <div className="p-8 text-center text-sm text-slate-500" role="status">Carregando…</div>;
export const ErrorBox = ({ text }: { text: string }) => (
  <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">{text}</div>
);
export const NoPermission = ({ what }: { what?: string }) => (
  <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900" role="alert">
    <strong>Sem permissão.</strong> {what ?? "Você não tem acesso a esta tela nesta empresa."} Fale com o administrador.
  </div>
);
export const ReadOnlyBanner = () => (
  <div className="mb-3 rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-700">Visão Grupo: somente leitura. Escolha uma empresa no topo para operar.</div>
);

// ---------- Tabela ----------
export interface Col<T> {
  h: string;
  cell: (r: T) => ReactNode;
  right?: boolean;
  export?: (r: T) => Cell;
}
export function DataTable<T>({ rows, cols, onRow, empty, keyOf }: { rows: T[]; cols: Col<T>[]; onRow?: (r: T) => string; empty?: ReactNode; keyOf?: (r: T, i: number) => string }) {
  if (rows.length === 0) return <>{empty ?? <Empty text="Nada por aqui ainda." />}</>;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>{cols.map((c) => <th key={c.h} className={`px-3 py-2 font-medium ${c.right ? "text-right" : ""}`}>{c.h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <tr key={keyOf ? keyOf(r, i) : i} className="hover:bg-slate-50">
              {cols.map((c, ci) => {
                const content = c.cell(r);
                const href = onRow?.(r);
                return (
                  <td key={c.h} className={`px-3 py-2 ${c.right ? "text-right tabular-nums" : ""}`}>
                    {ci === 0 && href ? <Link className="font-medium text-sky-800 hover:underline" to={href}>{content}</Link> : content}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Exportar Excel/CSV com registro em N10. */
export function ExportBar<T>({ name, rows, cols }: { name: string; rows: T[]; cols: Col<T>[] }) {
  const ctx = useCtx();
  const act = useAct();
  const exportable = cols.filter((c) => c.export);
  const run = (format: "csv" | "xls") => {
    const headers = exportable.map((c) => c.h);
    const data = rows.map((r) => exportable.map((c) => c.export!(r)));
    act(
      (db) => {
        db.exports.push({ id: `exp_${db.exports.length + 1}`, at: new Date().toISOString(), by: ctx.user.id, companyId: ctx.company?.id, screen: name, format, rows: rows.length });
      },
      { ok: `Arquivo gerado (${rows.length} linhas) e registrado em Exportações.` },
    );
    if (format === "csv") download(`${name}.csv`, toCsv(headers, data), "text/csv");
    else download(`${name}.xls`, toXls(headers, data, name), "application/vnd.ms-excel");
  };
  const allowed = ctx.isAdmin || ctx.can("estoque", "exportar") || ctx.can("financeiro", "exportar") || ctx.can("auditoria", "exportar") || ctx.can("fiscal", "exportar");
  return (
    <>
      <Btn variant="secondary" disabled={!allowed || rows.length === 0} onClick={() => run("csv")} title={allowed ? "" : "Sem permissão para exportar"}>CSV</Btn>
      <Btn variant="secondary" disabled={!allowed || rows.length === 0} onClick={() => run("xls")} title={allowed ? "" : "Sem permissão para exportar"}>Excel</Btn>
    </>
  );
}

export function Tabs({ tabs, value, onChange }: { tabs: string[]; value: string; onChange: (t: string) => void }) {
  return (
    <div className="mb-3 flex flex-wrap gap-1 border-b border-slate-200">
      {tabs.map((t) => (
        <button key={t} type="button" onClick={() => onChange(t)} className={`px-3 py-2 text-sm ${value === t ? "border-b-2 border-sky-700 font-semibold text-sky-800" : "text-slate-600 hover:text-slate-900"}`}>
          {t}
        </button>
      ))}
    </div>
  );
}

export function KV({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs uppercase tracking-wide text-slate-500">{k}</dt>
          <dd className="text-slate-900">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export const SIMULATED_BANNER = (
  <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">
    SIMULADA, sem valor fiscal — provedor de NF-e em modo de teste.
  </div>
);
