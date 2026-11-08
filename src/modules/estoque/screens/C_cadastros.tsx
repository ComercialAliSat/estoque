import { useState, type ComponentType } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Btn, Card, ConfirmButton, DataTable, Empty, ExportBar, Field, Input, KV, LinkBtn, Modal, PageHeader, ReadOnlyBanner, Select,
  StatusBadge, Tabs, Textarea, useAct, type Col,
} from "../components/ui";
import { audit, nextId, balance } from "../domain/core";
import { parseCsv } from "../domain/sheets";
import { customerFiscalComplete, pickTaxType, previewTaxes } from "../domain/fiscal";
import type { Customer, LocationType, Product, Service, Supplier, TaxType } from "../domain/types";
import { brl, dt } from "../format";
import { p, to } from "../routes";
import { useCtx } from "../session";

const validCnpjCpf = (v: string) => {
  const d = v.replace(/\D/g, "");
  return d.length === 11 || d.length === 14;
};

// ---- C01 ----
function C01() {
  const ctx = useCtx();
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const rows = ctx.db.products.filter((x) => (!type || x.recordType === type) && `${x.code} ${x.name} ${x.ncm}`.toLowerCase().includes(q.toLowerCase()));
  const cols: Col<Product>[] = [
    { h: "Código", cell: (r) => r.code, export: (r) => r.code },
    { h: "Nome", cell: (r) => r.name, export: (r) => r.name },
    { h: "Tipo", cell: (r) => (r.recordType === "P" ? "P · Produto para venda" : "C · Imobilizado (comodato)"), export: (r) => r.recordType },
    { h: "Classe", cell: (r) => r.klass, export: (r) => r.klass },
    { h: "Exige série", cell: (r) => (r.requiresSerial ? "Sim" : "Não"), export: (r) => (r.requiresSerial ? "Sim" : "Não") },
    { h: "NCM", cell: (r) => r.ncm, export: (r) => r.ncm },
    { h: "Situação", cell: (r) => <StatusBadge s={r.active ? "ativo" : "inativo"} />, export: (r) => (r.active ? "ativo" : "inativo") },
  ];
  return (
    <>
      <PageHeader code="C01" title="Produtos" actions={<>
        <ExportBar name="produtos" rows={rows} cols={cols} />
        {ctx.can("estoque", "criar") && !ctx.readOnly && <><LinkBtn to={p("/cadastros/produtos/importar")}>Importar planilha</LinkBtn><LinkBtn variant="primary" to={p("/cadastros/produtos/novo")}>Novo produto</LinkBtn></>}
      </>} />
      {ctx.readOnly && <ReadOnlyBanner />}
      <div className="mb-3 flex gap-2">
        <Input placeholder="Buscar por código, nome ou NCM" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
        <Select value={type} onChange={(e) => setType(e.target.value)} className="max-w-48"><option value="">Todos os tipos</option><option value="P">P · Produto para venda</option><option value="C">C · Imobilizado</option></Select>
      </div>
      <DataTable rows={rows} cols={cols} onRow={(r) => p(to("/cadastros/produtos/:id", { id: r.id }))} empty={<Empty text="Nenhum produto cadastrado." action={<LinkBtn variant="primary" to={p("/cadastros/produtos/novo")}>Novo produto</LinkBtn>} />} />
    </>
  );
}

