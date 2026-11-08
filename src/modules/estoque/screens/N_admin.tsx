import { useState, type ComponentType } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Badge, Btn, Card, ConfirmButton, DataTable, Empty, ExportBar, Field, Input, LinkBtn, PageHeader, Select, StatusBadge, Textarea, useAct, useToast,
} from "../components/ui";
import { audit, nextId, nowIso, postMovement, normalizeCode } from "../domain/core";
import { transmitInvoice, createInvoiceDraft } from "../domain/fiscal";
import { parseCsv } from "../domain/sheets";
import type { Action, Area, Db, Grant, HControlLoad, Profile } from "../domain/types";
import { dt } from "../format";
import { p, to } from "../routes";
import { useCtx } from "../session";

const AREAS: { id: Area; label: string }[] = [{ id: "estoque", label: "Estoque" }, { id: "financeiro", label: "Financeiro" }, { id: "operacoes", label: "Operações" }, { id: "fiscal", label: "Fiscal" }, { id: "auditoria", label: "Auditoria" }];
const ACTIONS: Action[] = ["ver", "criar", "editar", "aprovar", "confirmar", "exportar"];

// ---- N01 ----
function N01() {
  const ctx = useCtx();
  const rows = ctx.db.profiles;
  return (
    <>
      <PageHeader code="N01" title="Usuários" subtitle="Não existe excluir; usa-se desativar." actions={<LinkBtn variant="primary" to={p("/admin/usuarios/novo")}>Novo usuário</LinkBtn>} />
      <DataTable rows={rows} cols={[
        { h: "Nome", cell: (u) => u.name }, { h: "E-mail", cell: (u) => u.email }, { h: "Perfil", cell: (u) => (u.role === "admin" ? "Administrador" : "Operação") },
        { h: "Empresas", cell: (u) => u.companyIds.map((id) => ctx.db.companies.find((c) => c.id === id)?.name).join(", ") }, { h: "Áreas", cell: (u) => (u.role === "admin" ? "Todas" : u.areas.join(", ")) }, { h: "Situação", cell: (u) => <StatusBadge s={u.active ? "ativo" : "inativo"} /> },
      ]} onRow={(u) => p(to("/admin/usuarios/:id", { id: u.id }))} />
    </>
  );
}

