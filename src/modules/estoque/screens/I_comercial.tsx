import { useEffect, useState, type ComponentType } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Badge, Btn, Card, ConfirmButton, DataTable, Empty, ExportBar, Field, Input, KV, LinkBtn, PageHeader, ReadOnlyBanner, Select, StatusBadge, Textarea,
  useAct, useToast, type Col,
} from "../components/ui";
import { audit, findSerial, normalizeCode } from "../domain/core";
import { getCrm } from "../integrations/crm";
import { paybackMonths } from "../domain/costing";
import { createContract, registerComodatoReturn } from "../domain/logistics";
import { addOutboundSerial, createOutbound, eligibilityProblem, releaseReservation } from "../domain/sales";
import type { Contract, Db } from "../domain/types";
import { brl } from "../format";
import { dbIO } from "../data/store";
import { p, to } from "../routes";
import { useCtx } from "../session";

const custName = (db: Db, id?: string) => db.customers.find((c) => c.id === id)?.name ?? "—";

// ---- I01 ----
function I01() {
  const ctx = useCtx();
  const toast = useToast();
  const events = ctx.db.events.filter((e) => e.system === "crm" && e.type === "opportunity.won" && e.status !== "tratado" && !ctx.db.reservations.some((r) => r.crmOpportunityId === (e.payload as any)?.opportunityId && r.status !== "liberada"));
  const reservations = ctx.db.reservations.filter((r) => ctx.companyIds.includes(r.companyId));
  return (
    <>
      <PageHeader code="I01" title="Reservas do CRM" subtitle="Chegam por evento do CRM. Oportunidade cancelada no CRM libera a reserva." actions={<Btn variant="secondary" onClick={() => toast.ok("Lista atualizada.")}>Atualizar</Btn>} />
      {ctx.readOnly && <ReadOnlyBanner />}
      <Card title="Oportunidades ganhas aguardando reserva">
        <DataTable rows={events} cols={[
          { h: "Oportunidade", cell: (e) => (e.payload as any)?.opportunityId ?? e.id }, { h: "Cliente", cell: (e) => custName(ctx.db, (e.payload as any)?.customerId) },
          { h: "Itens", cell: (e) => ((e.payload as any)?.items ?? []).map((i: any) => `${i.qty}× ${ctx.db.products.find((x) => x.id === i.productId)?.name ?? "?"}`).join(", ") || "sem itens informados" },
          { h: "Evento", cell: (e) => <StatusBadge s={e.status} /> },
        ]} onRow={(e) => p(to("/comercial/reservas/:id", { id: e.id }))} empty={<p className="text-sm text-slate-500">Nenhuma oportunidade aguardando.</p>} />
      </Card>
      <Card title="Reservas" className="mt-3">
        <DataTable rows={reservations} cols={[{ h: "Reserva", cell: (r) => r.id }, { h: "Cliente", cell: (r) => custName(ctx.db, r.customerId) }, { h: "Séries", cell: (r) => r.serials.join(", ") }, { h: "Situação", cell: (r) => <StatusBadge s={r.status} /> }]} onRow={(r) => p(to("/comercial/reservas/:id", { id: r.id }))} empty={<p className="text-sm text-slate-500">Nenhuma reserva.</p>} />
      </Card>
    </>
  );
}