// ---- C02 ----
function C02() {
  const ctx = useCtx();
  const { id } = useParams();
  const act = useAct();
  const nav = useNavigate();
  const cur = id ? ctx.db.products.find((x) => x.id === id) : undefined;
  const [f, setF] = useState<Product>(cur ?? { id: "", code: "", name: "", unit: "UN", recordType: "P", klass: "equipamento", requiresSerial: true, requiresIccid: false, warrantyMonths: 0, ncm: "", active: true, version: 1, kitComponents: [] });
  const [dirty, setDirty] = useState(false);
  const set = <K extends keyof Product>(k: K, v: Product[K]) => { setF({ ...f, [k]: v }); setDirty(true); };
  const [comp, setComp] = useState({ productId: "", qty: 1 });
  const cancel = () => { if (!dirty || confirm("Descartar alterações?")) nav(p("/cadastros/produtos")); };
  const save = () => {
    act((db) => {
      if (!f.code.trim() || !f.name.trim()) throw new Error("Informe código e nome.");
      if (db.products.some((x) => x.code.toLowerCase() === f.code.trim().toLowerCase() && x.id !== f.id)) throw new Error("Código já existe.");
      if (!/^\d{8}$/.test(f.ncm)) throw new Error("NCM deve ter 8 dígitos.");
      if (f.klass === "kit" && f.kitComponents.length === 0) throw new Error("Kit exige ao menos um componente.");
      if (f.id) {
        const old = db.products.find((x) => x.id === f.id)!;
        const fiscalChanged = old.ncm !== f.ncm;
        Object.assign(old, f, { version: fiscalChanged ? old.version + 1 : old.version });
        audit(db, ctx.user.id, "produto.editado", old.id);
        return old.id;
      }
      const np = { ...f, id: nextId(db, "prod") };
      db.products.push(np);
      audit(db, ctx.user.id, "produto.criado", np.id);
      return np.id;
    }, { ok: "Produto salvo.", go: (pid) => p(to("/cadastros/produtos/:id", { id: pid })) });
  };
  return (
    <>
      <PageHeader code="C02" title={cur ? "Editar produto" : "Novo produto"} />
      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Código"><Input value={f.code} onChange={(e) => set("code", e.target.value)} /></Field>
          <Field label="Nome"><Input value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Unidade"><Input value={f.unit} onChange={(e) => set("unit", e.target.value)} /></Field>
          <Field label="Tipo de registro"><Select value={f.recordType} onChange={(e) => set("recordType", e.target.value as "P" | "C")}><option value="P">P · Produto para venda</option><option value="C">C · Produto imobilizado para comodato</option></Select></Field>
          <Field label="Classe"><Select value={f.klass} onChange={(e) => set("klass", e.target.value as Product["klass"])}><option value="equipamento">Equipamento</option><option value="material">Material ou insumo</option><option value="kit">Kit</option></Select></Field>
          <Field label="NCM (8 dígitos)"><Input value={f.ncm} maxLength={8} onChange={(e) => set("ncm", e.target.value.replace(/\D/g, ""))} /></Field>
          <Field label="Garantia (meses)"><Input type="number" min={0} value={f.warrantyMonths} onChange={(e) => set("warrantyMonths", Number(e.target.value))} /></Field>
          <div className="flex items-end gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.requiresSerial} onChange={(e) => set("requiresSerial", e.target.checked)} /> Exige série</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.requiresIccid} onChange={(e) => set("requiresIccid", e.target.checked)} /> Exige ICCID</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.active} onChange={(e) => set("active", e.target.checked)} /> Ativo</label>
          </div>
        </div>
        {f.klass === "kit" && (
          <div className="mt-4 rounded-lg border border-slate-200 p-3">
            <h3 className="mb-2 text-sm font-semibold">Componentes do kit</h3>
            <ul className="mb-2 text-sm">{f.kitComponents.map((c) => <li key={c.productId}>{c.qty} × {ctx.db.products.find((x) => x.id === c.productId)?.name} <Btn variant="ghost" onClick={() => set("kitComponents", f.kitComponents.filter((k) => k.productId !== c.productId))}>remover</Btn></li>)}</ul>
            <div className="flex gap-2">
              <Select value={comp.productId} onChange={(e) => setComp({ ...comp, productId: e.target.value })}><option value="">Escolha o componente</option>{ctx.db.products.filter((x) => x.klass !== "kit" && x.id !== f.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>
              <Input type="number" min={1} value={comp.qty} onChange={(e) => setComp({ ...comp, qty: Number(e.target.value) })} className="w-24" />
              <Btn variant="secondary" disabled={!comp.productId} onClick={() => { set("kitComponents", [...f.kitComponents.filter((k) => k.productId !== comp.productId), comp]); setComp({ productId: "", qty: 1 }); }}>Adicionar</Btn>
            </div>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500">Mudança em campo fiscal (NCM) cria nova versão e vale só para notas futuras.</p>
        <div className="mt-4 flex gap-2"><Btn onClick={save} disabled={ctx.readOnly || !ctx.can("estoque", cur ? "editar" : "criar")}>Salvar</Btn><Btn variant="secondary" onClick={cancel}>Cancelar</Btn></div>
      </Card>
    </>
  );
}

// ---- C03 ----
function C03() {
  const ctx = useCtx();
  const { id } = useParams();
  const prod = ctx.db.products.find((x) => x.id === id);
  if (!prod) return <Empty text="Produto não encontrado." action={<LinkBtn to={p("/cadastros/produtos")}>Voltar</LinkBtn>} />;
  const stock = ctx.companyIds.map((cid) => ({ cid, loc: ctx.db.locations.filter((l) => l.companyId === cid).map((l) => ({ l, q: balance(ctx.db, cid, prod.id, l.id) })).filter((x) => x.q !== 0) }));
  const movs = ctx.db.movements.filter((m) => m.productId === prod.id && ctx.companyIds.includes(m.companyId)).slice(-8).reverse();
  return (
    <>
      <PageHeader code="C03" title={prod.name} subtitle={`${prod.code} · versão ${prod.version}`} actions={<>
        <LinkBtn to={p(to("/cadastros/produtos/:id/editar", { id: prod.id }))}>Editar</LinkBtn>
        <LinkBtn to={p(to("/estoque/produtos/:id", { id: prod.id }))}>Ver equipamentos</LinkBtn>
        <LinkBtn to={p("/cadastros/tributacao/produtos")}>Ver CFOP e NCM</LinkBtn>
        <LinkBtn to={p("/cadastros/produtos")}>Voltar</LinkBtn></>} />
      <Card><KV items={[["Tipo", prod.recordType === "P" ? "P · Produto para venda" : "C · Imobilizado"], ["Classe", prod.klass], ["Exige série", prod.requiresSerial ? "Sim" : "Não"], ["NCM", prod.ncm], ["Garantia", `${prod.warrantyMonths} meses`], ["Situação", <StatusBadge key="s" s={prod.active ? "ativo" : "inativo"} />]]} /></Card>
      <Card title="Saldo por empresa e local" className="mt-3">
        {stock.every((s) => s.loc.length === 0) ? <p className="text-sm text-slate-500">Sem saldo.</p> : stock.map((s) => (
          <div key={s.cid} className="mb-2 text-sm"><strong>{ctx.db.companies.find((c) => c.id === s.cid)?.name}</strong>: {s.loc.map((x) => `${x.l.name} (${x.q})`).join(" · ")}</div>
        ))}
      </Card>
      <Card title="Últimas movimentações" className="mt-3">
        <DataTable rows={movs} cols={[{ h: "Quando", cell: (m) => dt(m.at) }, { h: "Tipo", cell: (m) => m.kind }, { h: "Qtd", cell: (m) => m.qty, right: true }]} empty={<p className="text-sm text-slate-500">Sem movimentações.</p>} />
      </Card>
    </>
  );
}

// ---- C04 ----
function C04() {
  const ctx = useCtx();
  const act = useAct();
  const nav = useNavigate();
  const [text, setText] = useState("");
  const header = "codigo;nome;tipo(P/C);classe(equipamento/material/kit);exige_serie(S/N);ncm;garantia_meses";
  const rows = text.trim() ? parseCsv(text).filter((r, i) => !(i === 0 && r[0].toLowerCase().startsWith("codigo"))) : [];
  const parsed = rows.map((r, i) => {
    const [code, name, tipo, klass, serie, ncm, gar] = r;
    const errs: string[] = [];
    if (!code) errs.push("código vazio");
    if (!name) errs.push("nome vazio");
    if (tipo !== "P" && tipo !== "C") errs.push("tipo deve ser P ou C");
    if (!["equipamento", "material", "kit"].includes(klass)) errs.push("classe inválida");
    if (!/^\d{8}$/.test(ncm ?? "")) errs.push("NCM deve ter 8 dígitos");
    if (ctx.db.products.some((x) => x.code === code)) errs.push("código já existe");
    return { line: i + 1, code, name, tipo, klass, serie, ncm, gar, errs };
  });
  const ok = parsed.filter((x) => x.errs.length === 0);
  const model = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([header + "\r\nCAM-200;Câmera exemplo;P;equipamento;S;85258999;12"], { type: "text/csv" })); a.download = "modelo-produtos.csv"; a.click(); };
  return (
    <>
      <PageHeader code="C04" title="Importar produtos por planilha" subtitle="Nada é gravado antes de confirmar. Linha com erro é listada e não bloqueia as demais." />
      <Card>
        <div className="mb-3 flex gap-2">
          <Btn variant="secondary" onClick={model}>Baixar modelo</Btn>
          <label className="inline-flex cursor-pointer items-center rounded-md border border-slate-300 px-3 py-2 text-sm">Enviar arquivo CSV<input type="file" accept=".csv,text/csv" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} /></label>
        </div>
        <Field label="Ou cole o conteúdo do CSV"><Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={header} /></Field>
        {parsed.length > 0 && (
          <div className="mt-3 text-sm">
            <p><strong>{ok.length}</strong> linha(s) válida(s), <strong className="text-red-700">{parsed.length - ok.length}</strong> com erro.</p>
            <ul className="mt-1 list-disc pl-5 text-red-700">{parsed.filter((x) => x.errs.length).map((x) => <li key={x.line}>Linha {x.line} ({x.code || "sem código"}): {x.errs.join(", ")}</li>)}</ul>
          </div>
        )}
        <div className="mt-4 flex gap-2">
          <Btn disabled={ok.length === 0 || !ctx.can("estoque", "criar")} onClick={() => act((db) => {
            for (const x of ok) db.products.push({ id: nextId(db, "prod"), code: x.code, name: x.name, unit: "UN", recordType: x.tipo as "P" | "C", klass: x.klass as Product["klass"], requiresSerial: x.serie?.toUpperCase() === "S", requiresIccid: false, warrantyMonths: Number(x.gar) || 0, ncm: x.ncm, active: true, version: 1, kitComponents: [] });
            audit(db, ctx.user.id, "produto.importacao", "planilha", undefined, `${ok.length} produtos`);
            return ok.length;
          }, { ok: (n) => `${n} produtos importados`, go: p("/cadastros/produtos") })}>Confirmar importação</Btn>
          <Btn variant="secondary" onClick={() => nav(p("/cadastros/produtos"))}>Cancelar</Btn>
        </div>
      </Card>
    </>
  );
}

// ---- C05 ----
function C05() {
  const ctx = useCtx();
  const [q, setQ] = useState("");
  const rows = ctx.db.customers.filter((c) => c.companyIds.some((id) => ctx.companyIds.includes(id)) && `${c.name} ${c.document}`.toLowerCase().includes(q.toLowerCase()));
  const cols: Col<Customer>[] = [
    { h: "Nome", cell: (r) => r.name, export: (r) => r.name },
    { h: "CNPJ/CPF", cell: (r) => r.document, export: (r) => r.document },
    { h: "Empresas", cell: (r) => r.companyIds.map((id) => ctx.db.companies.find((c) => c.id === id)?.name).join(", "), export: (r) => r.companyIds.join("/") },
    { h: "Origem", cell: (r) => (r.origin === "crm" ? "CRM" : "Manual"), export: (r) => r.origin },
    { h: "Cadastro fiscal", cell: (r) => { const m = customerFiscalComplete(r); return m.length ? <StatusBadge s={`pendente: ${m.join(", ")}`} /> : <StatusBadge s="ok" />; } },
  ];
  return (
    <>
      <PageHeader code="C05" title="Clientes" actions={<><ExportBar name="clientes" rows={rows} cols={cols} />{ctx.can("estoque", "criar") && !ctx.readOnly && <LinkBtn variant="primary" to={p("/cadastros/clientes/novo")}>Novo cliente</LinkBtn>}</>} />
      <div className="mb-3"><Input className="max-w-sm" placeholder="Buscar por nome ou CNPJ/CPF" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <DataTable rows={rows} cols={cols} onRow={(r) => p(to("/cadastros/clientes/:id", { id: r.id }))} empty={<Empty text="Nenhum cliente encontrado." />} />
    </>
  );
}

// ---- C06 ----
function C06() {
  const ctx = useCtx();
  const { id } = useParams();
  const act = useAct();
  const nav = useNavigate();
  const cur = id ? ctx.db.customers.find((c) => c.id === id) : undefined;
  const [f, setF] = useState<Customer>(cur ?? { id: "", name: "", document: "", stateReg: "", taxpayer: false, city: "", uf: "", companyIds: ctx.company ? [ctx.company.id] : [], origin: "manual", active: true });
  const crmLocked = f.origin === "crm";
  const save = () => act((db) => {
    if (!f.name.trim()) throw new Error("Informe o nome.");
    if (!validCnpjCpf(f.document)) throw new Error("CNPJ/CPF inválido (11 ou 14 dígitos).");
    const dup = db.customers.find((c) => c.document.replace(/\D/g, "") === f.document.replace(/\D/g, "") && c.id !== f.id);
    if (dup) throw new Error("CNPJ/CPF já cadastrado.");
    if (f.companyIds.length === 0) throw new Error("Escolha ao menos uma empresa.");
    if (f.id) { Object.assign(db.customers.find((c) => c.id === f.id)!, f); return f.id; }
    const nc = { ...f, id: nextId(db, "cli") };
    db.customers.push(nc);
    return nc.id;
  }, { ok: "Cliente salvo.", go: (cid) => p(to("/cadastros/clientes/:id", { id: cid })) });
  return (
    <>
      <PageHeader code="C06" title={cur ? "Editar cliente" : "Novo cliente"} subtitle={crmLocked ? "Campos que vêm do CRM ficam somente leitura (dono do dado a confirmar)." : undefined} />
      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome"><Input value={f.name} disabled={crmLocked} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="CNPJ/CPF"><Input value={f.document} disabled={crmLocked} onChange={(e) => setF({ ...f, document: e.target.value })} /></Field>
          <Field label="Inscrição estadual"><Input value={f.stateReg} onChange={(e) => setF({ ...f, stateReg: e.target.value })} /></Field>
          <Field label="Contribuinte" hint="Define o DIFAL na emissão."><Select value={f.taxpayer ? "s" : "n"} onChange={(e) => setF({ ...f, taxpayer: e.target.value === "s" })}><option value="n">Não contribuinte</option><option value="s">Contribuinte</option></Select></Field>
          <Field label="Cidade"><Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
          <Field label="UF"><Input value={f.uf} maxLength={2} onChange={(e) => setF({ ...f, uf: e.target.value.toUpperCase() })} /></Field>
          <Field label="Empresas de vínculo">
            <div className="flex gap-3 text-sm">{ctx.db.companies.filter((c) => ctx.user.companyIds.includes(c.id)).map((c) => <label key={c.id} className="flex items-center gap-1"><input type="checkbox" checked={f.companyIds.includes(c.id)} onChange={(e) => setF({ ...f, companyIds: e.target.checked ? [...f.companyIds, c.id] : f.companyIds.filter((x) => x !== c.id) })} />{c.name}</label>)}</div>
          </Field>
          <Field label="ID no CRM"><Input value={f.crmId ?? ""} disabled={crmLocked} onChange={(e) => setF({ ...f, crmId: e.target.value })} /></Field>
        </div>
        <div className="mt-4 flex gap-2"><Btn onClick={save} disabled={ctx.readOnly || !ctx.can("estoque", cur ? "editar" : "criar")}>Salvar</Btn><Btn variant="secondary" onClick={() => nav(p("/cadastros/clientes"))}>Cancelar</Btn></div>
      </Card>
    </>
  );
}

// ---- C07 ----
function C07() {
  const ctx = useCtx();
  const { id } = useParams();
  const [tab, setTab] = useState("Visão geral");
  const c = ctx.db.customers.find((x) => x.id === id);
  if (!c || !c.companyIds.some((cid) => ctx.companyIds.includes(cid))) return <Empty text="Cliente não encontrado nesta empresa." action={<LinkBtn to={p("/cadastros/clientes")}>Voltar</LinkBtn>} />;
  const { db } = ctx;
  const sold = db.outbounds.filter((o) => o.customerId === c.id && (o.status === "nota_autorizada" || o.status === "enviada") && ctx.companyIds.includes(o.companyId));
  const contracts = db.contracts.filter((k) => k.customerId === c.id && ctx.companyIds.includes(k.companyId));
  const invoices = db.invoices.filter((i) => i.customerId === c.id && ctx.companyIds.includes(i.companyId));
  const wos = db.workOrders.filter((o) => o.customerId === c.id && ctx.companyIds.includes(o.companyId));
  const eq = sold.flatMap((o) => o.serials.map((s) => ({ s, kind: o.kind })));
  return (
    <>
      <PageHeader code="C07" title={c.name} subtitle={c.document} actions={<><LinkBtn to={p(to("/cadastros/clientes/:id/editar", { id: c.id }))}>Editar</LinkBtn><LinkBtn to={p("/os/nova")}>Nova OS</LinkBtn><LinkBtn to={p("/comercial/contratos/novo")}>Novo comodato</LinkBtn></>} />
      <Tabs tabs={["Visão geral", "Equipamentos", "Contratos", "Notas", "OS", "Documentos", "Histórico"]} value={tab} onChange={setTab} />
      {tab === "Visão geral" && <Card><KV items={[["Contribuinte", c.taxpayer ? "Sim" : "Não"], ["IE", c.stateReg], ["Cidade/UF", `${c.city}/${c.uf}`], ["Origem", c.origin], ["ID no CRM", c.crmId]]} /></Card>}
      {tab === "Equipamentos" && <DataTable rows={eq} cols={[{ h: "Série", cell: (r) => r.s }, { h: "Situação", cell: (r) => (r.kind === "comodato" ? "Comodato" : "Vendido") }]} onRow={(r) => p(to("/estoque/equipamentos/:id", { id: db.serials.find((x) => x.serial === r.s)?.id ?? "" }))} empty={<Empty text="Sem equipamentos." />} />}
      {tab === "Contratos" && <DataTable rows={contracts} cols={[{ h: "Contrato", cell: (r) => r.number }, { h: "Vigência", cell: (r) => `${r.start} a ${r.end}` }, { h: "Situação", cell: (r) => <StatusBadge s={r.status} /> }]} onRow={(r) => p(to("/comercial/contratos/:id", { id: r.id }))} empty={<Empty text="Sem contratos." />} />}
      {tab === "Notas" && <DataTable rows={invoices} cols={[{ h: "Nota", cell: (r) => r.number ?? "rascunho" }, { h: "Situação", cell: (r) => <StatusBadge s={r.status} /> }, { h: "Total", cell: (r) => brl(r.total), right: true }]} onRow={(r) => p(to("/fiscal/notas/:id", { id: r.id }))} empty={<Empty text="Sem notas." />} />}
      {tab === "OS" && <DataTable rows={wos} cols={[{ h: "OS", cell: (r) => r.number }, { h: "Placa", cell: (r) => r.plate }, { h: "Situação", cell: (r) => <StatusBadge s={r.status} /> }]} onRow={(r) => p(to("/os/:id", { id: r.id }))} empty={<Empty text="Sem OS." />} />}
      {tab === "Documentos" && <Empty text="Documentos do cliente (contratos assinados etc.) entram com o armazenamento privado do Supabase." />}
      {tab === "Histórico" && <DataTable rows={db.audit.filter((a) => a.ref === c.id)} cols={[{ h: "Quando", cell: (a) => dt(a.at) }, { h: "Ação", cell: (a) => a.action }]} empty={<Empty text="Sem histórico." />} />}
    </>
  );
}

// ---- C08 / C09 ----
function C08() {
  const ctx = useCtx();
  const cols: Col<Supplier>[] = [
    { h: "Nome", cell: (r) => r.name, export: (r) => r.name }, { h: "País", cell: (r) => r.country, export: (r) => r.country },
    { h: "Documento", cell: (r) => r.document, export: (r) => r.document }, { h: "Moeda", cell: (r) => r.currency, export: (r) => r.currency }, { h: "Prazo", cell: (r) => r.terms },
  ];
  return (
    <>
      <PageHeader code="C08" title="Fornecedores" actions={<><ExportBar name="fornecedores" rows={ctx.db.suppliers} cols={cols} />{ctx.can("estoque", "criar") && !ctx.readOnly && <LinkBtn variant="primary" to={p("/cadastros/fornecedores/novo")}>Novo fornecedor</LinkBtn>}</>} />
      <DataTable rows={ctx.db.suppliers} cols={cols} onRow={(r) => p(to("/cadastros/fornecedores/:id", { id: r.id }))} />
    </>
  );
}
function C09() {
  const ctx = useCtx();
  const { id } = useParams();
  const act = useAct();
  const nav = useNavigate();
  const cur = id ? ctx.db.suppliers.find((s) => s.id === id) : undefined;
  const [f, setF] = useState<Supplier>(cur ?? { id: "", name: "", country: "BR", document: "", currency: "BRL", terms: "", active: true });
  const save = () => act((db) => {
    if (!f.name.trim()) throw new Error("Informe o nome.");
    if (f.country === "BR" && f.document.replace(/\D/g, "").length !== 14) throw new Error("CNPJ válido (14 dígitos) é obrigatório para fornecedor do Brasil.");
    if (f.country !== "BR" && !f.document.trim()) throw new Error("Informe a identificação estrangeira.");
    if (f.id) { Object.assign(db.suppliers.find((s) => s.id === f.id)!, f); audit(db, ctx.user.id, "fornecedor.editado", f.id); }
    else db.suppliers.push({ ...f, id: nextId(db, "for") });
  }, { ok: "Fornecedor salvo.", go: p("/cadastros/fornecedores") });
  return (
    <>
      <PageHeader code="C09" title={cur ? cur.name : "Novo fornecedor"} actions={cur ? <LinkBtn to={p("/compras/pedidos/novo")}>Novo pedido</LinkBtn> : undefined} />
      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="País"><Select value={f.country} onChange={(e) => setF({ ...f, country: e.target.value as Supplier["country"], currency: e.target.value === "BR" ? "BRL" : "USD" })}><option value="BR">Brasil</option><option value="CN">China</option><option value="OUTRO">Outro</option></Select></Field>
          <Field label={f.country === "BR" ? "CNPJ" : "Identificação estrangeira"}><Input value={f.document} onChange={(e) => setF({ ...f, document: e.target.value })} /></Field>
          <Field label="Moeda"><Input value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} /></Field>
          <Field label="Prazo / condições de garantia e RMA" className="sm:col-span-2"><Textarea rows={2} value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} /></Field>
        </div>
        <div className="mt-4 flex gap-2"><Btn onClick={save} disabled={ctx.readOnly || !ctx.can("estoque", "editar")}>Salvar</Btn><Btn variant="secondary" onClick={() => nav(p("/cadastros/fornecedores"))}>Cancelar</Btn></div>
      </Card>
    </>
  );
}

