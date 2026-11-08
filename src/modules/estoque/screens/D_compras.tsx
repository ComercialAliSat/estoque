import { useState, type ComponentType } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Btn, Card, ConfirmButton, DataTable, Empty, Field, Input, KV, LinkBtn, PageHeader, ReadOnlyBanner, ReasonButton, Select, StatusBadge, useAct } from "../components/ui";
import { audit } from "../domain/core";
import { allocate, importLines, importTotalCosts, simulateRateio, closeRateio } from "../domain/costing";
import { cancelOrder, closeImport, closeOrderWithPending, createImport, decideOrder, issueOrder, saveOrder } from "../domain/purchasing";
import { brl, dt } from "../format";
import { p, to } from "../routes";
import { useCtx } from "../session";

const supplierName = (db: import("../domain/types").Db, id: string) => db.suppliers.find((s) => s.id === id)?.name ?? "—";
const orderTotal = (o: import("../domain/types").PurchaseOrder) => o.items.reduce((a, i) => a + i.qty * i.unitPrice, 0);

// ---- D01 ----
function D01() {
  const ctx = useCtx();
  const [st, setSt] = useState("");
  const rows = ctx.db.orders.filter((o) => ctx.companyIds.includes(o.companyId) && (!st || o.status === st));
  return (
    <>
      <PageHeader code="D01" title="Pedidos de compra" actions={<><LinkBtn to={p("/compras/aprovacoes")}>Aprovações</LinkBtn>{!ctx.readOnly && ctx.can("financeiro", "criar") && <LinkBtn variant="primary" to={p("/compras/pedidos/novo")}>Nova requisição</LinkBtn>}</>} />
      {ctx.readOnly && <ReadOnlyBanner />}
      <div className="mb-3"><Select className="max-w-52" value={st} onChange={(e) => setSt(e.target.value)}><option value="">Todas as situações</option>{["rascunho", "aguardando", "aprovado", "rejeitado", "emitido", "parcial", "recebido", "encerrado", "cancelado"].map((s) => <option key={s}>{s}</option>)}</Select></div>
      <DataTable rows={rows} cols={[
        { h: "Pedido", cell: (o) => o.number }, { h: "Fornecedor", cell: (o) => supplierName(ctx.db, o.supplierId) },
        { h: "Situação", cell: (o) => <StatusBadge s={o.status} /> }, { h: "Valor", cell: (o) => `${o.currency} ${orderTotal(o).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`, right: true },
      ]} onRow={(o) => p(to("/compras/pedidos/:id", { id: o.id }))} empty={<Empty text="Nenhum pedido ainda." action={<LinkBtn variant="primary" to={p("/compras/pedidos/novo")}>Nova requisição</LinkBtn>} />} />
    </>
  );
}