// ---- N02 ----
function N02() {
  const ctx = useCtx();
  const { id } = useParams();
  const act = useAct();
  const toast = useToast();
  const nav = useNavigate();
  const cur = id ? ctx.db.profiles.find((u) => u.id === id) : undefined;
  const [f, setF] = useState<Profile>(cur ?? { id: "", name: "", email: "", role: "operacao", active: true, companyIds: [], areas: [], grants: [], canSeeCost: false });
  const toggleCompany = (cid: string) => setF({ ...f, companyIds: f.companyIds.includes(cid) ? f.companyIds.filter((x) => x !== cid) : [...f.companyIds, cid], grants: f.grants.filter((g) => g.companyId !== cid || !f.companyIds.includes(cid)) });
  const has = (cid: string, area: Area, a: Action) => f.grants.some((g) => g.companyId === cid && g.area === area && g.actions.includes(a));
  const setGrant = (cid: string, area: Area, a: Action, on: boolean) => {
    const others = f.grants.filter((g) => !(g.companyId === cid && g.area === area));
    const cur2: Grant = f.grants.find((g) => g.companyId === cid && g.area === area) ?? { companyId: cid, area, actions: [] };
    const actions = on ? [...new Set([...cur2.actions, a])] : cur2.actions.filter((x) => x !== a);
    const grants = actions.length ? [...others, { ...cur2, actions }] : others;
    setF({ ...f, grants, areas: [...new Set(grants.map((g) => g.area))] });
  };
  const applyTemplate = (area: Area) => {
    const acts = ctx.db.areaTemplates[area];
    let grants = f.grants.filter((g) => g.area !== area);
    for (const cid of f.companyIds) grants = [...grants, { companyId: cid, area, actions: acts }];
    setF({ ...f, grants, areas: [...new Set(grants.map((g) => g.area))] });
  };
  const save = () => act((db) => {
    if (!f.name.trim() || !f.email.includes("@")) throw new Error("Informe nome e e-mail válidos.");
    if (db.profiles.some((u) => u.email.toLowerCase() === f.email.toLowerCase() && u.id !== f.id)) throw new Error("E-mail já cadastrado.");
    if (f.companyIds.length === 0) throw new Error("Escolha ao menos uma empresa.");
    if (cur) {
      const wasAdmin = cur.role === "admin" && cur.active;
      if (wasAdmin && (f.role !== "admin" || !f.active) && db.profiles.filter((u) => u.role === "admin" && u.active).length <= 1) throw new Error("Não é possível remover o último administrador.");
      Object.assign(db.profiles.find((u) => u.id === cur.id)!, f);
      audit(db, ctx.user.id, "usuario.editado", cur.id);
    } else {
      db.profiles.push({ ...f, id: nextId(db, "u") });
      audit(db, ctx.user.id, "usuario.convidado", f.email);
    }
  }, { ok: cur ? "Usuário salvo." : "Usuário criado e convite enviado (simulado).", go: p("/admin/usuarios") });
  return (
    <>
      <PageHeader code="N02" title={cur ? cur.name : "Novo usuário"} subtitle="A ação roda no servidor, nunca no navegador (no Supabase, via Edge Function com a chave de serviço). O histórico do usuário é preservado." />
      <Card>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Nome"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="E-mail (único)"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Perfil"><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Profile["role"] })}><option value="operacao">Operação</option><option value="admin">Administrador (todos os gestores)</option></Select></Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
          <span className="font-medium">Empresas:</span>{ctx.db.companies.map((c) => <label key={c.id} className="flex items-center gap-1"><input type="checkbox" checked={f.companyIds.includes(c.id)} onChange={() => toggleCompany(c.id)} />{c.name}</label>)}
          <label className="flex items-center gap-1"><input type="checkbox" checked={f.canSeeCost} disabled={f.role === "admin"} onChange={(e) => setF({ ...f, canSeeCost: e.target.checked })} /> Pode ver custos</label>
          <label className="flex items-center gap-1"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Ativo</label>
        </div>
        {f.role === "admin" ? <p className="mt-3 rounded bg-sky-50 p-2 text-sm text-sky-900">Administrador tem todas as telas e é o único que vê e edita custos e aprova perdas, baixas e divergências. Verificação em duas etapas obrigatória.</p> : (
          <div className="mt-3 space-y-3">
            {f.companyIds.map((cid) => (
              <div key={cid} className="rounded-lg border border-slate-200 p-3">
                <h3 className="mb-2 text-sm font-semibold">{ctx.db.companies.find((c) => c.id === cid)?.name}</h3>
                <table className="w-full text-xs"><thead><tr className="text-left text-slate-500"><th className="py-1">Área (partir do modelo)</th>{ACTIONS.map((a) => <th key={a}>{a}</th>)}</tr></thead>
                  <tbody>{AREAS.map((ar) => (
                    <tr key={ar.id} className="border-t border-slate-100"><td className="py-1">{ar.label} <button className="ml-1 text-sky-800 underline" onClick={() => applyTemplate(ar.id)}>usar modelo</button></td>
                      {ACTIONS.map((a) => <td key={a}><input type="checkbox" aria-label={`${ar.label} ${a}`} checked={has(cid, ar.id, a)} disabled={a === "aprovar"} title={a === "aprovar" ? "Só administradores aprovam" : ""} onChange={(e) => setGrant(cid, ar.id, a, e.target.checked)} /></td>)}
                    </tr>))}</tbody></table>
              </div>
            ))}
            {f.companyIds.length === 0 && <p className="text-sm text-slate-500">Escolha as empresas para definir as permissões.</p>}
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Btn onClick={save}>Salvar e enviar convite</Btn>
          {cur && <><Btn variant="secondary" onClick={() => toast.ok("Convite reenviado (simulado: nenhum e-mail enviado).")}>Reenviar convite</Btn><Btn variant="secondary" onClick={() => toast.ok("E-mail de redefinição enviado (simulado).")}>Redefinir senha</Btn>
            <ConfirmButton label="Desativar" message="Desativar este usuário? O histórico dele é preservado." onConfirm={() => act((db) => { const u = db.profiles.find((x) => x.id === cur.id)!; if (u.role === "admin" && db.profiles.filter((x) => x.role === "admin" && x.active).length <= 1) throw new Error("Não é possível desativar o último administrador."); u.active = false; audit(db, ctx.user.id, "usuario.desativado", u.id); }, { ok: "Usuário desativado.", go: p("/admin/usuarios") })} /></>}
          <Btn variant="ghost" onClick={() => nav(p("/admin/usuarios"))}>Cancelar</Btn>
        </div>
      </Card>
    </>
  );
}

