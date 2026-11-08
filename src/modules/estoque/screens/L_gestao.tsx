import { useState, type ComponentType } from "react";
import { useParams } from "react-router-dom";
import { Badge, Card, DataTable, Empty, ExportBar, Field, Input, KV, LinkBtn, NoPermission, PageHeader, Select, StatusBadge, Tabs, type Col } from "../components/ui";
import { depreciation, paybackMonths, productMargin, serviceMargin } from "../domain/costing";
import type { Contract, Db, Serial } from "../domain/types";
import { brl, day, pct } from "../format";
import { p, to } from "../routes";
import { useCtx } from "../session";

const custName = (db: Db, id?: string) => db.customers.find((c) => c.id === id)?.name ?? "—";
const LIFE_KEY = "estoque.gestao.vida_util_meses";
const loadLife = () => { try { return localStorage.getItem(LIFE_KEY) ?? ""; } catch { return ""; } };
const monthsBetween = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / (30.44 * 86400000)));

function contractOf(db: Db, s: Serial): Contract | undefined {
  return db.contracts.find((c) => c.serials.includes(s.serial) && c.status === "ativo");
}

// ---- L01 ----
function L01() {
  const ctx = useCtx();
  const [life, setLife] = useState(loadLife());
  const [by, setBy] = useState("equipamento");
  if (!ctx.seeCost) return <NoPermission what="Custo e payback só para quem tem permissão de custo." />;
  const setL = (v: string) => { setLife(v); try { localStorage.setItem(LIFE_KEY, v); } catch { /* ignora */ } };
  const eq = ctx.db.serials.filter((s) => ctx.companyIds.includes(s.ownerCompanyId) && ctx.db.products.find((x) => x.id === s.productId)?.recordType === "C");
  const rows = eq.map((s) => {
    const c = contractOf(ctx.db, s);
    const fee = c ? c.monthlyFee / Math.max(1, c.serials.length) : 0;
    const dep = life ? depreciation(s.cost ?? 0, Number(life), monthsBetween(s.createdAt)) : null;
    return { s, c, fee, dep, payback: paybackMonths(s.cost ?? 0, fee) };
  });
  const cols: Col<(typeof rows)[number]>[] = [
    { h: "Equipamento", cell: (r) => r.s.serial, export: (r) => r.s.serial },
    { h: "Contrato", cell: (r) => r.c?.number ?? "—", export: (r) => r.c?.number ?? "" },
    { h: "Cliente", cell: (r) => (r.c ? custName(ctx.db, r.c.customerId) : "—"), export: (r) => (r.c ? custName(ctx.db, r.c.customerId) : "") },
    { h: "Custo de compra", cell: (r) => brl(r.s.cost), right: true, export: (r) => r.s.cost },
    { h: "Depreciação acumulada", cell: (r) => (r.dep === null ? "informe a vida útil" : brl(r.dep)), right: true, export: (r) => r.dep },
    { h: "Receita mensal", cell: (r) => brl(r.fee), right: true, export: (r) => r.fee },
    { h: "Payback (meses)", cell: (r) => r.payback ?? "—", right: true, export: (r) => r.payback },
    { h: "Custo", cell: (r) => <StatusBadge s={r.s.costStatus} />, export: (r) => r.s.costStatus },
  ];
  return (
    <>
      <PageHeader code="L01" title="Custo, depreciação e payback" subtitle="Usa a mensalidade do contrato (tipo M). Regras de depreciação validadas pelo contador: informe a vida útil." actions={<><ExportBar name="custo-payback" rows={rows} cols={cols} /><LinkBtn to={p("/gestao/margem")}>Margem por venda</LinkBtn></>} />
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Vida útil para depreciação (meses) — validar com o contador"><Input type="number" min={1} className="w-48" value={life} onChange={(e) => setL(e.target.value)} placeholder="ex.: informe o valor validado" /></Field>
          <Field label="Visão"><Select value={by} onChange={(e) => setBy(e.target.value)}><option value="equipamento">Por equipamento</option><option value="contrato">Por contrato</option><option value="cliente">Por cliente</option></Select></Field>
        </div>
        <p className="mt-1 text-xs text-slate-500">Depreciação linear simples (custo ÷ vida útil × meses de uso). Nenhuma taxa é assumida pelo sistema.</p>
      </Card>
      <div className="mt-3">
        {by === "equipamento"
          ? <DataTable rows={rows} cols={cols} onRow={(r) => p(to("/gestao/custos/:id", { id: r.s.id }))} empty={<Empty text="Sem equipamentos imobilizados (tipo C)." />} />
          : <DataTable rows={Object.entries(rows.reduce<Record<string, { custo: number; receita: number; n: number }>>((a, r) => { const k = by === "contrato" ? r.c?.number ?? "sem contrato" : custName(ctx.db, r.c?.customerId); const x = (a[k] ??= { custo: 0, receita: 0, n: 0 }); x.custo += r.s.cost ?? 0; x.receita += r.fee; x.n += 1; return a; }, {}))}
            cols={[{ h: by === "contrato" ? "Contrato" : "Cliente", cell: ([k]) => k }, { h: "Equipamentos", cell: ([, v]) => v.n, right: true }, { h: "Custo de compra", cell: ([, v]) => brl(v.custo), right: true }, { h: "Receita mensal", cell: ([, v]) => brl(v.receita), right: true }, { h: "Payback (meses)", cell: ([, v]) => paybackMonths(v.custo, v.receita) ?? "—", right: true }]} />}
      </div>
    </>
  );
}