// ---- I02 ----
function I02() {
  const ctx = useCtx();
  const { id } = useParams();
  const act = useAct();
  const toast = useToast();
  const nav = useNavigate();
  const [picked, setPicked] = useState<string[]>([]);
  const [val, setVal] = useState("");
  const res = ctx.db.reservations.find((r) => r.id === id && ctx.companyIds.includes(r.companyId));
  const ev = ctx.db.events.find((e) => e.id === id);
  const payload = (ev?.payload ?? {}) as { opportunityId?: string; customerId?: string; value?: number; items?: { productId: string; qty: number }[] };
  const items = payload.items ?? [];
  const company = ctx.company;
  const suggestions = items.flatMap((it) => ctx.db.serials.filter((s) => company && s.productId === it.productId && !eligibilityProblem(ctx.db, s, company.id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, it.qty));
  useEffect(() => { if (ev && picked.length === 0 && suggestions.length) setPicked(suggestions.map((s) => s.serial));   }, [ev?.id]);
  if (res) {
    const cost = res.serials.reduce((a, s) => a + (findSerial(ctx.db, s)?.cost ?? 0), 0);
    return (
      <>
        <PageHeader code="I02" title={`Reserva ${res.id}`} subtitle={<StatusBadge s={res.status} />} actions={<>
          <LinkBtn to={p("/os/nova")}>Criar OS</LinkBtn><LinkBtn to={p("/estoque/saidas/nova")}>Emitir nota</LinkBtn>
          {res.status === "reservada" && <ConfirmButton label="Liberar reserva" message="Liberar as séries desta reserva?" disabled={ctx.readOnly} onConfirm={() => act((db) => releaseReservation(db, res.id, ctx.user.id), { ok: "Reserva liberada.", go: p("/comercial/reservas") })} />}</>} />
        <Card><KV items={[["Cliente", custName(ctx.db, res.customerId)], ["Oportunidade (CRM)", res.crmOpportunityId], ["Chave de idempotência", res.idempotencyKey], ["Custo das séries", ctx.seeCost ? brl(cost) : "oculto"]]} />
          <div className="mt-3"><DataTable rows={res.serials} cols={[{ h: "Série", cell: (s) => s }, ...(ctx.seeCost ? [{ h: "Custo", cell: (s: string) => brl(findSerial(ctx.db, s)?.cost), right: true }] : [])]} onRow={(s) => p(to("/estoque/equipamentos/:id", { id: findSerial(ctx.db, s)?.id ?? "" }))} /></div></Card>
      </>
    );
  }
  if (!ev) return <Empty text="Reserva ou oportunidade não encontrada." action={<LinkBtn to={p("/comercial/reservas")}>Voltar</LinkBtn>} />;
  const expected = items.reduce((a, i) => a + i.qty, 0);
  const cost = picked.reduce((a, s) => a + (findSerial(ctx.db, s)?.cost ?? 0), 0);
  const add = () => {
    const c = normalizeCode(val);
    const s = findSerial(ctx.db, c);
    if (!s || !company) return toast.err(`Série ${c} não encontrada.`);
    const prob = eligibilityProblem(ctx.db, s, company.id);
    if (prob) return toast.err(`Série ${c} indisponível: ${prob}.`);
    if (!picked.includes(c)) setPicked([...picked, c]);
    setVal("");
  };
  const reserve = async () => {
    if (!company) return;
    const crm = getCrm(dbIO, () => ctx.user.id);
    try {
      await crm.reserve({ companyId: company.id, idempotencyKey: `crm:${payload.opportunityId ?? ev.id}`, serials: picked, crmOpportunityId: payload.opportunityId ?? ev.id, customerId: payload.customerId });
      act((db) => { const e = db.events.find((x) => x.id === ev.id); if (e) { e.status = "processado"; e.attempts += 1; } audit(db, ctx.user.id, "reserva.crm", ev.id, company.id); }, { ok: "Reservada.", go: p("/comercial/reservas") });
    } catch (e) {
      toast.err((e as Error).message);
    }
  };
  return (
    <>
      <PageHeader code="I02" title={`Reservar séries — ${payload.opportunityId ?? ev.id}`} subtitle="Reserva por série específica (RN-018). Só séries disponíveis." actions={<><LinkBtn to={p("/os/nova")}>Criar OS</LinkBtn><LinkBtn to={p("/estoque/saidas/nova")}>Emitir nota</LinkBtn></>} />
      {ctx.readOnly && <ReadOnlyBanner />}
      <Card title="Itens do pedido"><ul className="text-sm">{items.map((i) => <li key={i.productId}>{i.qty} × {ctx.db.products.find((x) => x.id === i.productId)?.name}</li>)}{items.length === 0 && <li className="text-slate-500">O evento não trouxe itens: leia as séries.</li>}</ul>
        {ctx.seeCost && payload.value !== undefined && <p className="mt-2 text-sm">Valor do negócio no CRM: <strong>{brl(payload.value)}</strong> · custo das séries escolhidas: <strong>{brl(cost)}</strong> · margem prevista: <strong>{brl(payload.value - cost)}</strong> {payload.value ? `(${(((payload.value - cost) / payload.value) * 100).toFixed(1)}%)` : ""}</p>}</Card>
      <Card title={`Séries escolhidas (${picked.length}${expected ? ` de ${expected}` : ""})`} className="mt-3">
        <form className="mb-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}><Input className="max-w-sm font-mono" placeholder="Leia ou digite a série" value={val} onChange={(e) => setVal(e.target.value)} /><Btn type="submit" variant="secondary">Adicionar</Btn></form>
        <div className="flex flex-wrap gap-2">{picked.map((s) => <Badge key={s} tone="blue">{s} <button aria-label={`Remover ${s}`} onClick={() => setPicked(picked.filter((x) => x !== s))}>✕</button></Badge>)}</div>
        <div className="mt-4 flex gap-2"><Btn disabled={ctx.readOnly || picked.length === 0} onClick={reserve}>Reservar séries</Btn><Btn variant="secondary" onClick={() => nav(p("/comercial/reservas"))}>Voltar</Btn></div>
      </Card>
    </>
  );
}

// ---- I03 ----
function I03() {
  const ctx = useCtx();
  const [cust, setCust] = useState("");
  const rows = ctx.db.contracts.filter((c) => ctx.companyIds.includes(c.companyId) && (!cust || c.customerId === cust));
  return (
    <>
      <PageHeader code="I03" title="Contratos e comodatos" actions={!ctx.readOnly && ctx.can("operacoes", "criar") ? <LinkBtn variant="primary" to={p("/comercial/contratos/novo")}>Novo comodato</LinkBtn> : undefined} />
      <div className="mb-3"><Select className="max-w-64" value={cust} onChange={(e) => setCust(e.target.value)}><option value="">Todos os clientes</option>{ctx.db.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
      <DataTable rows={rows} cols={[{ h: "Contrato", cell: (c) => c.number }, { h: "Cliente", cell: (c) => custName(ctx.db, c.customerId) }, { h: "Vigência", cell: (c) => `${c.start} a ${c.end}` }, { h: "Equipamentos", cell: (c) => c.serials.length, right: true }, { h: "Situação", cell: (c) => <StatusBadge s={c.status} /> }]} onRow={(c) => p(to("/comercial/contratos/:id", { id: c.id }))} empty={<Empty text="Nenhum contrato." />} />
    </>
  );
}

// ---- I04 ----
function I04() {
  const ctx = useCtx();
  const act = useAct();
  const toast = useToast();
  const nav = useNavigate();
  const [f, setF] = useState({ customerId: "", start: new Date().toISOString().slice(0, 10), end: "", fee: "" });
  const [serials, setSerials] = useState<string[]>([]);
  const [val, setVal] = useState("");
  const company = ctx.company;
  const add = () => {
    const c = normalizeCode(val);
    const s = findSerial(ctx.db, c);
    if (!s || !company) return toast.err(`Série ${c} não encontrada.`);
    const prod = ctx.db.products.find((x) => x.id === s.productId);
    if (prod?.recordType !== "C") return toast.err(`Série ${c} não é produto imobilizado (C).`);
    const prob = eligibilityProblem(ctx.db, s, company.id);
    if (prob) return toast.err(`Série ${c} indisponível: ${prob}.`);
    if (!serials.includes(c)) setSerials([...serials, c]);
    setVal("");
  };
  const customers = ctx.db.customers.filter((c) => company && c.companyIds.includes(company.id));
  return (
    <>
      <PageHeader code="I04" title="Novo comodato" subtitle="Comodato não transfere propriedade. A mensalidade (tipo M) é o valor mensal usado no payback." />
      {ctx.readOnly && <ReadOnlyBanner />}
      <Card>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Cliente"><Select value={f.customerId} onChange={(e) => setF({ ...f, customerId: e.target.value })}><option value="">Escolha…</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Empresa proprietária"><Input disabled value={company?.name ?? ""} /></Field>
          <Field label="Início"><Input type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
          <Field label="Fim"><Input type="date" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
          <Field label="Mensalidade (R$)"><Input type="number" min={0} step="0.01" value={f.fee} onChange={(e) => setF({ ...f, fee: e.target.value })} /></Field>
        </div>
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}><Input className="max-w-sm font-mono" placeholder="Reservar séries: leia a série" value={val} onChange={(e) => setVal(e.target.value)} /><Btn type="submit" variant="secondary">Ler</Btn></form>
        <div className="mt-2 flex flex-wrap gap-2">{serials.map((s) => <Badge key={s} tone="blue">{s} <button aria-label={`Remover ${s}`} onClick={() => setSerials(serials.filter((x) => x !== s))}>✕</button></Badge>)}</div>
        <div className="mt-4 flex gap-2">
          <Btn disabled={ctx.readOnly || !company || serials.length === 0} onClick={() => act((db) => {
            if (!f.customerId) throw new Error("Escolha o cliente.");
            if (!f.end || f.end < f.start) throw new Error("Informe uma vigência válida.");
            const c = createContract(db, { companyId: company!.id, customerId: f.customerId, start: f.start, end: f.end, monthlyFee: Number(f.fee), serials }, ctx.user.id);
            const o = createOutbound(db, { companyId: company!.id, kind: "comodato", customerId: f.customerId, contractId: c.id, taxTypeId: db.taxTypes.find((t) => t.companyId === company!.id && t.operation === "comodato" && t.active)?.id }, ctx.user.id);
            for (const s of serials) addOutboundSerial(db, o.id, s, 0);
            audit(db, ctx.user.id, "comodato.criado", c.id, company!.id);
            return o;
          }, { ok: "Contrato criado. Siga com a saída de comodato.", go: (o) => p(to("/estoque/saidas/:id/separar", { id: o.id })) })}>Continuar (saída de comodato)</Btn>
          <Btn variant="secondary" onClick={() => nav(p("/comercial/contratos"))}>Cancelar</Btn>
        </div>
      </Card>
    </>
  );
}

// ---- I05 ----
function I05() {
  const ctx = useCtx();
  const { id } = useParams();
  const act = useAct();
  const c = ctx.db.contracts.find((x) => x.id === id && ctx.companyIds.includes(x.companyId));
  if (!c) return <Empty text="Contrato não encontrado." action={<LinkBtn to={p("/comercial/contratos")}>Voltar</LinkBtn>} />;
  const pending = c.serials.filter((s) => !c.returned.includes(s));
  const outs = ctx.db.outbounds.filter((o) => o.contractId === c.id);
  const wos = ctx.db.workOrders.filter((o) => o.contractId === c.id);
  return (
    <>
      <PageHeader code="I05" title={`Contrato ${c.number}`} subtitle={<><StatusBadge s={c.status} /> · {custName(ctx.db, c.customerId)}</>} actions={<>
        <LinkBtn to={p(to("/comercial/contratos/:id/retorno", { id: c.id }))}>Registrar retorno</LinkBtn><LinkBtn to={p("/os/nova")}>Nova OS</LinkBtn>
        {c.status === "ativo" && <ConfirmButton label="Encerrar contrato" message={pending.length ? `Há ${pending.length} equipamento(s) sem retorno. Sem retorno, o comodato vira venda ou nota de perda, com decisão registrada. Encerrar mesmo assim?` : "Encerrar o contrato?"} disabled={ctx.readOnly} onConfirm={() => act((db) => { db.contracts.find((x) => x.id === c.id)!.status = "encerrado"; audit(db, ctx.user.id, "contrato.encerrado", c.id, c.companyId, pending.length ? `${pending.length} sem retorno` : ""); }, { ok: "Contrato encerrado." })} />}</>} />
      <Card><KV items={[["Vigência", `${c.start} a ${c.end}`], ["Mensalidade (tipo M)", brl(c.monthlyFee)], ["Equipamentos", c.serials.length], ["Sem retorno", pending.length]]} /></Card>
      <Card title="Equipamentos" className="mt-3"><DataTable rows={c.serials} cols={[{ h: "Série", cell: (s) => s }, { h: "Retorno", cell: (s) => (c.returned.includes(s) ? <Badge tone="green">devolvido</Badge> : <Badge tone="amber">com o cliente</Badge>) }]} onRow={(s) => p(to("/estoque/equipamentos/:id", { id: findSerial(ctx.db, s)?.id ?? "" }))} /></Card>
      <Card title="Notas e OS" className="mt-3"><div className="flex flex-wrap gap-2">{outs.filter((o) => o.invoiceId).map((o) => <LinkBtn key={o.id} to={p(to("/fiscal/notas/:id", { id: o.invoiceId! }))}>Nota {o.number}</LinkBtn>)}{wos.map((o) => <LinkBtn key={o.id} to={p(to("/os/:id", { id: o.id }))}>{o.number}</LinkBtn>)}{outs.length + wos.length === 0 && <span className="text-sm text-slate-500">Nada vinculado ainda.</span>}</div></Card>
    </>
  );
}

// ---- I06 ----
function I06() {
  const ctx = useCtx();
  const { id } = useParams();
  const act = useAct();
  const toast = useToast();
  const c = ctx.db.contracts.find((x) => x.id === id && ctx.companyIds.includes(x.companyId));
  const [read, setRead] = useState<string[]>([]);
  const [val, setVal] = useState("");
  const [reason, setReason] = useState("");
  if (!c) return <Empty text="Contrato não encontrado." />;
  const pending = c.serials.filter((s) => !c.returned.includes(s));
  const add = () => {
    const s = normalizeCode(val);
    if (!pending.includes(s)) return toast.err(`Série ${s} não está pendente de retorno neste contrato.`);
    if (!read.includes(s)) setRead([...read, s]);
    setVal("");
  };
  return (
    <>
      <PageHeader code="I06" title={`Retorno de comodato — ${c.number}`} subtitle="Nunca libera para uso sem triagem: os itens vão para a quarentena. Retorno parcial é permitido." />
      <Card>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}><Input autoFocus className="max-w-sm font-mono" placeholder="Leia as séries devolvidas" value={val} onChange={(e) => setVal(e.target.value)} /><Btn type="submit">Ler</Btn></form>
        <p className="mt-2 text-sm">Pendentes: {pending.join(", ") || "nenhum"}</p>
        <div className="mt-2 flex flex-wrap gap-2">{read.map((s) => <Badge key={s} tone="green">{s}</Badge>)}</div>
        <Field label="Condição / observação" className="mt-3"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="mt-4 flex gap-2">
          <Btn disabled={ctx.readOnly || read.length === 0} onClick={() => act((db) => { registerComodatoReturn(db, c.id, read, reason, ctx.user.id); return db.returns.at(-1)!; }, { ok: "Retorno registrado; itens em quarentena.", go: (r) => p(to("/estoque/devolucoes/:id", { id: r.id })) })}>Confirmar</Btn>
          <LinkBtn to={p(to("/comercial/contratos/:id", { id: c.id }))}>Voltar</LinkBtn>
        </div>
      </Card>
    </>
  );
}

