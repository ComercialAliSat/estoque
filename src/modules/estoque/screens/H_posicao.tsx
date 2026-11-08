import { useEffect, useState, type ComponentType } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Badge, Btn, Card, DataTable, Empty, ExportBar, Field, Input, KV, LinkBtn, PageHeader, ReadOnlyBanner, ReasonButton,
  Select, StatusBadge, Tabs, useAct, useToast, type Col,
} from "../components/ui";
import { findSerial } from "../domain/core";
import { paybackMonths } from "../domain/costing";
import { approveInventory, countSerial, finishCount, inventoryDiff, startInventory } from "../domain/logistics";
import { resolveScan } from "../domain/mothercode";
import { stockPosition, type PositionRow } from "../domain/stock";
import type { Db, Inventory } from "../domain/types";
import { brl, dt } from "../format";
import { takePending } from "../leitura";
import { p, to } from "../routes";
import { useCtx } from "../session";

const prodName = (db: Db, id: string) => db.products.find((x) => x.id === id)?.name ?? "—";
const locName = (db: Db, id: string) => db.locations.find((l) => l.id === id)?.name ?? "—";
const compName = (db: Db, id: string) => db.companies.find((c) => c.id === id)?.name ?? "—";

// ---- H01 ----
function H01() {
  const ctx = useCtx();
  const [q, setQ] = useState("");
  const [serial, setSerial] = useState("");
  const nav = useNavigate();
  const toast = useToast();
  const rows = stockPosition(ctx.db, ctx.companyIds).filter((r) => prodName(ctx.db, r.productId).toLowerCase().includes(q.toLowerCase()));
  const cols: Col<PositionRow>[] = [
    { h: "Empresa", cell: (r) => compName(ctx.db, r.companyId), export: (r) => compName(ctx.db, r.companyId) },
    { h: "Local", cell: (r) => locName(ctx.db, r.locationId), export: (r) => locName(ctx.db, r.locationId) },
    { h: "Produto", cell: (r) => prodName(ctx.db, r.productId), export: (r) => prodName(ctx.db, r.productId) },
    { h: "Físico", cell: (r) => r.physical, right: true, export: (r) => r.physical },
    { h: "Disponível", cell: (r) => r.available, right: true, export: (r) => r.available },
    { h: "Reservado", cell: (r) => r.reserved, right: true, export: (r) => r.reserved },
    { h: "Em trânsito", cell: (r) => r.transit, right: true, export: (r) => r.transit },
    { h: "Quarentena", cell: (r) => r.quarantine, right: true, export: (r) => r.quarantine },
  ];
  const find = () => {
    const s = findSerial(ctx.db, serial);
    if (!s || !ctx.companyIds.includes(s.ownerCompanyId)) return toast.err("Série não encontrada nas suas empresas.");
    nav(p(to("/estoque/equipamentos/:id", { id: s.id })));
  };
  return (
    <>
      <PageHeader code="H01" title="Posição de estoque" subtitle="Físico não é disponível." actions={<><ExportBar name="posicao-estoque" rows={rows} cols={cols} />{!ctx.readOnly && <LinkBtn to={p("/estoque/transferencias/nova")}>Transferir</LinkBtn>}</>} />
      {ctx.readOnly && <ReadOnlyBanner />}
      <div className="mb-3 flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Filtrar por produto" value={q} onChange={(e) => setQ(e.target.value)} />
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); find(); }}><Input className="max-w-xs font-mono" placeholder="Buscar série" value={serial} onChange={(e) => setSerial(e.target.value)} /><Btn type="submit" variant="secondary">Buscar</Btn></form>
      </div>
      <DataTable rows={rows} cols={cols} keyOf={(r) => `${r.companyId}${r.productId}${r.locationId}`}
        empty={<Empty text="Sem saldo para mostrar." />} />
      {rows.length > 0 && <p className="mt-2 text-xs text-slate-500">Clique no produto abaixo para o detalhe:</p>}
      <div className="mt-1 flex flex-wrap gap-2">{[...new Set(rows.map((r) => r.productId))].map((id) => <LinkBtn key={id} to={p(to("/estoque/produtos/:id", { id }))}>{prodName(ctx.db, id)}</LinkBtn>)}</div>
    </>
  );
}