// ---- C10 / C11 ----
function C10() {
  const ctx = useCtx();
  const rows = ctx.db.locations.filter((l) => ctx.companyIds.includes(l.companyId));
  return (
    <>
      <PageHeader code="C10" title="Locais de estoque" actions={ctx.can("estoque", "criar") && !ctx.readOnly ? <LinkBtn variant="primary" to={p("/cadastros/locais/novo")}>Novo local</LinkBtn> : undefined} />
      <DataTable rows={rows} cols={[
        { h: "Nome", cell: (r) => r.name }, { h: "Tipo", cell: (r) => r.type }, { h: "Empresa", cell: (r) => ctx.db.companies.find((c) => c.id === r.companyId)?.name },
        { h: "Itens", cell: (r) => ctx.db.serials.filter((s) => s.locationId === r.id).length, right: true }, { h: "Situação", cell: (r) => <StatusBadge s={r.active ? "ativo" : "inativo"} /> },
      ]} onRow={(r) => p(to("/cadastros/locais/:id", { id: r.id }))} />
    </>
  );
}
function C11() {
  const ctx = useCtx();
  const { id } = useParams();
  const act = useAct();
  const nav = useNavigate();
  const cur = id ? ctx.db.locations.find((l) => l.id === id) : undefined;
  const [f, setF] = useState({ name: cur?.name ?? "", type: (cur?.type ?? "deposito") as LocationType, responsible: cur?.responsible ?? "", active: cur?.active ?? true });
  const items = cur ? ctx.db.serials.filter((s) => s.locationId === cur.id) : [];
  const save = () => act((db) => {
    if (!f.name.trim()) throw new Error("Informe o nome do local.");
    if (cur) {
      const l = db.locations.find((x) => x.id === cur.id)!;
      if (!f.active && db.serials.some((s) => s.locationId === l.id)) throw new Error("Local só é inativado se estiver sem itens.");
      Object.assign(l, f);
    } else {
      if (!ctx.company) throw new Error("Escolha uma empresa.");
      db.locations.push({ id: nextId(db, "loc"), companyId: ctx.company.id, ...f });
    }
  }, { ok: "Local salvo.", go: p("/cadastros/locais") });
  return (
    <>
      <PageHeader code="C11" title={cur ? cur.name : "Novo local"} actions={cur ? <><LinkBtn to={p("/estoque/etiquetas")}>Imprimir etiqueta do local</LinkBtn><LinkBtn to={p("/estoque/posicao")}>Ver itens</LinkBtn></> : undefined} />
      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Tipo"><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as LocationType })}>{["deposito", "transito", "tecnico", "cliente", "manutencao", "quarentena"].map((t) => <option key={t}>{t}</option>)}</Select></Field>
          <Field label="Responsável"><Input value={f.responsible} onChange={(e) => setF({ ...f, responsible: e.target.value })} /></Field>
          <label className="flex items-end gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Ativo</label>
        </div>
        <p className="mt-3 text-xs text-slate-500">O local não define o dono do item. Técnico terceiro (N3) existe como local, sem login.</p>
        <div className="mt-4 flex gap-2"><Btn onClick={save} disabled={ctx.readOnly || !ctx.can("estoque", "editar")}>Salvar</Btn><Btn variant="secondary" onClick={() => nav(p("/cadastros/locais"))}>Cancelar</Btn></div>
      </Card>
      {cur && <Card title={`Itens neste local (${items.length})`} className="mt-3"><DataTable rows={items.slice(0, 50)} cols={[{ h: "Série", cell: (s) => s.serial }, { h: "Situação", cell: (s) => <StatusBadge s={s.commercial} /> }]} onRow={(s) => p(to("/estoque/equipamentos/:id", { id: s.id }))} empty={<p className="text-sm text-slate-500">Sem itens.</p>} /></Card>}
    </>
  );
}