// ---- N03 ----
function N03() {
  const ctx = useCtx();
  return (
    <>
      <PageHeader code="N03" title="Áreas e permissões" subtitle="As áreas servem de modelo; as permissões finais são por usuário (N02)." />
      <DataTable rows={AREAS} cols={[{ h: "Área", cell: (a) => a.label }, { h: "Ações do modelo", cell: (a) => ctx.db.areaTemplates[a.id].join(", ") }, { h: "Usuários com a área", cell: (a) => ctx.db.profiles.filter((u) => u.areas.includes(a.id)).length, right: true }]} onRow={(a) => p(to("/admin/areas/:id", { id: a.id }))} />
    </>
  );
}

// ---- N04 ----
function N04() {
  const ctx = useCtx();
  const { id } = useParams();
  const act = useAct();
  const area = AREAS.find((a) => a.id === id);
  const [acts, setActs] = useState<Action[]>(ctx.db.areaTemplates[id as Area] ?? []);
  if (!area) return <Empty text="Área não encontrada." action={<LinkBtn to={p("/admin/areas")}>Voltar</LinkBtn>} />;
  return (
    <>
      <PageHeader code="N04" title={`Editar área: ${area.label}`} subtitle="Vale como modelo para novos usuários; mudança fica na auditoria. Telas por área seguem a Especificação (seção 3)." />
      <Card>
        <div className="flex flex-wrap gap-4 text-sm">{ACTIONS.map((a) => <label key={a} className="flex items-center gap-1"><input type="checkbox" checked={acts.includes(a)} disabled={a === "aprovar"} onChange={(e) => setActs(e.target.checked ? [...acts, a] : acts.filter((x) => x !== a))} />{a}</label>)}</div>
        <p className="mt-2 text-xs text-slate-500">“Aprovar” é exclusivo de administradores.</p>
        <div className="mt-4 flex gap-2"><Btn onClick={() => act((db) => { db.areaTemplates[area.id] = acts; audit(db, ctx.user.id, "area.modelo", area.id, undefined, acts.join(",")); }, { ok: "Salvo.", go: p("/admin/areas") })}>Salvar</Btn><LinkBtn to={p("/admin/areas")}>Cancelar</LinkBtn></div>
      </Card>
    </>
  );
}