// ---- D02 ----
function D02() {
  const ctx = useCtx();
  const act = useAct();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const cur = sp.get("editar") ? ctx.db.orders.find((o) => o.id === sp.get("editar")) : undefined;
  const [supplierId, setSupplier] = useState(cur?.supplierId ?? "");
  const [currency, setCurrency] = useState(cur?.currency ?? "BRL");
  const [items, setItems] = useState(cur?.items.map(({ productId, qty, unitPrice }) => ({ productId, qty, unitPrice })) ?? [{ productId: "", qty: 1, unitPrice: 0 }]);
  const upd = (i: number, patch: Partial<(typeof items)[number]>) => setItems(items.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const run = (submit: boolean) => {
    if (!ctx.company) return;
    act((db) => saveOrder(db, { id: cur?.id, companyId: ctx.company!.id, supplierId, currency, items }, submit, ctx.user.id), {
      ok: submit ? "Enviado para aprovação." : "Rascunho salvo.", go: (o) => (submit ? p(to("/compras/pedidos/:id", { id: o.id })) : p("/compras/pedidos")),
    });
  };
  return (
    <>
      <PageHeader code="D02" title={cur ? `Ajustar ${cur.number}` : "Nova requisição ou pedido"} subtitle={cur?.rejectReason ? `Rejeitado: ${cur.rejectReason}` : "Pedido não gera estoque."} />
      {ctx.readOnly && <ReadOnlyBanner />}
      <Card>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Fornecedor"><Select value={supplierId} onChange={(e) => { setSupplier(e.target.value); const s = ctx.db.suppliers.find((x) => x.id === e.target.value); if (s) setCurrency(s.currency); }}><option value="">Escolha…</option>{ctx.db.suppliers.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <Field label="Empresa compradora"><Input value={ctx.company?.name ?? "—"} disabled /></Field>
          <Field label="Moeda"><Input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></Field>
        </div>
        <h3 className="mb-2 mt-4 text-sm font-semibold">Itens</h3>
        {items.map((it, i) => (
          <div key={i} className="mb-2 grid gap-2 sm:grid-cols-[1fr_100px_140px_auto]">
            <Select aria-label="Produto" value={it.productId} onChange={(e) => upd(i, { productId: e.target.value })}><option value="">Produto…</option>{ctx.db.products.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}</Select>
            <Input aria-label="Quantidade" type="number" min={1} value={it.qty} onChange={(e) => upd(i, { qty: Number(e.target.value) })} />
            <Input aria-label="Preço unitário" type="number" min={0} step="0.01" value={it.unitPrice} onChange={(e) => upd(i, { unitPrice: Number(e.target.value) })} />
            <Btn variant="ghost" onClick={() => setItems(items.filter((_, k) => k !== i))} disabled={items.length === 1}>Remover</Btn>
          </div>
        ))}
        <Btn variant="secondary" onClick={() => setItems([...items, { productId: "", qty: 1, unitPrice: 0 }])}>+ Item</Btn>
        <p className="mt-2 text-xs text-slate-500">Anexos: ficam no armazenamento privado do Supabase (não disponível no modo demonstração).</p>
        <div className="mt-4 flex gap-2">
          <Btn onClick={() => run(true)} disabled={ctx.readOnly}>Enviar para aprovação</Btn>
          <Btn variant="secondary" onClick={() => run(false)} disabled={ctx.readOnly}>Salvar rascunho</Btn>
          <Btn variant="ghost" onClick={() => nav(p("/compras/pedidos"))}>Cancelar</Btn>
        </div>
      </Card>
    </>
  );
}

// ---- D03 ----
function D03() {
  const ctx = useCtx();
  const act = useAct();
  const rows = ctx.db.orders.filter((o) => ctx.companyIds.includes(o.companyId) && o.status === "aguardando");
  return (
    <>
      <PageHeader code="D03" title="Aprovações de compra" subtitle="Quem pede não aprova o próprio pedido. Aprovação por administrador." />
      <DataTable rows={rows} cols={[
        { h: "Pedido", cell: (o) => o.number }, { h: "Solicitante", cell: (o) => ctx.db.profiles.find((x) => x.id === o.requestedBy)?.name }, { h: "Valor", cell: (o) => `${o.currency} ${orderTotal(o).toLocaleString("pt-BR")}`, right: true },
        { h: "", cell: (o) => (
          <span className="flex gap-1">
            <Btn disabled={!ctx.isAdmin || o.requestedBy === ctx.user.id} title={o.requestedBy === ctx.user.id ? "Você não aprova o próprio pedido" : ""} onClick={() => act((db) => decideOrder(db, o.id, true, ctx.user.id), { ok: "Aprovado.", go: p(to("/compras/pedidos/:id", { id: o.id })) })}>Aprovar</Btn>
            <ReasonButton label="Rejeitar" variant="danger" disabled={!ctx.isAdmin || o.requestedBy === ctx.user.id} onSubmit={(r) => act((db) => decideOrder(db, o.id, false, ctx.user.id, r), { ok: "Rejeitado.", go: p(`/compras/pedidos/novo?editar=${o.id}`) })} />
          </span>) },
      ]} onRow={(o) => p(to("/compras/pedidos/:id", { id: o.id }))} empty={<Empty text="Nenhum pedido aguardando aprovação." />} />
    </>
  );
}

// ---- D04 ----
function D04() {
  const ctx = useCtx();
  const { id } = useParams();
  const act = useAct();
  const o = ctx.db.orders.find((x) => x.id === id && ctx.companyIds.includes(x.companyId));
  if (!o) return <Empty text="Pedido não encontrado." action={<LinkBtn to={p("/compras/pedidos")}>Voltar</LinkBtn>} />;
  const edit = o.status === "rascunho" || o.status === "rejeitado";
  return (
    <>
      <PageHeader code="D04" title={`Pedido ${o.number}`} subtitle={<StatusBadge s={o.status} />} actions={<>
        {edit && <LinkBtn to={p(`/compras/pedidos/novo?editar=${o.id}`)}>Editar</LinkBtn>}
        {o.status === "aprovado" && <Btn onClick={() => act((db) => issueOrder(db, o.id, ctx.user.id), { ok: "Emitido ao fornecedor." })} disabled={ctx.readOnly}>Emitir ao fornecedor</Btn>}
        {["aprovado", "emitido", "parcial"].includes(o.status) && <><LinkBtn to={p(`/importacoes/novo?pedido=${o.id}`)}>Abrir importação</LinkBtn><LinkBtn variant="primary" to={p(`/estoque/entradas/nova?pedido=${o.id}`)}>Receber</LinkBtn></>}
        {o.status === "parcial" && ctx.isAdmin && <ConfirmButton label="Encerrar com pendência" message="Encerrar o pedido mesmo com itens pendentes?" onConfirm={() => act((db) => closeOrderWithPending(db, o.id, ctx.user.id), { ok: "Pedido encerrado." })} />}
        {!["recebido", "encerrado", "cancelado"].includes(o.status) && <ConfirmButton label="Cancelar pedido" message="Cancelar este pedido?" onConfirm={() => act((db) => cancelOrder(db, o.id, ctx.user.id), { ok: "Pedido cancelado.", go: p("/compras/pedidos") })} disabled={ctx.readOnly} />}
      </>} />
      <Card><KV items={[["Fornecedor", supplierName(ctx.db, o.supplierId)], ["Moeda", o.currency], ["Solicitante", ctx.db.profiles.find((x) => x.id === o.requestedBy)?.name], ["Aprovado por", ctx.db.profiles.find((x) => x.id === o.approvedBy)?.name], ["Total", `${o.currency} ${orderTotal(o).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`], ["Motivo da rejeição", o.rejectReason]]} /></Card>
      <Card title="Itens (recebido × pendente)" className="mt-3">
        <DataTable rows={o.items} cols={[{ h: "Produto", cell: (i) => ctx.db.products.find((x) => x.id === i.productId)?.name }, { h: "Pedido", cell: (i) => i.qty, right: true }, { h: "Recebido", cell: (i) => i.received, right: true }, { h: "Pendente", cell: (i) => Math.max(0, i.qty - i.received), right: true }, { h: "Preço", cell: (i) => i.unitPrice.toLocaleString("pt-BR", { minimumFractionDigits: 2 }), right: true }]} />
      </Card>
      <Card title="Entradas vinculadas" className="mt-3">
        <DataTable rows={ctx.db.inbounds.filter((i) => i.orderId === o.id)} cols={[{ h: "Entrada", cell: (i) => i.number }, { h: "Situação", cell: (i) => <StatusBadge s={i.status} /> }]} onRow={(i) => p(to("/estoque/entradas/:id", { id: i.id }))} empty={<p className="text-sm text-slate-500">Nenhuma entrada ainda.</p>} />
      </Card>
    </>
  );
}

// ---- D05 ----
function D05() {
  const ctx = useCtx();
  const rows = ctx.db.imports.filter((i) => ctx.companyIds.includes(i.companyId));
  return (
    <>
      <PageHeader code="D05" title="Processos de importação" actions={!ctx.readOnly && ctx.can("financeiro", "criar") ? <LinkBtn variant="primary" to={p("/importacoes/novo")}>Novo processo</LinkBtn> : undefined} />
      <DataTable rows={rows} cols={[
        { h: "Invoice", cell: (i) => i.invoiceNo }, { h: "Fornecedor", cell: (i) => supplierName(ctx.db, i.supplierId) }, { h: "Situação", cell: (i) => <StatusBadge s={i.status} /> },
        { h: "Moeda", cell: (i) => i.currency }, { h: "Previsão", cell: (i) => i.eta },
      ]} onRow={(i) => p(to("/importacoes/:id", { id: i.id }))} empty={<Empty text="Nenhum processo de importação." />} />
    </>
  );
}

// ---- D06 ----
function D06() {
  const ctx = useCtx();
  const act = useAct();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const order = ctx.db.orders.find((o) => o.id === sp.get("pedido"));
  const [f, setF] = useState({ invoiceNo: "", supplierId: order?.supplierId ?? "", currency: order?.currency ?? "USD", fx: "", eta: "" });
  return (
    <>
      <PageHeader code="D06" title="Novo processo de importação" subtitle={order ? `Preenchido com o pedido ${order.number}.` : undefined} />
      <Card>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Invoice"><Input value={f.invoiceNo} onChange={(e) => setF({ ...f, invoiceNo: e.target.value })} /></Field>
          <Field label="Fornecedor"><Select value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}><option value="">Escolha…</option>{ctx.db.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <Field label="Moeda"><Input value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} /></Field>
          <Field label="Câmbio de referência" hint="Obrigatório em moeda estrangeira."><Input type="number" step="0.0001" min={0} value={f.fx} onChange={(e) => setF({ ...f, fx: e.target.value })} /></Field>
          <Field label="Previsão de chegada"><Input type="date" value={f.eta} onChange={(e) => setF({ ...f, eta: e.target.value })} /></Field>
        </div>
        <p className="mt-2 text-xs text-slate-500">Não há custo final até fechar o rateio.</p>
        <div className="mt-4 flex gap-2">
          <Btn disabled={ctx.readOnly || !ctx.company} onClick={() => act((db) => createImport(db, { companyId: ctx.company!.id, orderId: order?.id, invoiceNo: f.invoiceNo, supplierId: f.supplierId, currency: f.currency, fx: f.fx ? Number(f.fx) : null, eta: f.eta }, ctx.user.id), { ok: "Processo criado.", go: (i) => p(to("/importacoes/:id", { id: i.id })) })}>Salvar</Btn>
          <Btn variant="secondary" onClick={() => nav(p("/importacoes"))}>Cancelar</Btn>
        </div>
      </Card>
    </>
  );
}