// ---- C12 / C13 ----
function C12() {
  const ctx = useCtx();
  const nav = useNavigate();
  const act = useAct();
  const rows = ctx.db.taxTypes.filter((t) => ctx.companyIds.includes(t.companyId));
  return (
    <>
      <PageHeader code="C12" title="Tipos de tributação" subtitle="Regras fiscais são dados editáveis; nada fixo no código. Os tipos de exemplo vêm com alíquota zero e precisam ser validados pelo Fiscal/contador." actions={ctx.can("fiscal", "criar") && !ctx.readOnly ? <LinkBtn variant="primary" to={p("/cadastros/tributacao/novo")}>Novo tipo</LinkBtn> : undefined} />
      <DataTable rows={rows} cols={[
        { h: "Nome", cell: (r) => r.name }, { h: "Empresa", cell: (r) => ctx.db.companies.find((c) => c.id === r.companyId)?.name }, { h: "Operação", cell: (r) => r.operation },
        { h: "UF origem → destino", cell: (r) => `${r.ufFrom} → ${r.ufTo}` }, { h: "Versão", cell: (r) => r.version, right: true }, { h: "Situação", cell: (r) => <StatusBadge s={r.active ? "ativo" : "inativo"} /> },
        { h: "", cell: (r) => <Btn variant="ghost" disabled={ctx.readOnly || !ctx.can("fiscal", "criar")} onClick={() => act((db) => { const id = nextId(db, "tax"); db.taxTypes.push({ ...r, id, name: `${r.name} (cópia)`, version: 1 }); return id; }, { go: (id) => p(to("/cadastros/tributacao/:id", { id })) })}>Duplicar</Btn> },
      ]} onRow={(r) => p(to("/cadastros/tributacao/:id", { id: r.id }))} />
      <div className="mt-3"><Btn variant="ghost" onClick={() => nav(p("/cadastros/tributacao/produtos"))}>CFOP e NCM por produto →</Btn></div>
    </>
  );
}