// ---- N05 / N06 ----
function N05() {
  const ctx = useCtx();
  return (
    <>
      <PageHeader code="N05" title="Empresas" />
      <DataTable rows={ctx.db.companies} cols={[{ h: "Empresa", cell: (c) => c.name }, { h: "CNPJ", cell: (c) => c.cnpj }, { h: "Regime", cell: (c) => c.regime }, { h: "Provedor de NF-e", cell: (c) => c.nfeProvider }, { h: "Ambiente", cell: (c) => c.nfeEnv }, { h: "Configuração fiscal", cell: (c) => (c.certificateOk && c.nfeProvider === "real" ? <StatusBadge s="ok" /> : <Badge tone="amber">simulada / incompleta</Badge>) }]} onRow={(c) => p(to("/admin/empresas/:id", { id: c.id }))} />
    </>
  );
}
function N06() {
  const ctx = useCtx();
  const { id } = useParams();
  const act = useAct();
  const toast = useToast();
  const nav = useNavigate();
  const cur = ctx.db.companies.find((c) => c.id === id);
  const [f, setF] = useState(cur ?? ctx.db.companies[0]);
  const [res, setRes] = useState("");
  if (!cur) return <Empty text="Empresa não encontrada." />;
  const test = () => {
    const r = act((db) => {
      const inv = createInvoiceDraft(db, { companyId: cur.id, operation: "venda", idempotencyKey: `homolog:${cur.id}:${Date.now()}`, items: [{ productId: "", qty: 1, unitValue: 1, cfop: "" }] }, ctx.user.id);
      transmitInvoice(db, inv.id, ctx.user.id);
      db.invoices = db.invoices.filter((i) => i.id !== inv.id); // nota de teste não fica na lista
      return inv.status;
    });
    setRes(r.ok ? "Teste de emissão em homologação (provedor SIMULADO): autorizada, sem valor fiscal." : `Falha: ${r.error}`);
  };
  return (
    <>
      <PageHeader code="N06" title={`Empresa: ${cur.name}`} subtitle="Certificado guardado com segurança (referência no servidor). Produção só depois de teste aprovado. Até a ligação real com o provedor, a emissão é simulada e marcada “SIMULADA, sem valor fiscal”." />
      <Card>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="CNPJ"><Input value={f.cnpj} onChange={(e) => setF({ ...f, cnpj: e.target.value })} /></Field>
          <Field label="IE"><Input value={f.ie} onChange={(e) => setF({ ...f, ie: e.target.value })} /></Field>
          <Field label="Regime"><Select value={f.regime} onChange={(e) => setF({ ...f, regime: e.target.value as typeof f.regime })}><option value="presumido">Lucro presumido</option><option value="real">Lucro real</option></Select></Field>
          <Field label="Série das notas"><Input value={f.invoiceSeries} onChange={(e) => setF({ ...f, invoiceSeries: e.target.value })} /></Field>
          <Field label="Provedor de NF-e"><Select value={f.nfeProvider} onChange={(e) => setF({ ...f, nfeProvider: e.target.value as typeof f.nfeProvider })}><option value="simulado">Simulado</option><option value="real" disabled>Real (ainda não ligado)</option></Select></Field>
          <Field label="Ambiente"><Select value={f.nfeEnv} onChange={(e) => setF({ ...f, nfeEnv: e.target.value as typeof f.nfeEnv })}><option value="homologacao">Homologação</option><option value="producao" disabled={!f.certificateOk}>Produção (exige teste aprovado)</option></Select></Field>
          <Field label="Certificado digital (arquivo)"><input type="file" accept=".pfx,.p12" className="text-sm" onChange={(e) => toast.ok(e.target.files?.[0] ? `Certificado selecionado (${e.target.files[0].name}); o envio seguro usa uma Edge Function e não está ligado.` : "")} /></Field>
        </div>
        {res && <p className="mt-3 rounded bg-slate-100 p-2 text-sm" role="status">{res}</p>}
        <div className="mt-4 flex gap-2"><Btn variant="secondary" onClick={test}>Testar emissão em homologação</Btn><Btn onClick={() => act((db) => { Object.assign(db.companies.find((c) => c.id === cur.id)!, f); audit(db, ctx.user.id, "empresa.editada", cur.id, cur.id); }, { ok: "Empresa salva.", go: p("/admin/empresas") })}>Salvar</Btn><Btn variant="ghost" onClick={() => nav(p("/admin/empresas"))}>Cancelar</Btn></div>
      </Card>
    </>
  );
}

// ---- N07 / N08 (H-Control) ----
interface Staged { products: string[][]; customers: string[][]; serials: string[][]; balances: string[][]; notes: string[][]; expected: Record<string, number> }
const staged = new Map<string, Staged>();
const FILES: { key: keyof Omit<Staged, "expected">; label: string; header: string }[] = [
  { key: "products", label: "Produtos", header: "codigo;nome;tipo(P/C);classe;exige_serie(S/N);ncm;garantia_meses" },
  { key: "customers", label: "Clientes", header: "nome;documento;ie;contribuinte(S/N);cidade;uf" },
  { key: "serials", label: "Séries (saldos com série)", header: "serie;produto_codigo;local;preco" },
  { key: "balances", label: "Saldos (sem série)", header: "produto_codigo;local;qtd" },
  { key: "notes", label: "Notas (só conferência de totais)", header: "numero;chave;data;total" },
];
const body = (text: string) => parseCsv(text).filter((r, i) => !(i === 0 && /^(codigo|nome|serie|produto_codigo|numero)/i.test(r[0])));