// ---- L02 ----
function L02() {
  const ctx = useCtx();
  const { id } = useParams();
  const s = ctx.db.serials.find((x) => x.id === id && ctx.companyIds.includes(x.ownerCompanyId));
  const life = Number(loadLife());
  if (!ctx.seeCost) return <NoPermission what="Custo só para quem tem permissão de custo." />;
  if (!s) return <Empty text="Equipamento não encontrado." action={<LinkBtn to={p("/gestao/custos")}>Voltar</LinkBtn>} />;
  const c = contractOf(ctx.db, s);
  const fee = c ? c.monthlyFee / Math.max(1, c.serials.length) : 0;
  const used = monthsBetween(s.createdAt);
  const months = life > 0 ? Array.from({ length: Math.min(life, 24) }, (_, i) => ({ m: i + 1, dep: depreciation(s.cost ?? 0, life, i + 1) })) : [];
  return (
    <>
      <PageHeader code="L02" title={`Custo de ${s.serial}`} subtitle="Somente leitura." actions={<>
        <LinkBtn to={p(to("/estoque/equipamentos/:id", { id: s.id }))}>Ver equipamento</LinkBtn>
        {s.inboundId && <LinkBtn to={p(to("/estoque/entradas/:id", { id: s.inboundId }))}>Nota de entrada</LinkBtn>}
        {c && <LinkBtn to={p(to("/comercial/contratos/:id", { id: c.id }))}>Contrato</LinkBtn>}
        <LinkBtn to={p("/gestao/custos")}>Voltar</LinkBtn></>} />
      <Card title="Composição do custo"><KV items={[["Preço de compra da série", brl(s.purchasePrice)], ["Rateio de importação", brl(s.allocatedCost)], ["Custos atribuídos (reparo/RMA)", brl(s.assignedCost)], ["Custo total", <strong key="t">{brl(s.cost)}</strong>], ["Situação do custo", <StatusBadge key="s" s={s.costStatus} />]]} /></Card>
      <Card title="Payback" className="mt-3"><KV items={[["Receita mensal atribuída", brl(fee)], ["Payback", paybackMonths(s.cost ?? 0, fee) ? `${paybackMonths(s.cost ?? 0, fee)} meses` : "sem mensalidade"], ["Meses em uso", used]]} /></Card>
      <Card title="Depreciação mês a mês" className="mt-3">
        {life > 0 ? <DataTable rows={months} cols={[{ h: "Mês", cell: (r) => r.m, right: true }, { h: "Acumulada", cell: (r) => brl(r.dep), right: true }, { h: "Valor residual", cell: (r) => brl((s.cost ?? 0) - r.dep), right: true }]} />
          : <p className="text-sm text-slate-600">Informe a vida útil validada pelo contador em <LinkBtn to={p("/gestao/custos")}>Custo e payback</LinkBtn>.</p>}
      </Card>
    </>
  );
}