// ---- I07 ----
function I07() {
  const ctx = useCtx();
  const [cust, setCust] = useState("");
  const rows = ctx.db.contracts.filter((c) => ctx.companyIds.includes(c.companyId) && (!cust || c.customerId === cust)).flatMap((c) => c.serials.map((s) => ({ c, s })));
  const cols: Col<{ c: Contract; s: string }>[] = [
    { h: "Cliente", cell: (r) => custName(ctx.db, r.c.customerId), export: (r) => custName(ctx.db, r.c.customerId) },
    { h: "Contrato", cell: (r) => r.c.number, export: (r) => r.c.number },
    { h: "Equipamento", cell: (r) => r.s, export: (r) => r.s },
    { h: "Situação", cell: (r) => (r.c.returned.includes(r.s) ? "devolvido" : "com o cliente"), export: (r) => (r.c.returned.includes(r.s) ? "devolvido" : "com o cliente") },
    { h: "Mensalidade do contrato", cell: (r) => brl(r.c.monthlyFee), right: true, export: (r) => r.c.monthlyFee },
    ...(ctx.seeCost ? [{ h: "Payback (meses, por equipamento)", cell: (r: { c: Contract; s: string }) => paybackMonths(findSerial(ctx.db, r.s)?.cost ?? 0, r.c.monthlyFee / Math.max(1, r.c.serials.length)) ?? "—", right: true, export: (r: { c: Contract; s: string }) => paybackMonths(findSerial(ctx.db, r.s)?.cost ?? 0, r.c.monthlyFee / Math.max(1, r.c.serials.length)) ?? "" }] : []),
  ];
  return (
    <>
      <PageHeader code="I07" title="Relatório de comodato" actions={<ExportBar name="comodato" rows={rows} cols={cols} />} />
      <div className="mb-3"><Select className="max-w-64" value={cust} onChange={(e) => setCust(e.target.value)}><option value="">Todos os clientes</option>{ctx.db.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></div>
      <DataTable rows={rows} cols={cols} onRow={(r) => p(to("/comercial/contratos/:id", { id: r.c.id }))} empty={<Empty text="Sem comodatos para mostrar." />} />
      <p className="mt-2 text-xs text-slate-500">Payback aqui divide a mensalidade igualmente entre os equipamentos do contrato (simplificação, ponto a validar).</p>
    </>
  );
}

export const screens: Record<string, ComponentType> = { I01, I02, I03, I04, I05, I06, I07 };