function validate(db: Db, companyId: string, s: Staged) {
  const errors: HControlLoad["errors"] = [];
  const codes = new Set(db.products.map((x) => x.code));
  const newCodes = new Set<string>();
  s.products.forEach((r, i) => {
    if (!r[0] || !r[1]) errors.push({ file: "produtos", line: i + 1, message: "código ou nome vazio" });
    else if (codes.has(r[0]) || newCodes.has(r[0])) errors.push({ file: "produtos", line: i + 1, message: `código ${r[0]} duplicado` });
    else newCodes.add(r[0]);
    if (!["P", "C"].includes(r[2])) errors.push({ file: "produtos", line: i + 1, message: "tipo deve ser P ou C" });
    if (!/^\d{8}$/.test(r[5] ?? "")) errors.push({ file: "produtos", line: i + 1, message: "NCM deve ter 8 dígitos" });
  });
  const docs = new Set(db.customers.map((c) => c.document.replace(/\D/g, "")));
  s.customers.forEach((r, i) => {
    const d = (r[1] ?? "").replace(/\D/g, "");
    if (!r[0]) errors.push({ file: "clientes", line: i + 1, message: "nome vazio" });
    if (d.length !== 11 && d.length !== 14) errors.push({ file: "clientes", line: i + 1, message: "CNPJ/CPF inválido" });
    else if (docs.has(d)) errors.push({ file: "clientes", line: i + 1, message: "documento já cadastrado" });
    else docs.add(d);
  });
  const locs = db.locations.filter((l) => l.companyId === companyId);
  const seenSerial = new Set<string>();
  s.serials.forEach((r, i) => {
    const sn = normalizeCode(r[0] ?? "");
    if (!sn) errors.push({ file: "series", line: i + 1, message: "série vazia" });
    else if (db.serials.some((x) => x.serial === sn) || seenSerial.has(sn)) errors.push({ file: "series", line: i + 1, message: `série ${sn} duplicada` });
    seenSerial.add(sn);
    if (!codes.has(r[1]) && !newCodes.has(r[1])) errors.push({ file: "series", line: i + 1, message: `produto ${r[1]} não existe` });
    if (!locs.some((l) => l.name === r[2])) errors.push({ file: "series", line: i + 1, message: `local "${r[2]}" não existe` });
    if (r[3] && Number.isNaN(Number(r[3].replace(",", ".")))) errors.push({ file: "series", line: i + 1, message: "preço inválido" });
  });
  s.balances.forEach((r, i) => {
    if (!codes.has(r[0]) && !newCodes.has(r[0])) errors.push({ file: "saldos", line: i + 1, message: `produto ${r[0]} não existe` });
    if (!locs.some((l) => l.name === r[1])) errors.push({ file: "saldos", line: i + 1, message: `local "${r[1]}" não existe` });
    if (!(Number(r[2]) > 0)) errors.push({ file: "saldos", line: i + 1, message: "quantidade inválida" });
  });
  return errors;
}