// ---- H02 ----
function H02() {
  const ctx = useCtx();
  const { id } = useParams();
  const prod = ctx.db.products.find((x) => x.id === id);
  if (!prod) return <Empty text="Produto não encontrado." />;
  const pos = stockPosition(ctx.db, ctx.companyIds).filter((r) => r.productId === prod.id);
  const sers = ctx.db.serials.filter((s) => s.productId === prod.id && ctx.companyIds.includes(s.ownerCompanyId));
  const lots = ctx.db.inbounds.filter((i) => ctx.companyIds.includes(i.companyId)).flatMap((i) => i.items.filter((it) => it.productId === prod.id).map((it) => ({ inbound: i, it })));
  const costs = sers.map((s) => s.cost).filter((c): c is number => c !== null);
  return (
    <>
      <PageHeader code="H02" title={prod.name} subtitle="Detalhe no estoque" actions={<>
        {!ctx.readOnly && <><LinkBtn to={p("/estoque/transferencias/nova")}>Transferir</LinkBtn><LinkBtn to={p("/estoque/saidas/nova")}>Nova saída</LinkBtn></>}
        <LinkBtn to={p(to("/cadastros/produtos/:id", { id: prod.id }))}>Cadastro do produto</LinkBtn></>} />
      <Card title="Saldos por local"><DataTable rows={pos} cols={[{ h: "Empresa", cell: (r) => compName(ctx.db, r.companyId) }, { h: "Local", cell: (r) => locName(ctx.db, r.locationId) }, { h: "Físico", cell: (r) => r.physical, right: true }, { h: "Disponível", cell: (r) => r.available, right: true }, { h: "Reservado", cell: (r) => r.reserved, right: true }]} empty={<p className="text-sm text-slate-500">Sem saldo.</p>} /></Card>
      <Card title="Lotes (itens de notas de entrada)" className="mt-3"><DataTable rows={lots} cols={[{ h: "Entrada", cell: (l) => l.inbound.number }, { h: "Quantidade", cell: (l) => l.it.qty, right: true }, { h: "Situação", cell: (l) => <StatusBadge s={l.inbound.status} /> }, ...(ctx.seeCost ? [{ h: "Preço unitário", cell: (l: (typeof lots)[number]) => brl(l.it.unitPrice), right: true }] : [])]} onRow={(l) => p(to("/estoque/entradas/:id", { id: l.inbound.id }))} empty={<p className="text-sm text-slate-500">Sem lotes.</p>} /></Card>
      {ctx.seeCost && <Card title="Custo" className="mt-3"><p className="text-sm">{costs.length ? `Custo por série específica: de ${brl(Math.min(...costs))} a ${brl(Math.max(...costs))}.` : "Sem custo registrado."} <span className="text-slate-500">Sem custo médio (RN-020): cada série tem o seu custo.</span></p></Card>}
      <Card title={`Séries (${sers.length})`} className="mt-3"><DataTable rows={sers.slice(0, 100)} cols={[{ h: "Série", cell: (s) => s.serial }, { h: "Local", cell: (s) => (s.locationId ? locName(ctx.db, s.locationId) : "—") }, { h: "Comercial", cell: (s) => <StatusBadge s={s.commercial} /> }, { h: "Técnica", cell: (s) => <StatusBadge s={s.technical} /> }]} onRow={(s) => p(to("/estoque/equipamentos/:id", { id: s.id }))} empty={<p className="text-sm text-slate-500">Produto sem série.</p>} /></Card>
    </>
  );
}

