import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { GROUP, useCtx } from "../modules/estoque/session";
import { MENU_ORDER, SCREENS } from "../modules/estoque/screens/registry";
import { BASE, p } from "../modules/estoque/routes";
import { Btn } from "../modules/estoque/components/ui";
import { overdueTransfers } from "../modules/estoque/domain/logistics";
import { resetDemo } from "../modules/estoque/data/store";

export function Layout() {
  const ctx = useCtx();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(true);
  const pend = pendingCount(ctx.db, ctx.isAdmin, ctx.user.id);
  const mine = ctx.db.companies.filter((c) => ctx.user.companyIds.includes(c.id));

  return (
    <div className="flex min-h-screen">
      <aside className={`${open ? "w-60" : "w-0 overflow-hidden"} shrink-0 border-r border-slate-200 bg-slate-900 text-slate-100 transition-all`}>
        <div className="px-4 py-4 text-sm font-semibold">Gestão Integrada<br /><span className="text-xs font-normal text-slate-400">Ali Sat · Estoque</span></div>
        <nav className="space-y-3 px-2 pb-6 text-sm">
          {MENU_ORDER.map((group) => {
            const items = SCREENS.filter((s) => s.menu === group && (!s.adminOnly || ctx.isAdmin) && (s.area === "geral" || ctx.can(s.area, "ver")));
            if (items.length === 0) return null;
            return (
              <div key={group}>
                <div className="px-2 pb-1 text-[11px] uppercase tracking-wider text-slate-400">{group}</div>
                {items.map((s) => (
                  <NavLink
                    key={s.code}
                    end={s.paths[0] === ""}
                    to={p(s.paths[0])}
                    className={({ isActive }) => `block rounded px-2 py-1.5 ${isActive ? "bg-sky-700 text-white" : "text-slate-200 hover:bg-slate-800"}`}
                  >
                    {s.title}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
          <Btn variant="ghost" onClick={() => setOpen(!open)} aria-label="Alternar menu">☰</Btn>
          <div className="flex items-center gap-2" aria-label="Empresa atual">
            <span className="text-xs text-slate-500">Empresa</span>
            <select
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm font-semibold"
              value={ctx.companyId}
              onChange={(e) => { ctx.setCompany(e.target.value); nav(BASE); }}
            >
              {mine.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              {mine.length > 1 && ctx.isAdmin && <option value={GROUP}>Grupo (somente leitura)</option>}
            </select>
          </div>
          <form className="flex-1" onSubmit={(e) => { e.preventDefault(); if (q.trim().length >= 3) nav(`${p("/busca")}?q=${encodeURIComponent(q.trim())}`); }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar série, ICCID, produto, cliente, nota, OS, contrato, placa (mín. 3 caracteres)"
              className="w-full max-w-xl rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              aria-label="Busca global"
            />
          </form>
          <Link to={p("/pendencias")} className="relative rounded-md px-2 py-1 text-sm hover:bg-slate-100" aria-label="Pendências">
            🔔{pend > 0 && <span className="ml-1 rounded-full bg-red-600 px-1.5 text-xs text-white">{pend}</span>}
          </Link>
          <Link to={p("/perfil")} className="text-sm text-slate-700 hover:underline">{ctx.user.name}</Link>
          <Btn variant="secondary" onClick={() => { ctx.logout(); nav("/login"); }}>Sair</Btn>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4">
          <Outlet />
        </main>
        <footer className="no-print border-t border-slate-200 px-4 py-2 text-xs text-slate-500">
          Modo demonstração: dados simulados neste navegador.{" "}
          <button className="underline" onClick={() => { if (confirm("Restaurar os dados de demonstração? Isso apaga o que você fez neste navegador.")) resetDemo(); }}>
            Restaurar dados de demonstração
          </button>
        </footer>
      </div>
    </div>
  );
}

function pendingCount(db: import("../modules/estoque/domain/types").Db, isAdmin: boolean, userId: string) {
  let n = 0;
  if (isAdmin) {
    n += db.losses.filter((l) => l.status === "pendente" && l.requestedBy !== userId).length;
    n += db.inbounds.flatMap((i) => i.divergences).filter((d) => d.status === "pendente" && d.requestedBy !== userId).length;
  }
  n += db.invoices.filter((i) => i.status === "com_erro" || i.status === "nao_transmitida").length;
  n += db.events.filter((e) => e.status === "erro").length;
  n += overdueTransfers(db).length;
  return n;
}