function N07() {
  const ctx = useCtx();
  const act = useAct();
  const nav = useNavigate();
  const [texts, setTexts] = useState<Record<string, string>>({});
  const upload = () => {
    if (!ctx.company) return;
    const s: Staged = { products: body(texts.products ?? ""), customers: body(texts.customers ?? ""), serials: body(texts.serials ?? ""), balances: body(texts.balances ?? ""), notes: body(texts.notes ?? ""), expected: {} };
    act((db) => {
      const id = nextId(db, "hc");
      staged.set(id, s);
      db.hcontrol.push({ id, at: nowIso(), by: ctx.user.id, companyId: ctx.company!.id, status: "previa", counts: { produtos: s.products.length, clientes: s.customers.length, series: s.serials.length, saldos: s.balances.length, notas: s.notes.length }, errors: validate(db, ctx.company!.id, s) });
      return id;
    }, { ok: "Arquivos lidos. Nada foi gravado ainda.", go: (id) => p(to("/admin/importacao/:id", { id })) });
  };
  return (
    <>
      <PageHeader code="N07" title="Importar dados do H-Control" subtitle="Carga única na virada, com o H-Control já encerrado. Nada é gravado antes de confirmar em N08. O saldo inicial vira movimento de abertura." />
      <Card>
        <p className="mb-2 text-sm">Empresa da carga: <strong>{ctx.company?.name ?? "escolha uma empresa no topo"}</strong></p>
        <div className="grid gap-3 sm:grid-cols-2">
          {FILES.map((f) => (
            <Field key={f.key} label={f.label} hint={`Colunas: ${f.header}`}>
              <div><Textarea rows={3} className="font-mono text-xs" value={texts[f.key] ?? ""} onChange={(e) => setTexts({ ...texts, [f.key]: e.target.value })} />
                <input type="file" accept=".csv,.txt" className="mt-1 text-xs" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setTexts({ ...texts, [f.key]: await file.text() }); }} /></div>
            </Field>
          ))}
        </div>
        <div className="mt-4 flex gap-2"><Btn disabled={ctx.readOnly || !ctx.company || Object.values(texts).every((t) => !t.trim())} onClick={upload}>Enviar arquivos</Btn><Btn variant="ghost" onClick={() => nav(p("/admin/auditoria"))}>Auditoria</Btn></div>
      </Card>
      <Card title="Histórico de cargas" className="mt-3"><DataTable rows={ctx.db.hcontrol.slice().reverse()} cols={[{ h: "Quando", cell: (h) => dt(h.at) }, { h: "Empresa", cell: (h) => ctx.db.companies.find((c) => c.id === h.companyId)?.name }, { h: "Registros", cell: (h) => Object.entries(h.counts).map(([k, v]) => `${k}: ${v}`).join(" · ") }, { h: "Erros", cell: (h) => h.errors.length, right: true }, { h: "Situação", cell: (h) => <StatusBadge s={h.status === "concluida" ? "concluída" : h.status} /> }]} onRow={(h) => p(to("/admin/importacao/:id", { id: h.id }))} empty={<p className="text-sm text-slate-500">Nenhuma carga ainda.</p>} /></Card>
    </>
  );
}