// ---- H03 ----
function H03() {
  const ctx = useCtx();
  const { id } = useParams();
  const [tab, setTab] = useState("Resumo");
  const s = ctx.db.serials.find((x) => x.id === id);
  if (!s || !ctx.companyIds.includes(s.ownerCompanyId)) return <Empty text="Equipamento não encontrado nesta empresa." action={<LinkBtn to={p("/estoque/posicao")}>Voltar</LinkBtn>} />;
  const { db } = ctx;
  const inb = db.inbounds.find((i) => i.id === s.inboundId);
  const outs = db.outbounds.filter((o) => o.serials.includes(s.serial));
  const wos = db.workOrders.filter((o) => o.serialsOut.includes(s.serial) || o.serialsIn.includes(s.serial));
  const contract = db.contracts.find((c) => c.serials.includes(s.serial) && c.status === "ativo");
  const links = db.links.filter((l) => l.serial === s.serial);
  const hist = db.serialHistory.filter((h) => h.serialId === s.id).slice().reverse();
  const sold = outs.find((o) => o.kind === "venda" && (o.status === "nota_autorizada" || o.status === "enviada"));
  const saleValue = sold ? sold.unitValue[s.serial] ?? 0 : null;
  const prod = db.products.find((x) => x.id === s.productId);
  return (
    <>
      <PageHeader code="H03" title={`Equipamento ${s.serial}`} subtitle={prod?.name} actions={<>
        {inb && <LinkBtn to={p(to("/estoque/entradas/:id", { id: inb.id }))}>Nota de entrada</LinkBtn>}
        <LinkBtn to={p(`/estoque/etiquetas?tipo=serie&id=${s.id}`)}>Imprimir etiqueta</LinkBtn>
        {!ctx.readOnly && <><LinkBtn to={p("/estoque/transferencias/nova")}>Transferir</LinkBtn><LinkBtn to={p(`/assistencia/novo?serie=${s.serial}`)}>Abrir chamado</LinkBtn></>}
        {ctx.seeCost && <LinkBtn to={p(to("/gestao/custos/:id", { id: s.id }))}>Ver custo e payback</LinkBtn>}</>} />
      <Tabs tabs={["Resumo", ...(ctx.seeCost ? ["Custo"] : []), "Vínculos", "Documentos", "Histórico"]} value={tab} onChange={setTab} />
      {tab === "Resumo" && (
        <Card><KV items={[
          ["Dono (propriedade)", compName(db, s.ownerCompanyId)], ["Local", s.locationId ? locName(db, s.locationId) : "—"], ["Custódia", s.custody || "—"],
          ["Situação comercial", <StatusBadge key="c" s={s.commercial} />], ["Condição técnica", <StatusBadge key="t" s={s.technical} />], ["Produto", prod?.name],
        ]} />
          <p className="mt-3 text-xs text-slate-500">Dono, local, custódia, situação comercial e condição técnica são informações separadas: mover de lugar não muda o dono.</p>
          {outs.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{outs.filter((o) => o.invoiceId).map((o) => <LinkBtn key={o.id} to={p(to("/fiscal/notas/:id", { id: o.invoiceId! }))}>Nota de saída {o.number}</LinkBtn>)}</div>}
        </Card>
      )}
      {tab === "Custo" && ctx.seeCost && (
        <Card><KV items={[
          ["Nota e lote de origem", inb ? `${inb.number} / ${s.lotId}` : "—"], ["Preço de compra da série", brl(s.purchasePrice)], ["Rateio (importação)", brl(s.allocatedCost)],
          ["Custos atribuídos (reparo/RMA)", brl(s.assignedCost)], ["Custo total", <strong key="k">{brl(s.cost)}</strong>], ["Situação do custo", <StatusBadge key="s" s={s.costStatus} />],
          ["Margem da venda", saleValue !== null && s.cost !== null ? `${brl(saleValue - s.cost)} (venda ${brl(saleValue)})` : "— (não vendido)"],
          ["Payback (comodato)", contract ? (paybackMonths(s.cost ?? 0, contract.monthlyFee / Math.max(1, contract.serials.length)) ?? "—") + " meses" : "—"],
        ]} /><p className="mt-2 text-xs text-slate-500">Depreciação e vida útil: informe a regra validada pelo contador em Custo e payback (L02).</p></Card>
      )}
      {tab === "Vínculos" && (
        <Card><DataTable rows={[...links.map((l) => ({ k: l.id, tipo: "Chip/plataforma", desc: `${l.iccid ?? "—"} · ${l.platform ?? "—"} · ${l.plate ?? "—"}`, from: l.from, to: l.to })), ...wos.map((o) => ({ k: o.id, tipo: "OS", desc: o.number, from: o.createdAt, to: null as string | null })), ...(contract ? [{ k: contract.id, tipo: "Contrato", desc: contract.number, from: contract.start, to: contract.end as string | null }] : [])]}
          cols={[{ h: "Tipo", cell: (r) => r.tipo }, { h: "Descrição", cell: (r) => r.desc }, { h: "Início", cell: (r) => dt(r.from) }, { h: "Fim", cell: (r) => (r.to ? dt(r.to) : "vigente") }]} empty={<Empty text="Sem vínculos." />} />
          <div className="mt-2 flex flex-wrap gap-2">{contract && <LinkBtn to={p(to("/comercial/contratos/:id", { id: contract.id }))}>Contrato</LinkBtn>}{wos.map((o) => <LinkBtn key={o.id} to={p(to("/os/:id", { id: o.id }))}>{o.number}</LinkBtn>)}{links[0]?.plate && <LinkBtn to={p(to("/operacao/veiculos/:id", { id: links[0].plate! }))}>Veículo</LinkBtn>}{links[0]?.iccid && <LinkBtn to={p(to("/operacao/chips/:id", { id: db.chips.find((c) => c.iccid === links[0].iccid)?.id ?? "" }))}>Chip</LinkBtn>}</div></Card>
      )}
      {tab === "Documentos" && <Empty text="Documentos do equipamento (fotos, laudos) entram com o armazenamento privado do Supabase." />}
      {tab === "Histórico" && <DataTable rows={hist} cols={[{ h: "Quando", cell: (h) => dt(h.at) }, { h: "Campo", cell: (h) => h.field }, { h: "De", cell: (h) => h.from || "—" }, { h: "Para", cell: (h) => h.to || "—" }, { h: "Por", cell: (h) => db.profiles.find((x) => x.id === h.by)?.name ?? h.by }, { h: "Ref.", cell: (h) => h.ref }]} empty={<Empty text="Sem histórico." />} />}
    </>
  );
}