function C13() {
  const ctx = useCtx();
  const { id } = useParams();
  const act = useAct();
  const nav = useNavigate();
  const cur = id ? ctx.db.taxTypes.find((t) => t.id === id) : undefined;
  const [f, setF] = useState<TaxType>(cur ?? { id: "", companyId: ctx.company?.id ?? "", name: "", operation: "venda", ufFrom: "*", ufTo: "*", taxpayer: "qualquer", partnerFinancier: false, cfop: "", cst: "", icms: 0, ipi: 0, pis: 0, cofins: 0, message: "", version: 1, active: true });
  const [ex, setEx] = useState({ qty: 1, unit: 1000 });
  const prev = previewTaxes(f, [{ qty: ex.qty, unitValue: ex.unit }]);
  const n = (k: "icms" | "ipi" | "pis" | "cofins") => <Field label={`${k.toUpperCase()} (%)`}><Input type="number" step="0.01" min={0} value={f[k]} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) })} /></Field>;
  const save = () => act((db) => {
    if (!f.name.trim()) throw new Error("Informe o nome.");
    if (f.cfop && !/^\d{4}$/.test(f.cfop)) throw new Error("CFOP deve ter 4 dígitos.");
    if (cur) {
      audit(db, ctx.user.id, "tributacao.nova_versao", cur.id, cur.companyId, `v${cur.version} → v${cur.version + 1}`);
      Object.assign(db.taxTypes.find((t) => t.id === cur.id)!, f, { version: cur.version + 1 });
    } else db.taxTypes.push({ ...f, id: nextId(db, "tax"), companyId: ctx.company!.id });
  }, { ok: "Tipo de tributação salvo (nova versão).", go: p("/cadastros/tributacao") });
  const sel = pickTaxType(ctx.db, { companyId: f.companyId, operation: f.operation, ufFrom: f.ufFrom === "*" ? "RS" : f.ufFrom, ufTo: f.ufTo === "*" ? "SP" : f.ufTo, taxpayer: f.taxpayer === "sim" });
  return (
    <>
      <PageHeader code="C13" title={cur ? `Editor: ${cur.name}` : "Novo tipo de tributação"} subtitle="A regra mais específica vence (RN-017). Fiscal ou contador valida antes de ativar." />
      <Card>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Nome"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Operação"><Select value={f.operation} onChange={(e) => setF({ ...f, operation: e.target.value as TaxType["operation"] })}>{["venda", "comodato", "remessa", "retorno", "devolucao", "transferencia", "perda"].map((o) => <option key={o}>{o}</option>)}</Select></Field>
          <Field label="Contribuinte"><Select value={f.taxpayer} onChange={(e) => setF({ ...f, taxpayer: e.target.value as TaxType["taxpayer"] })}><option value="qualquer">Qualquer</option><option value="sim">Sim</option><option value="nao">Não</option></Select></Field>
          <Field label="UF origem (* = qualquer)"><Input value={f.ufFrom} onChange={(e) => setF({ ...f, ufFrom: e.target.value.toUpperCase() })} /></Field>
          <Field label="UF destino (* = qualquer)"><Input value={f.ufTo} onChange={(e) => setF({ ...f, ufTo: e.target.value.toUpperCase() })} /></Field>
          <label className="flex items-end gap-2 text-sm"><input type="checkbox" checked={f.partnerFinancier} onChange={(e) => setF({ ...f, partnerFinancier: e.target.checked })} /> Venda por financeira parceira</label>
          <Field label="CFOP"><Input value={f.cfop} maxLength={4} onChange={(e) => setF({ ...f, cfop: e.target.value })} /></Field>
          <Field label="CST/CSOSN"><Input value={f.cst} onChange={(e) => setF({ ...f, cst: e.target.value })} /></Field>
          <div />
          {n("icms")}{n("ipi")}{n("pis")}{n("cofins")}
          <Field label="Mensagem da nota" className="sm:col-span-3"><Textarea rows={2} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></Field>
        </div>
        <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm">
          <strong>Simular com exemplo</strong>
          <div className="my-2 flex gap-2"><Input type="number" className="w-24" value={ex.qty} onChange={(e) => setEx({ ...ex, qty: Number(e.target.value) })} aria-label="Quantidade" /><Input type="number" className="w-32" value={ex.unit} onChange={(e) => setEx({ ...ex, unit: Number(e.target.value) })} aria-label="Valor unitário" /></div>
          <p>Base {brl(prev.base)} · {prev.lines.map((l) => `${l.name} ${brl(l.value)}`).join(" · ")} · <strong>Total de impostos {brl(prev.total)}</strong></p>
          <p className="mt-1 text-xs text-slate-500">Neste exemplo (operação {f.operation}, RS → SP) a regra escolhida seria: {sel ? sel.name : "nenhuma regra ativa encontrada"}.</p>
        </div>
        <div className="mt-4 flex gap-2"><Btn onClick={save} disabled={ctx.readOnly || !ctx.can("fiscal", cur ? "editar" : "criar")}>Salvar</Btn><Btn variant="secondary" onClick={() => nav(p("/cadastros/tributacao"))}>Cancelar</Btn></div>
      </Card>
    </>
  );
}