// ---- D07 ----
function D07() {
  const ctx = useCtx();
  const { id } = useParams();
  const act = useAct();
  const imp = ctx.db.imports.find((i) => i.id === id && ctx.companyIds.includes(i.companyId));
  if (!imp) return <Empty text="Processo não encontrado." action={<LinkBtn to={p("/importacoes")}>Voltar</LinkBtn>} />;
  const inbs = ctx.db.inbounds.filter((i) => i.importId === imp.id);
  const steps = [["aberto", "Aberto"], ["em_transito", "Em trânsito"], ["recebido", "Recebido"], ["fechado", "Fechado"]] as const;
  return (
    <>
      <PageHeader code="D07" title={`Importação ${imp.invoiceNo}`} actions={<>
        <LinkBtn to={p(to("/importacoes/:id/custos", { id: imp.id }))}>Custos e rateio</LinkBtn>
        <LinkBtn to={p(to("/importacoes/:id/documentos", { id: imp.id }))}>Documentos</LinkBtn>
        <LinkBtn variant="primary" to={p(`/estoque/entradas/nova?importacao=${imp.id}`)}>Receber mercadoria</LinkBtn>
        <ConfirmButton label="Fechar processo" variant="primary" message="Fechar o processo? Alteração depois exige ajuste registrado." disabled={ctx.readOnly || imp.status === "fechado"} onConfirm={() => act((db) => closeImport(db, imp.id, ctx.user.id), { ok: "Fechado" })} />
      </>} />
      <Card title="Linha do tempo">
        <ol className="flex gap-2 text-sm">{steps.map(([k, l], i) => <li key={k} className={`rounded-full px-3 py-1 ${steps.findIndex((s) => s[0] === imp.status) >= i ? "bg-sky-700 text-white" : "bg-slate-100 text-slate-500"}`}>{l}</li>)}</ol>
        <div className="mt-2 flex gap-2">
          {imp.status === "aberto" && <Btn variant="secondary" disabled={ctx.readOnly} onClick={() => act((db) => { db.imports.find((x) => x.id === imp.id)!.status = "em_transito"; })}>Marcar em trânsito</Btn>}
          {imp.status === "em_transito" && <Btn variant="secondary" disabled={ctx.readOnly} onClick={() => act((db) => { db.imports.find((x) => x.id === imp.id)!.status = "recebido"; })}>Marcar recebido</Btn>}
        </div>
      </Card>
      <Card title="Resumo" className="mt-3"><KV items={[["Fornecedor", supplierName(ctx.db, imp.supplierId)], ["Moeda / câmbio", `${imp.currency} / ${imp.fx}`], ["Custos a ratear", ctx.seeCost ? brl(importTotalCosts(imp.costs)) : "—"], ["Rateio", imp.rateioClosed ? "Fechado" : "Aberto (custo provisório)"], ["Previsão", imp.eta]]} /></Card>
      <Card title="Notas de entrada vinculadas" className="mt-3">
        <DataTable rows={inbs} cols={[{ h: "Entrada", cell: (i) => i.number }, { h: "Itens", cell: (i) => i.items.reduce((a, x) => a + x.qty, 0), right: true }, { h: "Situação", cell: (i) => <StatusBadge s={i.status} /> }]} onRow={(i) => p(to("/estoque/entradas/:id", { id: i.id }))} empty={<p className="text-sm text-slate-500">Nenhuma entrada vinculada.</p>} />
      </Card>
    </>
  );
}