// ---- H04 ----
function H04() {
  const ctx = useCtx();
  const act = useAct();
  const [scope, setScope] = useState("");
  const rows = ctx.db.inventories.filter((i) => ctx.companyIds.includes(i.companyId));
  const locs = ctx.db.locations.filter((l) => ctx.company && l.companyId === ctx.company.id && l.type !== "cliente");
  return (
    <>
      <PageHeader code="H04" title="Inventários" subtitle="No início, o saldo é guardado como foto para comparar." />
      {!ctx.readOnly && ctx.can("estoque", "criar") && (
        <Card title="Novo inventário"><div className="flex flex-wrap items-end gap-2">
          <Field label="Escopo"><Select value={scope} onChange={(e) => setScope(e.target.value)}><option value="">Empresa inteira</option>{locs.map((l) => <option key={l.id} value={l.id}>Local: {l.name}</option>)}</Select></Field>
          <Btn onClick={() => act((db) => startInventory(db, ctx.company!.id, scope || undefined, scope ? `Local ${locName(db, scope)}` : "Empresa"), { ok: "Inventário iniciado.", go: (i) => p(to("/estoque/inventarios/:id", { id: i.id })) })}>Novo inventário</Btn></div></Card>
      )}
      <div className="mt-3"><DataTable rows={rows} cols={[{ h: "Escopo", cell: (i) => i.scope }, { h: "Empresa", cell: (i) => compName(ctx.db, i.companyId) }, { h: "Situação", cell: (i) => <StatusBadge s={i.status} /> }, { h: "Lidas", cell: (i) => i.counted.length, right: true }, { h: "Início", cell: (i) => dt(i.createdAt) }]} onRow={(i) => p(to(i.status === "revisao" ? "/estoque/inventarios/:id/revisao" : "/estoque/inventarios/:id", { id: i.id }))} empty={<Empty text="Nenhum inventário." />} /></div>
    </>
  );
}

