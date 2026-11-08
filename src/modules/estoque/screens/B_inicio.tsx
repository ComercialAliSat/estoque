import { useMemo, useState, type ComponentType } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Badge, Btn, Card, Empty, LinkBtn, Modal, PageHeader, Field, Textarea, useAct } from "../components/ui";
import { overdueTransfers } from "../domain/logistics";
import { audit } from "../domain/core";
import { to, p } from "../routes";
import { useCtx } from "../session";
import { dt } from "../format";

// ---- B01 ----
function B01() {
  const ctx = useCtx();
  const { db, companyIds } = ctx;
  const inScope = <T extends { companyId: string }>(rows: T[]) => rows.filter((r) => companyIds.includes(r.companyId));
  const cards = useMemo(() => {
    const out: { label: string; value: number; to: string; area: "estoque" | "fiscal" | "operacoes"; tone: "amber" | "red" | "blue" | "gray" }[] = [
      { label: "Entradas a conferir", value: inScope(db.inbounds).filter((i) => i.status !== "fechada" && i.status !== "estornada").length, to: "/estoque/entradas", area: "estoque", tone: "amber" },
      { label: "Notas com erro ou não transmitidas", value: inScope(db.invoices).filter((i) => i.status === "com_erro" || i.status === "nao_transmitida").length, to: "/fiscal/notas?situacao=erro", area: "fiscal", tone: "red" },
      { label: "Reservas do CRM", value: inScope(db.reservations).filter((r) => r.status === "reservada").length, to: "/comercial/reservas", area: "operacoes", tone: "blue" },
      { label: "OS abertas", value: inScope(db.workOrders).filter((o) => o.status === "aberta" || o.status === "em_execucao").length, to: "/os", area: "operacoes", tone: "blue" },
      { label: "Transferências em trânsito", value: inScope(db.transfers).filter((t) => t.status === "em_transito").length, to: "/estoque/transferencias/transito", area: "estoque", tone: "amber" },
      { label: "Itens em quarentena", value: db.serials.filter((s) => companyIds.includes(s.ownerCompanyId) && s.technical === "quarentena").length, to: "/assistencia", area: "operacoes", tone: "amber" },
    ];
    return out.filter((c) => ctx.can(c.area, "ver"));
     
  }, [db, companyIds.join(",")]);
  return (
    <>
      <PageHeader code="B01" title="Painel inicial" subtitle={ctx.isGroup ? "Visão Grupo (somente leitura)" : ctx.company?.name}
        actions={ctx.isAdmin ? <LinkBtn to={p("/pendencias/decisoes")}>Pontos a confirmar</LinkBtn> : undefined} />
      {cards.length === 0 ? <Empty text="Nenhuma informação liberada para a sua área." /> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((c) => (
            <Link key={c.label} to={p(c.to)} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-sky-500">
              <div className="text-sm text-slate-600">{c.label}</div>
              <div className="mt-1 text-3xl font-semibold tabular-nums">{c.value}</div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

// ---- B02 ----
function B02() {
  const ctx = useCtx();
  const [sp] = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const term = q.trim().toLowerCase();
  const { db, companyIds } = ctx;
  const res = useMemo(() => {
    if (term.length < 3) return null;
    const has = (...v: (string | undefined | null)[]) => v.some((x) => x && x.toLowerCase().includes(term));
    const custName = (id?: string) => db.customers.find((c) => c.id === id)?.name ?? "";
    return {
      Equipamentos: ctx.can("estoque", "ver") ? db.serials.filter((s) => companyIds.includes(s.ownerCompanyId) && has(s.serial, s.iccid)).map((s) => ({ k: s.id, label: s.serial, sub: db.products.find((x) => x.id === s.productId)?.name ?? "", to: to("/estoque/equipamentos/:id", { id: s.id }) })) : [],
      Produtos: db.products.filter((x) => has(x.code, x.name)).map((x) => ({ k: x.id, label: x.name, sub: x.code, to: to("/cadastros/produtos/:id", { id: x.id }) })),
      Clientes: db.customers.filter((c) => c.companyIds.some((id) => companyIds.includes(id)) && has(c.name, c.document)).map((c) => ({ k: c.id, label: c.name, sub: c.document, to: to("/cadastros/clientes/:id", { id: c.id }) })),
      Notas: ctx.can("fiscal", "ver") ? db.invoices.filter((i) => companyIds.includes(i.companyId) && has(i.key, String(i.number ?? ""))).map((i) => ({ k: i.id, label: `Nota ${i.number ?? "(rascunho)"}`, sub: i.key ?? "", to: to("/fiscal/notas/:id", { id: i.id }) })) : [],
      "Ordens de serviço": ctx.can("operacoes", "ver") ? db.workOrders.filter((o) => companyIds.includes(o.companyId) && has(o.number, o.plate)).map((o) => ({ k: o.id, label: o.number, sub: `${o.plate} · ${custName(o.customerId)}`, to: to("/os/:id", { id: o.id }) })) : [],
      Contratos: ctx.can("operacoes", "ver") ? db.contracts.filter((c) => companyIds.includes(c.companyId) && has(c.number, custName(c.customerId))).map((c) => ({ k: c.id, label: c.number, sub: custName(c.customerId), to: to("/comercial/contratos/:id", { id: c.id }) })) : [],
      Chips: ctx.can("operacoes", "ver") ? db.chips.filter((c) => companyIds.includes(c.companyId) && has(c.iccid)).map((c) => ({ k: c.id, label: c.iccid, sub: c.operator, to: to("/operacao/chips/:id", { id: c.id }) })) : [],
      "Veículos (placa)": ctx.can("operacoes", "ver") ? [...new Set(db.links.filter((l) => companyIds.includes(l.companyId) && has(l.plate)).map((l) => l.plate!))].map((pl) => ({ k: pl, label: pl, sub: "Ficha do veículo", to: to("/operacao/veiculos/:id", { id: pl }) })) : [],
    } as Record<string, { k: string; label: string; sub: string; to: string }[]>;
  }, [term, db, companyIds, ctx]);
  return (
    <>
      <PageHeader code="B02" title="Busca global" subtitle="Série, ICCID, produto, cliente, CNPJ/CPF, chave ou número da nota, OS, contrato, placa." />
      <div className="mb-4 max-w-xl"><input autoFocus className="w-full rounded-md border border-slate-300 px-3 py-2" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Digite ao menos 3 caracteres" aria-label="Termo de busca" /></div>
      {!res ? <Empty text="Digite ao menos 3 caracteres para buscar." /> : Object.values(res).every((v) => v.length === 0) ? <Empty text="Nada encontrado para esse termo nas suas empresas." /> : (
        <div className="space-y-3">
          {Object.entries(res).filter(([, v]) => v.length).map(([g, v]) => (
            <Card key={g} title={`${g} (${v.length})`}>
              <ul className="divide-y divide-slate-100 text-sm">
                {v.slice(0, 20).map((r) => (
                  <li key={r.k} className="flex justify-between py-1.5"><Link className="font-medium text-sky-800 hover:underline" to={p(r.to)}>{r.label}</Link><span className="text-slate-500">{r.sub}</span></li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

// ---- B03 ----
const SEEN_KEY = "estoque.pendencias.vistas";
function loadSeen(): string[] {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]"); } catch { return []; }
}
function B03() {
  const ctx = useCtx();
  const { db, companyIds } = ctx;
  const [seen, setSeen] = useState<string[]>(loadSeen);
  const mark = (id: string) => {
    const n = [...new Set([...seen, id])];
    setSeen(n);
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(n)); } catch { /* ignora */ }
  };
  const items: { id: string; text: string; to: string; kind: string }[] = [];
  const scoped = (cid: string) => companyIds.includes(cid);
  if (ctx.isAdmin) {
    db.losses.filter((l) => l.status === "pendente" && l.requestedBy !== ctx.user.id && scoped(l.companyId)).forEach((l) => items.push({ id: l.id, kind: "Aprovação", text: `Baixa por perda de ${l.serials.length} série(s): ${l.reason}`, to: "/estoque/perdas" }));
    db.inbounds.filter((i) => scoped(i.companyId)).forEach((i) => i.divergences.filter((d) => d.status === "pendente" && d.requestedBy !== ctx.user.id).forEach((d) => items.push({ id: d.id, kind: "Aprovação", text: `Divergência (${d.kind}) na entrada ${i.number}`, to: to("/estoque/entradas/:id/divergencias", { id: i.id }) })));
    db.events.filter((e) => e.status === "erro").forEach((e) => items.push({ id: e.id, kind: "Integração", text: `Evento ${e.type} com falha: ${e.error ?? ""}`, to: "/integracoes/fila" }));
  }
  db.invoices.filter((i) => scoped(i.companyId) && (i.status === "com_erro" || i.status === "nao_transmitida")).forEach((i) => items.push({ id: i.id, kind: "Nota", text: `Nota ${i.status.replace("_", " ")}`, to: to("/fiscal/notas/:id", { id: i.id }) }));
  db.inbounds.filter((i) => scoped(i.companyId) && (i.status === "em_conferencia" || i.status === "divergente")).forEach((i) => items.push({ id: `conf_${i.id}`, kind: "Conferência", text: `Conferência parada: ${i.number}`, to: to("/estoque/entradas/:id/conferencia", { id: i.id }) }));
  overdueTransfers(db).filter((t) => scoped(t.companyId)).forEach((t) => items.push({ id: `tr_${t.id}`, kind: "Trânsito", text: `Transferência atrasada (${t.serials.length} série(s))`, to: "/estoque/transferencias/transito" }));
  return (
    <>
      <PageHeader code="B03" title="Pendências e avisos" subtitle="Marcar como visto não resolve a pendência." />
      {items.length === 0 ? <Empty text="Nenhuma pendência. Tudo em dia." /> : (
        <Card>
          <ul className="divide-y divide-slate-100">
            {items.map((it) => (
              <li key={it.id} className={`flex items-center justify-between gap-3 py-2 text-sm ${seen.includes(it.id) ? "opacity-60" : ""}`}>
                <span><Badge tone="amber">{it.kind}</Badge> <Link className="ml-2 text-sky-800 hover:underline" to={p(it.to)}>{it.text}</Link></span>
                {seen.includes(it.id) ? <Badge>visto</Badge> : <Btn variant="ghost" onClick={() => mark(it.id)}>Marcar como visto</Btn>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

// ---- B04 ----
function B04() {
  const ctx = useCtx();
  const act = useAct();
  const [target, setTarget] = useState<string | null>(null);
  const [note, setNote] = useState("");
  return (
    <>
      <PageHeader code="B04" title="Pontos a confirmar" subtitle="Pontos em aberto da especificação, com o padrão assumido e a tela de ajuste. Marcar como decidido não muda o comportamento sozinho."
        actions={<LinkBtn to={p("")}>Voltar</LinkBtn>} />
      <div className="space-y-3">
        {ctx.db.decisions.map((d) => (
          <Card key={d.id} title={<>{d.title} {d.decided ? <Badge tone="green">decidido</Badge> : <Badge tone="amber">em aberto</Badge>}</>}
            actions={<><LinkBtn to={d.screen.startsWith("/app") ? p(d.screen.slice(4)) : d.screen}>Ir para a tela de ajuste</LinkBtn>{!d.decided && <Btn onClick={() => setTarget(d.id)}>Marcar como decidido</Btn>}</>}>
            <p className="text-sm"><strong>Padrão assumido:</strong> {d.assumed}</p>
            {d.decided && <p className="mt-1 text-xs text-slate-500">Decidido por {ctx.db.profiles.find((x) => x.id === d.decidedBy)?.name} em {dt(d.decidedAt)}. Anotação: {d.note}</p>}
          </Card>
        ))}
      </div>
      {target && (
        <Modal title="Marcar como decidido" onClose={() => setTarget(null)}>
          <Field label="Anotação (o que foi decidido)"><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="mt-4 flex justify-end gap-2">
            <Btn variant="secondary" onClick={() => setTarget(null)}>Cancelar</Btn>
            <Btn disabled={!note.trim()} onClick={() => {
              act((db) => {
                const d = db.decisions.find((x) => x.id === target)!;
                d.decided = true; d.note = note.trim(); d.decidedBy = ctx.user.id; d.decidedAt = new Date().toISOString();
                audit(db, ctx.user.id, "decisao.registrada", d.id, undefined, note);
              }, { ok: "Decisão registrada." });
              setTarget(null); setNote("");
            }}>Salvar</Btn>
          </div>
        </Modal>
      )}
    </>
  );
}

export const screens: Record<string, ComponentType> = { B01, B02, B03, B04 };