function N08() {
  const ctx = useCtx();
  const { id } = useParams();
  const act = useAct();
  const [exp, setExp] = useState<Record<string, string>>({});
  const h = ctx.db.hcontrol.find((x) => x.id === id);
  const s = id ? staged.get(id) : undefined;
  if (!h) return <Empty text="Carga não encontrada." action={<LinkBtn to={p("/admin/importacao")}>Voltar</LinkBtn>} />;
  const diffs = Object.entries(exp).filter(([, v]) => v !== "").map(([k, v]) => ({ k, esperado: Number(v), lido: h.counts[k] ?? 0 })).filter((d) => d.esperado !== d.lido);
  const canConfirm = h.status === "previa" && !!s && h.errors.length === 0 && diffs.length === 0;
  const confirm = () => act((db) => {
    const st = staged.get(h.id)!;
    const cid = h.companyId;
    for (const r of st.products) db.products.push({ id: nextId(db, "prod"), code: r[0], name: r[1], unit: "UN", recordType: r[2] as "P" | "C", klass: (r[3] as "equipamento" | "material" | "kit") || "equipamento", requiresSerial: (r[4] ?? "").toUpperCase() === "S", requiresIccid: false, warrantyMonths: Number(r[6]) || 0, ncm: r[5], active: true, version: 1, kitComponents: [] });
    for (const r of st.customers) db.customers.push({ id: nextId(db, "cli"), name: r[0], document: r[1], stateReg: r[2] ?? "", taxpayer: (r[3] ?? "").toUpperCase() === "S", city: r[4] ?? "", uf: (r[5] ?? "").toUpperCase(), companyIds: [cid], origin: "manual", active: true });
    for (const r of st.serials) {
      const prod = db.products.find((x) => x.code === r[1])!;
      const loc = db.locations.find((l) => l.companyId === cid && l.name === r[2])!;
      const price = r[3] ? Number(r[3].replace(",", ".")) : null;
      const sid = nextId(db, "ser");
      db.serials.push({ id: sid, serial: normalizeCode(r[0]), productId: prod.id, ownerCompanyId: cid, locationId: loc.id, custody: loc.name, commercial: "disponivel", technical: "bom", cost: price, purchasePrice: price, allocatedCost: 0, assignedCost: 0, costStatus: "definitivo", createdAt: nowIso() });
      postMovement(db, { companyId: cid, productId: prod.id, serialId: sid, qty: 1, kind: "abertura", fromLocationId: null, toLocationId: loc.id, refType: "hcontrol", refId: h.id, idempotencyKey: `abertura:${h.id}:${r[0]}`, by: ctx.user.id });
    }
    st.balances.forEach((r, i) => {
      const prod = db.products.find((x) => x.code === r[0])!;
      const loc = db.locations.find((l) => l.companyId === cid && l.name === r[1])!;
      postMovement(db, { companyId: cid, productId: prod.id, qty: Number(r[2]), kind: "abertura", fromLocationId: null, toLocationId: loc.id, refType: "hcontrol", refId: h.id, idempotencyKey: `abertura-saldo:${h.id}:${i}`, by: ctx.user.id });
    });
    const rec = db.hcontrol.find((x) => x.id === h.id)!;
    rec.status = "concluida";
    audit(db, ctx.user.id, "hcontrol.carga", h.id, cid, JSON.stringify(h.counts));
  }, { ok: "Carga concluída.", go: p("/admin/importacao") });
  return (
    <>
      <PageHeader code="N08" title="Conferir importação" subtitle={<StatusBadge s={h.status === "concluida" ? "concluída" : h.status} />} />
      <Card title="Contagens lidas × totais do H-Control">
        <DataTable rows={Object.entries(h.counts)} cols={[{ h: "Arquivo", cell: ([k]) => k }, { h: "Lido", cell: ([, v]) => v, right: true }, { h: "Total no H-Control", cell: ([k]) => <Input type="number" min={0} className="w-28 text-right" value={exp[k] ?? ""} onChange={(e) => setExp({ ...exp, [k]: e.target.value })} disabled={h.status !== "previa"} />, right: true }]} />
        {diffs.length > 0 && <p className="mt-2 text-sm text-red-700" role="alert">Divergência com o H-Control: {diffs.map((d) => `${d.k} (esperado ${d.esperado}, lido ${d.lido})`).join("; ")}.</p>}
      </Card>
      <Card title={`Erros por linha (${h.errors.length})`} className="mt-3"><DataTable rows={h.errors} cols={[{ h: "Arquivo", cell: (e) => e.file }, { h: "Linha", cell: (e) => e.line, right: true }, { h: "Erro", cell: (e) => e.message }]} empty={<p className="text-sm text-emerald-700">Nenhum erro.</p>} /></Card>
      {h.status === "previa" && !s && <p className="mt-3 text-sm text-amber-800">Os dados desta prévia saíram da memória (página recarregada). Descarte e envie os arquivos de novo.</p>}
      <div className="mt-4 flex gap-2">
        <ConfirmButton variant="primary" label="Confirmar carga" message="Confirmar grava produtos, clientes, séries e saldos de abertura. Só faça com o H-Control encerrado." disabled={!canConfirm || ctx.readOnly} onConfirm={confirm} />
        <ConfirmButton label="Descartar" variant="secondary" message="Descartar esta prévia? Nada foi gravado." disabled={h.status !== "previa"} onConfirm={() => act((db) => { db.hcontrol.find((x) => x.id === h.id)!.status = "descartada"; staged.delete(h.id); }, { ok: "Prévia descartada.", go: p("/admin/importacao") })} />
        <LinkBtn to={p("/admin/importacao")}>Voltar</LinkBtn>
      </div>
    </>
  );
}