// ---- H05 ----
function H05() {
  const ctx = useCtx();
  const { id } = useParams();
  const act = useAct();
  const toast = useToast();
  const nav = useNavigate();
  const [val, setVal] = useState("");
  const inv = ctx.db.inventories.find((i) => i.id === id && ctx.companyIds.includes(i.companyId));
  useEffect(() => {
    const pend = takePending("inventario");
    if (pend && inv) act((db) => pend.serials.forEach((s) => countSerial(db, inv.id, s)), { ok: `${pend.serials.length} série(s) do leitor universal.` });
   
  }, []);
  if (!inv) return <Empty text="Inventário não encontrado." action={<LinkBtn to={p("/estoque/inventarios")}>Voltar</LinkBtn>} />;
  const diff = inventoryDiff(ctx.db, inv.id);
  const read = () => {
    const r = resolveScan(ctx.db, val, "inventario", inv.companyId, inv.counted);
    if (r.kind === "desconhecido") return toast.err(r.issues[0].message);
    act((db) => r.serials.forEach((s) => countSerial(db, inv.id, s)));
    setVal("");
  };
  const editable = inv.status === "contando";
  return (
    <>
      <PageHeader code="H05" title={`Contagem — ${inv.scope}`} subtitle="A leitura não ajusta o saldo." actions={<LinkBtn to={p(`/leitura?modo=inventario&voltar=${encodeURIComponent(p(to("/estoque/inventarios/:id", { id: inv.id })))}`)}>Leitor universal</LinkBtn>} />
      <Card>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); read(); }}><Input autoFocus className="max-w-md font-mono" placeholder="Leia série ou caixa" value={val} onChange={(e) => setVal(e.target.value)} disabled={!editable} aria-label="Campo de leitura" /><Btn type="submit" disabled={!editable}>Ler</Btn></form>
        <div className="mt-3 grid gap-3 sm:grid-cols-3 text-sm"><KV items={[["Lidas", inv.counted.length], ["Faltas", diff.missing.length], ["Sobras", diff.surplus.length]]} /></div>
        {diff.missing.length > 0 && <p className="mt-2 text-sm text-amber-800">Faltam: {diff.missing.slice(0, 20).join(", ")}{diff.missing.length > 20 && "…"}</p>}
        {diff.surplus.length > 0 && <p className="mt-1 text-sm text-red-700">Sobras (não esperadas): {diff.surplus.slice(0, 20).join(", ")}</p>}
        <div className="mt-4 flex gap-2">
          <Btn variant="secondary" onClick={() => toast.ok("Contagem parcial salva.")}>Salvar parcial</Btn>
          <Btn disabled={!editable || ctx.readOnly} onClick={() => act((db) => finishCount(db, inv.id), { go: p(to("/estoque/inventarios/:id/revisao", { id: inv.id })) })}>Finalizar contagem</Btn>
          <Btn variant="ghost" onClick={() => nav(p("/estoque/inventarios"))}>Voltar</Btn>
        </div>
      </Card>
    </>
  );
}

// ---- H06 ----
function H06() {
  const ctx = useCtx();
  const { id } = useParams();
  const act = useAct();
  const inv: Inventory | undefined = ctx.db.inventories.find((i) => i.id === id && ctx.companyIds.includes(i.companyId));
  if (!inv) return <Empty text="Inventário não encontrado." />;
  const diff = inventoryDiff(ctx.db, inv.id);
  const impact = diff.missing.reduce((a, s) => a + (findSerial(ctx.db, s)?.cost ?? 0), 0);
  return (
    <>
      <PageHeader code="H06" title="Aprovação de ajuste" subtitle="Ajuste é movimento compensatório com motivo. Mudança de dono nunca por inventário. Aprovação por administrador." />
      <Card>
        <KV items={[["Escopo", inv.scope], ["Faltas", diff.missing.length], ["Sobras", diff.surplus.length], ["Impacto (custo das faltas)", ctx.seeCost ? brl(impact) : "oculto"], ["Situação", <StatusBadge key="s" s={inv.status} />]]} />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div><h3 className="text-sm font-semibold">Faltas</h3><ul className="text-sm">{diff.missing.map((s) => <li key={s} className="font-mono">{s}</li>)}{diff.missing.length === 0 && <li className="text-slate-500">Nenhuma</li>}</ul></div>
          <div><h3 className="text-sm font-semibold">Sobras</h3><ul className="text-sm">{diff.surplus.map((s) => <li key={s} className="font-mono">{s}</li>)}{diff.surplus.length === 0 && <li className="text-slate-500">Nenhuma</li>}</ul></div>
        </div>
        <p className="mt-2 text-xs text-slate-500">Sobras não criam série: investigue e dê entrada pelo fluxo correto (E02).</p>
        <div className="mt-4 flex gap-2">
          <ReasonButton variant="primary" label="Aprovar" title="Aprovar ajuste" disabled={!ctx.isAdmin || inv.status !== "revisao"} onSubmit={(r) => act((db) => approveInventory(db, inv.id, r, ctx.user.id), { ok: "Ajustes registrados.", go: p("/estoque/inventarios") })} />
          <Btn variant="secondary" disabled={inv.status !== "revisao"} onClick={() => act((db) => { db.inventories.find((i) => i.id === inv.id)!.status = "contando"; }, { go: p(to("/estoque/inventarios/:id", { id: inv.id })) })}>Devolver para recontagem</Btn>
          {!ctx.isAdmin && <Badge tone="amber">Só administradores aprovam</Badge>}
        </div>
      </Card>
    </>
  );
}