// ---- C14 ----
function C14() {
  const ctx = useCtx();
  const act = useAct();
  const UFS = ["RS", "SC", "PR", "SP", "RJ", "MG"];
  const [draft, setDraft] = useState<Record<string, { ncm: string; cfop: string }>>({});
  const [copyFrom, setCopyFrom] = useState("RS");
  const [copyTo, setCopyTo] = useState("SC");
  const key = (pid: string, uf: string) => `${pid}|${uf}`;
  const val = (pid: string, uf: string) => draft[key(pid, uf)] ?? ctx.db.productTax.find((x) => x.productId === pid && x.uf === uf) ?? { ncm: ctx.db.products.find((x) => x.id === pid)?.ncm ?? "", cfop: "" };
  const edit = (pid: string, uf: string, patch: Partial<{ ncm: string; cfop: string }>) => setDraft({ ...draft, [key(pid, uf)]: { ...val(pid, uf), ...patch } });
  const copy = () => {
    const d = { ...draft };
    ctx.db.products.forEach((pr) => { const v = val(pr.id, copyFrom); d[key(pr.id, copyTo)] = { ncm: v.ncm, cfop: v.cfop }; });
    setDraft(d);
  };
  const save = () => act((db) => {
    for (const [k, v] of Object.entries(draft)) {
      const [productId, uf] = k.split("|");
      if (v.ncm && !/^\d{8}$/.test(v.ncm)) throw new Error(`NCM deve ter 8 dígitos (${productId}/${uf}).`);
      if (v.cfop && !/^\d{4}$/.test(v.cfop)) throw new Error(`CFOP deve ter 4 dígitos (${productId}/${uf}).`);
      const ex = db.productTax.find((x) => x.productId === productId && x.uf === uf);
      if (ex) Object.assign(ex, v); else db.productTax.push({ productId, uf, ...v });
    }
    audit(db, ctx.user.id, "tributacao.produto_uf", "lote", undefined, `${Object.keys(draft).length} células`);
  }, { ok: "Salvo", then: () => setDraft({}) });
  return (
    <>
      <PageHeader code="C14" title="CFOP e NCM por produto" subtitle="Produto × estado. A alteração vale para notas futuras. Rascunho até salvar." actions={<Btn onClick={save} disabled={Object.keys(draft).length === 0 || ctx.readOnly || !ctx.can("fiscal", "editar")}>Salvar ({Object.keys(draft).length})</Btn>} />
      <div className="mb-3 flex items-end gap-2 text-sm">
        <Field label="Copiar de"><Select value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>{UFS.map((u) => <option key={u}>{u}</option>)}</Select></Field>
        <Field label="para"><Select value={copyTo} onChange={(e) => setCopyTo(e.target.value)}>{UFS.map((u) => <option key={u}>{u}</option>)}</Select></Field>
        <Btn variant="secondary" onClick={copy}>Copiar (prévia em rascunho)</Btn>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-2 py-2 text-left">Produto</th>{UFS.map((u) => <th key={u} className="px-2 py-2">{u} (NCM / CFOP)</th>)}</tr></thead>
          <tbody>{ctx.db.products.map((pr) => (
            <tr key={pr.id} className="border-t border-slate-100"><td className="px-2 py-1"><a className="text-sky-800 hover:underline" href={p(to("/cadastros/produtos/:id", { id: pr.id }))}>{pr.name}</a></td>
              {UFS.map((u) => { const v = val(pr.id, u); const dirty = !!draft[key(pr.id, u)]; return (
                <td key={u} className={`px-1 py-1 ${dirty ? "bg-amber-50" : ""}`}><div className="flex gap-1"><input aria-label={`NCM ${pr.code} ${u}`} className="w-24 rounded border border-slate-300 px-1" value={v.ncm} maxLength={8} onChange={(e) => edit(pr.id, u, { ncm: e.target.value.replace(/\D/g, "") })} /><input aria-label={`CFOP ${pr.code} ${u}`} className="w-14 rounded border border-slate-300 px-1" value={v.cfop} maxLength={4} onChange={(e) => edit(pr.id, u, { cfop: e.target.value.replace(/\D/g, "") })} /></div></td>
              ); })}
            </tr>))}</tbody></table>
      </div>
    </>
  );
}