// ---- N09 / N10 ----
function N09() {
  const ctx = useCtx();
  const [user, setUser] = useState("");
  const [q, setQ] = useState("");
  const rows = ctx.db.audit.filter((a) => (!a.companyId || ctx.companyIds.includes(a.companyId)) && (!user || a.by === user) && `${a.action} ${a.ref} ${a.detail ?? ""}`.toLowerCase().includes(q.toLowerCase())).slice().reverse();
  const origin = (ref: string): string | null => {
    const m: [string, string][] = [["ent_", "/estoque/entradas/:id"], ["nf_", "/fiscal/notas/:id"], ["os_", "/os/:id"], ["ctr_", "/comercial/contratos/:id"], ["ped_", "/compras/pedidos/:id"], ["imp_", "/importacoes/:id"], ["sai_", "/estoque/saidas/:id"], ["tra_", "/estoque/transferencias/:id"]];
    const hit = m.find(([pre]) => ref.startsWith(pre));
    return hit ? p(to(hit[1], { id: ref })) : null;
  };
  return (
    <>
      <PageHeader code="N09" title="Auditoria" subtitle="Quem fez o quê, quando e em qual empresa. Somente leitura." actions={<ExportBar name="auditoria" rows={rows} cols={[{ h: "Quando", cell: (a) => dt(a.at), export: (a) => dt(a.at) }, { h: "Quem", cell: () => "", export: (a) => ctx.db.profiles.find((x) => x.id === a.by)?.name ?? a.by }, { h: "Ação", cell: () => "", export: (a) => a.action }, { h: "Referência", cell: () => "", export: (a) => a.ref }]} />} />
      <div className="mb-3 flex gap-2"><Select className="max-w-56" value={user} onChange={(e) => setUser(e.target.value)}><option value="">Todos os usuários</option>{ctx.db.profiles.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</Select><Input className="max-w-xs" placeholder="Filtrar por ação ou referência" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <DataTable rows={rows.slice(0, 300)} cols={[{ h: "Quando", cell: (a) => dt(a.at) }, { h: "Quem", cell: (a) => ctx.db.profiles.find((x) => x.id === a.by)?.name ?? a.by }, { h: "Empresa", cell: (a) => ctx.db.companies.find((c) => c.id === a.companyId)?.name ?? "—" }, { h: "Ação", cell: (a) => a.action }, { h: "Referência", cell: (a) => { const o = origin(a.ref); return o ? <a className="text-sky-800 hover:underline" href={o}>{a.ref}</a> : a.ref; } }, { h: "Detalhe", cell: (a) => a.detail }]} empty={<Empty text="Nenhum evento registrado." />} />
    </>
  );
}
function N10() {
  const ctx = useCtx();
  return (
    <>
      <PageHeader code="N10" title="Exportações" subtitle="Registro de relatórios e arquivos baixados. Somente consulta." />
      <DataTable rows={ctx.db.exports.slice().reverse()} cols={[{ h: "Quando", cell: (e) => dt(e.at) }, { h: "Quem", cell: (e) => ctx.db.profiles.find((x) => x.id === e.by)?.name ?? e.by }, { h: "Empresa", cell: (e) => ctx.db.companies.find((c) => c.id === e.companyId)?.name ?? "Grupo" }, { h: "Relatório", cell: (e) => e.screen }, { h: "Formato", cell: (e) => e.format }, { h: "Linhas", cell: (e) => e.rows, right: true }]} empty={<Empty text="Nenhuma exportação feita ainda." />} />
    </>
  );
}

// ---- N11 ----
function N11() {
  const ctx = useCtx();
  const act = useAct();
  const [f, setF] = useState({ ...ctx.db.params });
  return (
    <>
      <PageHeader code="N11" title="Parâmetros" subtitle="Mudanças são versionadas na auditoria. Regras fiscais só pelo editor de tributação (C13)." />
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Transferência dentro da mesma empresa exige nota?"><Select value={f.transferSameCompanyNeedsInvoice ? "s" : "n"} onChange={(e) => setF({ ...f, transferSameCompanyNeedsInvoice: e.target.value === "s" })}><option value="s">Sim (padrão assumido)</option><option value="n">Não</option></Select></Field>
          <Field label="Custo de kit inclui montagem?"><Select value={f.kitCostIncludesAssembly ? "s" : "n"} onChange={(e) => setF({ ...f, kitCostIncludesAssembly: e.target.value === "s" })}><option value="n">Não (padrão assumido: soma só os componentes)</option><option value="s">Sim</option></Select></Field>
          <Field label="Prazo de trânsito (dias) antes do aviso"><Input type="number" min={1} value={f.transitDays} onChange={(e) => setF({ ...f, transitDays: Number(e.target.value) })} /></Field>
        </div>
        <p className="mt-2 text-xs text-slate-500">Numeração das notas e textos de e-mail: a numeração vem do provedor de NF-e (simulado hoje, sequência por empresa); os textos de e-mail entram quando o envio real existir.</p>
        <div className="mt-4"><Btn onClick={() => act((db) => { db.params = { ...f }; audit(db, ctx.user.id, "parametros.salvos", "params", undefined, JSON.stringify(f)); }, { ok: "Salvo" })}>Salvar</Btn></div>
      </Card>
    </>
  );
}

export const screens: Record<string, ComponentType> = { N01, N02, N03, N04, N05, N06, N07, N08, N09, N10, N11 };