// ---- H07 ----
function H07() {
  const ctx = useCtx();
  const [kind, setKind] = useState("saldo");
  const { db } = ctx;
  const owned = db.serials.filter((s) => ctx.companyIds.includes(s.ownerCompanyId));
  const reports: Record<string, { headers: string[]; rows: (string | number)[][]; links?: (string | null)[] }> = {
    saldo: { headers: ["Empresa", "Local", "Produto", "Físico", "Disponível", "Reservado"], rows: stockPosition(db, ctx.companyIds).map((r) => [compName(db, r.companyId), locName(db, r.locationId), prodName(db, r.productId), r.physical, r.available, r.reserved]) },
    serie: { headers: ["Série", "Produto", "Dono", "Local", "Comercial", "Técnica"], rows: owned.map((s) => [s.serial, prodName(db, s.productId), compName(db, s.ownerCompanyId), s.locationId ? locName(db, s.locationId) : "—", s.commercial, s.technical]), links: owned.map((s) => p(to("/estoque/equipamentos/:id", { id: s.id }))) },
    situacao: { headers: ["Situação comercial", "Quantidade"], rows: Object.entries(owned.reduce<Record<string, number>>((a, s) => ({ ...a, [s.commercial]: (a[s.commercial] ?? 0) + 1 }), {})) },
    comodato: { headers: ["Série", "Produto", "Cliente (custódia)", "Contrato"], rows: owned.filter((s) => s.commercial === "comodato").map((s) => [s.serial, prodName(db, s.productId), s.custody, db.contracts.find((c) => c.serials.includes(s.serial))?.number ?? "—"]) },
    ativos: { headers: ["Série", "Produto (imobilizado)", "Local", ...(ctx.seeCost ? ["Custo"] : [])], rows: owned.filter((s) => db.products.find((x) => x.id === s.productId)?.recordType === "C").map((s) => [s.serial, prodName(db, s.productId), s.locationId ? locName(db, s.locationId) : s.custody, ...(ctx.seeCost ? [s.cost ?? 0] : [])]) },
    produto: { headers: ["Código", "Produto", "Físico total"], rows: db.products.map((x) => [x.code, x.name, stockPosition(db, ctx.companyIds).filter((r) => r.productId === x.id).reduce((a, r) => a + r.physical, 0)]) },
  };
  const rep = reports[kind];
  const cols: Col<(string | number)[]>[] = rep.headers.map((h, i) => ({ h, cell: (r) => r[i], export: (r) => r[i], right: typeof rep.rows[0]?.[i] === "number" }));
  return (
    <>
      <PageHeader code="H07" title="Relatórios de estoque" actions={<ExportBar name={`relatorio-${kind}`} rows={rep.rows} cols={cols} />} />
      <div className="mb-3"><Select className="max-w-64" value={kind} onChange={(e) => setKind(e.target.value)}><option value="saldo">Saldo por produto e local</option><option value="produto">Por código / produto</option><option value="situacao">Por situação</option><option value="serie">Por número de série</option><option value="comodato">Comodato</option><option value="ativos">Ativos (imobilizado)</option></Select></div>
      <DataTable rows={rep.rows} cols={cols.map((c, i) => (i === 0 && rep.links ? { ...c, cell: (r: (string | number)[]) => <a className="text-sky-800 hover:underline" href={rep.links![rep.rows.indexOf(r)] ?? "#"}>{r[0]}</a> } : c))} empty={<Empty text="Sem dados para este relatório." />} />
    </>
  );
}

export const screens: Record<string, ComponentType> = { H01, H02, H03, H04, H05, H06, H07 };