// ---- L03 ----
interface MRow { key: string; kind: string; ref: string; date: string; customerId?: string; revenue: number; cost: number; margin: number; pct: number; provisional: boolean; to: string; detail: { label: string; cost: number | null; to?: string }[]; payback?: number | null; productIds: string[]; companyId: string }
function L03() {
  const ctx = useCtx();
  const [tab, setTab] = useState("Produtos");
  const [from, setFrom] = useState("");
  const [to2, setTo2] = useState("");
  const [cust, setCust] = useState("");
  const [prod, setProd] = useState("");
  const [open, setOpen] = useState<MRow | null>(null);
  if (!ctx.seeCost) return <NoPermission what="Margem só para administradores." />;
  const { db } = ctx;
  const mine = (cid: string) => ctx.companyIds.includes(cid);
  const sales: MRow[] = db.invoices.filter((i) => mine(i.companyId) && i.operation === "venda" && i.status === "autorizada").map((i) => {
    const m = productMargin(db, i.items.filter((it) => it.serial).map((it) => ({ serial: it.serial!, saleValue: it.unitValue * it.qty })));
    return { key: i.id, kind: "Venda", ref: `Nota ${i.number}`, date: i.createdAt, customerId: i.customerId, revenue: m.revenue, cost: m.cost, margin: m.margin, pct: m.marginPct, provisional: m.provisional, to: to("/fiscal/notas/:id", { id: i.id }), detail: m.perSerial.map((x) => ({ label: x.serial, cost: x.cost, to: to("/estoque/equipamentos/:id", { id: db.serials.find((s) => s.serial === x.serial)?.id ?? "" }) })), productIds: i.items.map((it) => it.productId), companyId: i.companyId };
  });
  const services: MRow[] = db.workOrders.filter((o) => mine(o.companyId) && o.status === "finalizada").map((o) => {
    const m = serviceMargin(db, o);
    return { key: o.id, kind: "Serviço", ref: o.number, date: o.createdAt, customerId: o.customerId, revenue: m.revenue, cost: m.cost, margin: m.margin, pct: m.marginPct, provisional: false, to: to("/os/:id", { id: o.id }), detail: [{ label: `Técnico (${o.technicianKind})`, cost: o.techPayment ?? 0 }, ...o.supplies.map((s) => ({ label: s.description, cost: s.unitCost * s.qty }))], productIds: [], companyId: o.companyId };
  });
  const com: MRow[] = db.contracts.filter((c) => mine(c.companyId)).map((c) => {
    const sers = c.serials.map((s) => db.serials.find((x) => x.serial === s)).filter((s): s is Serial => !!s);
    const cost = sers.reduce((a, s) => a + (s.cost ?? 0), 0);
    return { key: c.id, kind: "Comodato", ref: c.number, date: c.start, customerId: c.customerId, revenue: c.monthlyFee, cost, margin: c.monthlyFee, pct: 0, provisional: sers.some((s) => s.costStatus === "provisorio"), to: to("/comercial/contratos/:id", { id: c.id }), detail: sers.map((s) => ({ label: s.serial, cost: s.cost, to: to("/estoque/equipamentos/:id", { id: s.id }) })), payback: paybackMonths(cost, c.monthlyFee), productIds: sers.map((s) => s.productId), companyId: c.companyId };
  });
  const base = tab === "Produtos" ? sales : tab === "Serviços" ? services : com;
  const rows = base.filter((r) => (!from || r.date.slice(0, 10) >= from) && (!to2 || r.date.slice(0, 10) <= to2) && (!cust || r.customerId === cust) && (!prod || r.productIds.includes(prod)));
  const cols: Col<MRow>[] = [
    { h: "Referência", cell: (r) => r.ref, export: (r) => r.ref }, { h: "Data", cell: (r) => day(r.date), export: (r) => day(r.date) }, { h: "Cliente", cell: (r) => custName(db, r.customerId), export: (r) => custName(db, r.customerId) },
    { h: tab === "Comodato" ? "Mensalidade" : "Valor de venda", cell: (r) => brl(r.revenue), right: true, export: (r) => r.revenue }, { h: "Custo", cell: (r) => <span>{brl(r.cost)} {r.provisional && <Badge tone="amber">provisório</Badge>}</span>, right: true, export: (r) => r.cost },
    { h: tab === "Comodato" ? "Receita mensal" : "Margem R$", cell: (r) => brl(r.margin), right: true, export: (r) => r.margin },
    { h: tab === "Comodato" ? "Payback (meses)" : "Margem %", cell: (r) => (tab === "Comodato" ? r.payback ?? "—" : pct(r.pct)), right: true, export: (r) => (tab === "Comodato" ? r.payback : r.pct) },
  ];
  return (
    <>
      <PageHeader code="L03" title="Margem por venda" subtitle="O custo vem do preço de compra de cada série (sem custo médio). Venda entre Traxor e Ali Sat fica fora da margem do grupo. A margem do orçamento é calculada no CRM com o custo que este sistema informa (M02)." actions={<><ExportBar name={`margem-${tab.toLowerCase()}`} rows={rows} cols={cols} /><LinkBtn to={p("/gestao/custos")}>Voltar</LinkBtn></>} />
      <Tabs tabs={["Produtos", "Serviços", "Comodato"]} value={tab} onChange={setTab} />
      <div className="mb-3 flex flex-wrap gap-2">
        <Input type="date" className="max-w-40" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="De" /><Input type="date" className="max-w-40" value={to2} onChange={(e) => setTo2(e.target.value)} aria-label="Até" />
        <Select className="max-w-56" value={cust} onChange={(e) => setCust(e.target.value)}><option value="">Todos os clientes</option>{db.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Select className="max-w-56" value={prod} onChange={(e) => setProd(e.target.value)}><option value="">Todos os produtos</option>{db.products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>
      </div>
      <DataTable rows={rows} cols={cols.map((c, i) => (i === 0 ? { ...c, cell: (r: MRow) => <button className="font-medium text-sky-800 hover:underline" onClick={() => setOpen(r)}>{r.ref}</button> } : c))} empty={<Empty text="Nenhuma venda/serviço/contrato neste filtro." />} />
      {open && (
        <div className="fixed inset-y-0 right-0 z-40 w-full max-w-md overflow-auto border-l border-slate-200 bg-white p-5 shadow-xl" role="dialog" aria-label="Custo série a série">
          <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">{open.ref}: custo detalhado</h3><button aria-label="Fechar" onClick={() => setOpen(null)}>✕</button></div>
          <DataTable rows={open.detail} cols={[{ h: "Item", cell: (d) => (d.to ? <a className="text-sky-800 hover:underline" href={p(d.to)}>{d.label}</a> : d.label) }, { h: "Custo", cell: (d) => brl(d.cost), right: true }]} />
          <div className="mt-3 flex gap-2"><LinkBtn to={p(open.to)}>Abrir {open.kind === "Venda" ? "nota" : open.kind === "Serviço" ? "OS" : "contrato"}</LinkBtn>{open.detail[0]?.to && tab !== "Serviços" && <LinkBtn to={p("/gestao/custos")}>Ver custo do equipamento</LinkBtn>}</div>
        </div>
      )}
    </>
  );
}

export const screens: Record<string, ComponentType> = { L01, L02, L03 };