// ---- D08 ----
function D08() {
  const ctx = useCtx();
  const { id } = useParams();
  const act = useAct();
  const imp = ctx.db.imports.find((i) => i.id === id && ctx.companyIds.includes(i.companyId));
  const [costs, setCosts] = useState(imp?.costs ?? { freight: 0, insurance: 0, taxes: 0, expenses: 0 });
  const [criterion, setCriterion] = useState(imp?.criterion ?? "valor");
  const [sim, setSim] = useState<Record<string, number> | null>(null);
  if (!imp) return <Empty text="Processo não encontrado." />;
  if (!ctx.seeCost) return <Empty text="Somente administradores veem e editam custos." action={<LinkBtn to={p(to("/importacoes/:id", { id: imp.id }))}>Voltar</LinkBtn>} />;
  const lines = importLines(ctx.db, imp);
  const preview = () => {
    try {
      setSim(allocate(importTotalCosts(costs), lines, criterion));
    } catch (e) {
      act(() => { throw e; });
    }
  };
  const save = () => act((db) => { const i = db.imports.find((x) => x.id === imp.id)!; i.costs = costs; i.criterion = criterion; audit(db, ctx.user.id, "importacao.custos", i.id, i.companyId); }, { ok: "Custos salvos." });
  const num = (k: keyof typeof costs, label: string) => <Field label={label}><Input type="number" min={0} step="0.01" value={costs[k]} disabled={imp.rateioClosed} onChange={(e) => setCosts({ ...costs, [k]: Number(e.target.value) })} /></Field>;
  return (
    <>
      <PageHeader code="D08" title="Custos e rateio" subtitle="Custo por equipamento = nota de entrada + rateio + custos atribuídos (RN-016). Ao fechar, atualiza o custo das séries (E08)." actions={<LinkBtn to={p(to("/importacoes/:id", { id: imp.id }))}>Voltar</LinkBtn>} />
      <Card>
        <div className="grid gap-3 sm:grid-cols-5">
          {num("freight", "Frete")}{num("insurance", "Seguro")}{num("taxes", "Tributos")}{num("expenses", "Despesas")}
          <Field label="Critério"><Select value={criterion} disabled={imp.rateioClosed} onChange={(e) => setCriterion(e.target.value as typeof criterion)}><option value="valor">Valor</option><option value="quantidade">Quantidade</option><option value="peso">Peso</option></Select></Field>
        </div>
        <p className="mt-2 text-sm">Total a ratear: <strong>{brl(importTotalCosts(costs))}</strong>. O critério deve ser validado pelo contador.</p>
        <div className="mt-3 flex gap-2">
          <Btn variant="secondary" onClick={preview}>Simular</Btn>
          <Btn variant="secondary" onClick={save} disabled={imp.rateioClosed || ctx.readOnly}>Salvar custos</Btn>
          <ConfirmButton label="Fechar rateio" variant="primary" disabled={imp.rateioClosed || ctx.readOnly} message="Fechar o rateio atualiza o custo das séries para definitivo. Depois só com ajuste registrado." onConfirm={() => act((db) => { const i = db.imports.find((x) => x.id === imp.id)!; i.costs = costs; i.criterion = criterion; closeRateio(db, imp.id, ctx.user.id); }, { ok: "Rateio fechado.", go: p(to("/importacoes/:id", { id: imp.id })) })} />
        </div>
        {imp.rateioClosed && <p className="mt-2 text-sm text-emerald-700">Rateio já fechado.</p>}
      </Card>
      {(sim ?? (imp.rateioClosed ? simulateRateio(ctx.db, imp.id) : null)) && (
        <Card title="Prévia do custo por item" className="mt-3">
          <DataTable rows={lines} cols={[
            { h: "Lote", cell: (l) => ctx.db.products.find((x) => x.id === ctx.db.inbounds.flatMap((i) => i.items).find((it) => it.id === l.id)?.productId)?.name ?? l.id },
            { h: "Qtd", cell: (l) => l.qty, right: true }, { h: "Valor (R$)", cell: (l) => brl(l.value), right: true },
            { h: "Rateio", cell: (l) => brl((sim ?? simulateRateio(ctx.db, imp.id))[l.id] ?? 0), right: true },
            { h: "Rateio por unidade", cell: (l) => brl(((sim ?? simulateRateio(ctx.db, imp.id))[l.id] ?? 0) / l.qty), right: true },
          ]} />
        </Card>
      )}
    </>
  );
}