// ---- C15 ----
function C15() {
  const ctx = useCtx();
  const act = useAct();
  const [edit, setEdit] = useState<Service | null>(null);
  const blank: Service = { id: "", code: "", name: "", kind: "instalacao", defaultPrice: 0, defaultCost: 0, active: true };
  const cols: Col<Service>[] = [
    { h: "Código", cell: (s) => s.code, export: (s) => s.code }, { h: "Serviço", cell: (s) => s.name, export: (s) => s.name }, { h: "Tipo", cell: (s) => s.kind, export: (s) => s.kind },
    { h: "Valor cobrado padrão", cell: (s) => brl(s.defaultPrice), right: true, export: (s) => s.defaultPrice },
    { h: "Custo padrão", cell: (s) => (ctx.seeCost ? brl(s.defaultCost) : "—"), right: true, export: (s) => (ctx.seeCost ? s.defaultCost : "") },
    { h: "Situação", cell: (s) => <StatusBadge s={s.active ? "ativo" : "inativo"} /> },
    { h: "", cell: (s) => <span className="flex gap-1"><Btn variant="ghost" disabled={ctx.readOnly} onClick={() => setEdit(s)}>Editar</Btn>{s.active && <ConfirmButton label="Desativar" message={`Desativar ${s.name}? Serviço usado em OS nunca é apagado.`} onConfirm={() => act((db) => { db.services.find((x) => x.id === s.id)!.active = false; }, { ok: "Serviço desativado." })} disabled={ctx.readOnly} />}</span> },
  ];
  return (
    <>
      <PageHeader code="C15" title="Serviços" subtitle="Catálogo de serviços (tipo S). Valores padrão são sugestão: a OS pode alterar (J23)." actions={<><ExportBar name="servicos" rows={ctx.db.services} cols={cols} /><Btn onClick={() => setEdit({ ...blank })} disabled={ctx.readOnly || !ctx.can("estoque", "criar")}>Novo serviço</Btn></>} />
      <DataTable rows={ctx.db.services} cols={cols} />
      {edit && (
        <Modal title={edit.id ? "Editar serviço" : "Novo serviço"} onClose={() => setEdit(null)}>
          <div className="grid gap-3">
            <Field label="Código"><Input value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} /></Field>
            <Field label="Nome"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Tipo"><Select value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as Service["kind"] })}><option value="instalacao">Instalação</option><option value="manutencao">Manutenção</option><option value="retirada">Retirada</option><option value="troca">Troca</option><option value="administrativo">Administrativo (desativação)</option></Select></Field>
            <Field label="Valor cobrado padrão"><Input type="number" min={0} step="0.01" value={edit.defaultPrice} onChange={(e) => setEdit({ ...edit, defaultPrice: Number(e.target.value) })} /></Field>
            {ctx.seeCost && <Field label="Custo padrão (técnico e insumos típicos)"><Input type="number" min={0} step="0.01" value={edit.defaultCost} onChange={(e) => setEdit({ ...edit, defaultCost: Number(e.target.value) })} /></Field>}
          </div>
          <div className="mt-4 flex justify-end gap-2"><Btn variant="secondary" onClick={() => setEdit(null)}>Cancelar</Btn><Btn onClick={() => { const e = edit; const r = act((db) => {
            if (!e.code.trim() || !e.name.trim()) throw new Error("Informe código e nome.");
            if (db.services.some((s) => s.code === e.code && s.id !== e.id)) throw new Error("Código já existe.");
            if (e.id) Object.assign(db.services.find((s) => s.id === e.id)!, e); else db.services.push({ ...e, id: nextId(db, "srv") });
          }, { ok: "Serviço salvo." }); if (r.ok) setEdit(null); }}>Salvar</Btn></div>
        </Modal>
      )}
    </>
  );
}

export const screens: Record<string, ComponentType> = { C01, C02, C03, C04, C05, C06, C07, C08, C09, C10, C11, C12, C13, C14, C15 };