// ---- D09 ----
function D09() {
  const ctx = useCtx();
  const { id } = useParams();
  const act = useAct();
  const imp = ctx.db.imports.find((i) => i.id === id && ctx.companyIds.includes(i.companyId));
  const [type, setType] = useState("invoice");
  const [name, setName] = useState("");
  if (!imp) return <Empty text="Processo não encontrado." />;
  return (
    <>
      <PageHeader code="D09" title="Documentos da importação" subtitle="Invoice, packing list, DI/DUIMP, notas e comprovantes. No Supabase, arquivos privados com link temporário; aqui só os dados do documento." actions={<LinkBtn to={p(to("/importacoes/:id", { id: imp.id }))}>Voltar</LinkBtn>} />
      <Card title="Anexar">
        <div className="flex flex-wrap gap-2">
          <Select className="w-44" value={type} onChange={(e) => setType(e.target.value)}>{["invoice", "packing list", "DI/DUIMP", "nota", "comprovante"].map((t) => <option key={t}>{t}</option>)}</Select>
          <Input className="w-64" placeholder="Nome do arquivo" value={name} onChange={(e) => setName(e.target.value)} />
          <label className="inline-flex cursor-pointer items-center rounded-md border border-slate-300 px-3 py-2 text-sm">Escolher arquivo<input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setName(f.name); }} /></label>
          <Btn disabled={!name.trim() || ctx.readOnly} onClick={() => act((db) => { db.imports.find((x) => x.id === imp.id)!.documents.push({ name: name.trim(), type, at: new Date().toISOString(), by: ctx.user.id }); }, { ok: "Documento anexado.", then: () => setName("") })}>Anexar</Btn>
        </div>
      </Card>
      <Card title="Documentos" className="mt-3">
        <DataTable rows={imp.documents} cols={[{ h: "Documento", cell: (d) => d.name }, { h: "Tipo", cell: (d) => d.type }, { h: "Anexado por", cell: (d) => ctx.db.profiles.find((x) => x.id === d.by)?.name }, { h: "Quando", cell: (d) => dt(d.at) }, { h: "", cell: (d) => <Btn variant="ghost" onClick={() => act(() => { throw new Error(`Download de "${d.name}" disponível com o armazenamento do Supabase (modo demonstração só guarda os dados).`); })}>Baixar</Btn> }]} empty={<Empty text="Nenhum documento anexado." />} />
      </Card>
    </>
  );
}

export const screens: Record<string, ComponentType> = { D01, D02, D03, D04, D05, D06, D07, D08, D09 };
