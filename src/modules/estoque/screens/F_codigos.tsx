import { useRef, useState, useEffect, type ComponentType } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Barcode } from "../components/Barcode";
import { Btn, Card, ConfirmButton, DataTable, Empty, Field, Input, KV, LinkBtn, PageHeader, ReadOnlyBanner, Select, StatusBadge, Textarea, useAct, useToast } from "../components/ui";
import { findSerial, normalizeCode } from "../domain/core";
import { cancelMotherCode, generateMotherCodes, MAX_PER_VOLUME, parseSerialList, previewMotherCode, resolveScan, type ScanMode, type ScanResult } from "../domain/mothercode";
import { setPending } from "../leitura";
import { dt } from "../format";
import { p, to } from "../routes";
import { useCtx } from "../session";

// ---- F01 ----
function F01() {
  const ctx = useCtx();
  const rows = ctx.db.motherCodes.filter((m) => ctx.companyIds.includes(m.companyId));
  return (
    <>
      <PageHeader code="F01" title="Códigos-mãe" actions={<><LinkBtn to={p("/leitura")}>Ler código</LinkBtn>{!ctx.readOnly && ctx.can("estoque", "criar") && <LinkBtn variant="primary" to={p("/codigos-mae/novo")}>Novo código-mãe</LinkBtn>}</>} />
      {ctx.readOnly && <ReadOnlyBanner />}
      <DataTable rows={rows} cols={[
        { h: "Código", cell: (m) => <span className="font-mono">{m.token}</span> }, { h: "Caixa", cell: (m) => m.box },
        { h: "Produto", cell: (m) => ctx.db.products.find((x) => x.id === m.productId)?.name }, { h: "Quantidade", cell: (m) => m.serials.length, right: true }, { h: "Situação", cell: (m) => <StatusBadge s={m.status} /> },
      ]} onRow={(m) => p(to("/codigos-mae/:id", { id: m.id }))} empty={<Empty text="Nenhum código-mãe." action={<LinkBtn variant="primary" to={p("/codigos-mae/novo")}>Novo código-mãe</LinkBtn>} />} />
    </>
  );
}

// ---- F02 ----
function F02() {
  const ctx = useCtx();
  const nav = useNavigate();
  const loc = useLocation();
  const prev = (loc.state ?? {}) as { text?: string; box?: string; productId?: string };
  const [text, setText] = useState(prev.text ?? "");
  const [box, setBox] = useState(prev.box ?? "");
  const [productId, setProductId] = useState(prev.productId ?? "");
  const toast = useToast();
  const { unique, duplicates } = parseSerialList(text);
  const available = ctx.db.serials.filter((s) => ctx.companyIds.includes(s.ownerCompanyId) && s.locationId && (!productId || s.productId === productId)).slice(0, 60);
  const go = () => {
    if (!productId) return toast.err("Escolha o produto.");
    if (!box.trim()) return toast.err("Informe a caixa ou lote.");
    if (unique.length === 0) return toast.err("Informe as séries.");
    nav(p("/codigos-mae/revisao"), { state: { text, box, productId } });
  };
  return (
    <>
      <PageHeader code="F02" title="Gerar código-mãe" subtitle="Cole ou envie a lista de séries, ou escolha séries já cadastradas." />
      {ctx.readOnly && <ReadOnlyBanner />}
      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Produto"><Select value={productId} onChange={(e) => setProductId(e.target.value)}><option value="">Escolha…</option>{ctx.db.products.filter((x) => x.requiresSerial).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
          <Field label="Caixa ou lote"><Input value={box} onChange={(e) => setBox(e.target.value)} /></Field>
        </div>
        <Field label="Séries (uma por linha, ou separadas por espaço/vírgula)" className="mt-3"><Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} /></Field>
        <input type="file" accept=".txt,.csv" className="mt-2 text-sm" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText((await f.text())); }} />
        <p className="mt-2 text-sm">{unique.length} série(s) únicas{duplicates.length > 0 && <span className="text-amber-800"> · {duplicates.length} repetida(s) removida(s): {duplicates.slice(0, 5).join(", ")}</span>}. Normaliza espaços e maiúsculas.</p>
        {available.length > 0 && (
          <details className="mt-3"><summary className="cursor-pointer text-sm text-sky-800">Escolher entre séries cadastradas ({available.length})</summary>
            <div className="mt-2 flex flex-wrap gap-2">{available.map((s) => <button key={s.id} type="button" className={`rounded border px-2 py-1 font-mono text-xs ${unique.includes(s.serial) ? "border-sky-600 bg-sky-50" : "border-slate-300"}`} onClick={() => setText(unique.includes(s.serial) ? unique.filter((x) => x !== s.serial).join("\n") : [...unique, s.serial].join("\n"))}>{s.serial}</button>)}</div></details>
        )}
        <div className="mt-4 flex gap-2"><Btn onClick={go} disabled={ctx.readOnly}>Conferir lista</Btn><LinkBtn to={p("/codigos-mae")}>Cancelar</LinkBtn></div>
      </Card>
    </>
  );
}

// ---- F03 ----
function F03() {
  const ctx = useCtx();
  const act = useAct();
  const nav = useNavigate();
  const st = (useLocation().state ?? {}) as { text?: string; box?: string; productId?: string };
  const [size, setSize] = useState("60x40");
  if (!st.text || !ctx.company) return <Empty text="Nenhuma lista para revisar." action={<LinkBtn to={p("/codigos-mae/novo")}>Gerar código-mãe</LinkBtn>} />;
  const { unique } = parseSerialList(st.text);
  const pv = previewMotherCode(ctx.db, unique);
  const blocking = pv.invalid.length > 0;
  return (
    <>
      <PageHeader code="F03" title="Prévia do código-mãe" subtitle="Gerar o código não movimenta estoque." />
      <Card>
        <KV items={[["Séries", unique.length], ["Volumes", `${pv.volumes} (máx. ${MAX_PER_VOLUME} por volume)`], ["Modelo de código", "Token curto com manifesto guardado"], ["Tamanho do código", `${pv.tokenLength} caracteres`], ["Caixa", st.box]]} />
        <Field label="Tamanho da etiqueta" className="mt-3 max-w-xs"><Select value={size} onChange={(e) => setSize(e.target.value)}><option>60x40</option><option>100x50</option><option>100x150</option></Select></Field>
        {pv.invalid.length > 0 && <p className="mt-3 text-sm text-red-700" role="alert">Séries inexistentes (corrija antes de gerar): {pv.invalid.slice(0, 10).join(", ")}</p>}
        {pv.inOtherCode.length > 0 && <p className="mt-3 text-sm text-amber-800">Atenção: {pv.inOtherCode.length} série(s) já estão em outro código-mãe ativo: {pv.inOtherCode.slice(0, 5).join(", ")}.</p>}
        <div className="mt-4 flex gap-2">
          <Btn disabled={blocking || ctx.readOnly} onClick={() => act((db) => generateMotherCodes(db, { companyId: ctx.company!.id, productId: st.productId!, box: st.box!, serials: unique }), { ok: "Código-mãe gerado.", go: (r) => p(to("/codigos-mae/:id", { id: r[0].id })) })}>Gerar</Btn>
          <Btn variant="secondary" onClick={() => nav(p("/codigos-mae/novo"), { state: st })}>Corrigir</Btn>
        </div>
      </Card>
    </>
  );
}

// ---- F04 ----
function F04() {
  const ctx = useCtx();
  const { id } = useParams();
  const act = useAct();
  const toast = useToast();
  const m = ctx.db.motherCodes.find((x) => x.id === id && ctx.companyIds.includes(x.companyId));
  if (!m) return <Empty text="Código-mãe não encontrado." action={<LinkBtn to={p("/codigos-mae")}>Voltar</LinkBtn>} />;
  return (
    <>
      <PageHeader code="F04" title={`Código-mãe ${m.box}`} subtitle={<StatusBadge s={m.status} />} actions={<>
        <LinkBtn to={p(`/estoque/etiquetas?tipo=mae&id=${m.id}`)}>Imprimir etiqueta</LinkBtn>
        <Btn variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(m.token); toast.ok("Código copiado."); } catch { toast.err("Não foi possível copiar."); } }}>Copiar código digital</Btn>
        <LinkBtn to={p("/leitura")}>Ler agora</LinkBtn>
        {m.status === "ativo" && <ConfirmButton label="Cancelar código" message="Cancelar este código-mãe? Ele continua visível como cancelado." disabled={ctx.readOnly} onConfirm={() => act((db) => cancelMotherCode(db, m.id), { ok: "Código cancelado.", go: p("/codigos-mae") })} />}
      </>} />
      <Card><KV items={[["Código", <span key="t" className="font-mono">{m.token}</span>], ["Produto", ctx.db.products.find((x) => x.id === m.productId)?.name], ["Versão", m.version], ["Quantidade", m.serials.length], ["Criado em", dt(m.createdAt)]]} />
        <div className="mt-3"><Barcode value={m.token} /></div>
        <p className="mt-2 text-xs text-slate-500">Etiqueta sozinha não dá entrada nem saída.</p></Card>
      <Card title="Séries" className="mt-3"><div className="flex flex-wrap gap-2">{m.serials.map((s) => <a key={s} className="rounded border border-slate-300 px-2 py-1 font-mono text-xs hover:bg-slate-50" href={p(to("/estoque/equipamentos/:id", { id: findSerial(ctx.db, s)?.id ?? "" }))}>{s}</a>)}</div></Card>
    </>
  );
}

// ---- F05 ----
function F05() {
  const ctx = useCtx();
  const nav = useNavigate();
  const [mode, setMode] = useState<ScanMode>("consulta");
  const [val, setVal] = useState("");
  const [res, setRes] = useState<(ScanResult & { code: string }) | null>(null);
  const [returnTo, setReturnTo] = useState("");
  const [sp] = useSearchParams();
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const m = sp.get("modo") as ScanMode | null;
    if (m) setMode(m);
    setReturnTo(sp.get("voltar") ?? "");
  }, [sp]);
  useEffect(() => { ref.current?.focus(); });
  const read = () => {
    if (!ctx.company) return;
    const r = resolveScan(ctx.db, val, mode, ctx.company.id, res?.serials ?? []);
    setRes({ ...r, code: normalizeCode(val) });
    setVal("");
  };
  const confirm = () => {
    if (!res) return;
    if (mode === "consulta") {
      if (res.kind === "codigo_mae" && res.motherCode) return nav(p(to("/codigos-mae/:id", { id: res.motherCode.id })));
      const s = findSerial(ctx.db, res.serials[0]);
      return s ? nav(p(to("/estoque/equipamentos/:id", { id: s.id }))) : undefined;
    }
    setPending({ mode, serials: res.serials, returnTo });
    nav(returnTo || p("/estoque/saidas"));
  };
  const blocking = res?.issues.filter((i) => !i.serial) ?? [];
  const serialIssues = res?.issues.filter((i) => i.serial) ?? [];
  return (
    <>
      <PageHeader code="F05" title="Leitor universal" subtitle="Nunca confirma movimento só pela leitura. Confere versão, integridade, empresa e elegibilidade." />
      <Card>
        <div className="mb-3 flex flex-wrap gap-2">{(["consulta", "conferencia", "saida", "transferencia", "inventario"] as ScanMode[]).map((m) => <Btn key={m} variant={mode === m ? "primary" : "secondary"} onClick={() => setMode(m)}>{{ consulta: "Consulta", conferencia: "Conferência", saida: "Saída", transferencia: "Transferência", inventario: "Inventário" }[m]}</Btn>)}</div>
        <form onSubmit={(e) => { e.preventDefault(); read(); }} className="flex gap-2">
          <input ref={ref} className="flex-1 rounded-md border-2 border-sky-600 px-3 py-3 font-mono text-lg" value={val} onChange={(e) => setVal(e.target.value)} placeholder="Leia ou digite o código" aria-label="Campo de leitura" />
          <Btn type="submit">Ler</Btn>
        </form>
      </Card>
      {res && (
        <Card title={`Prévia: ${res.kind === "codigo_mae" ? `código-mãe ${res.motherCode?.box ?? ""}` : res.kind === "serie" ? "série" : "desconhecido"} (${res.code})`} className="mt-3">
          {blocking.map((b, i) => <p key={i} className="text-sm text-red-700" role="alert">✖ {b.message}</p>)}
          <p className="mb-2 text-sm">{res.serials.length} série(s){serialIssues.length > 0 && `, ${serialIssues.length} com divergência`}.</p>
          {serialIssues.length > 0 && <ul className="mb-2 max-h-40 list-disc overflow-auto pl-5 text-sm text-amber-800">{serialIssues.slice(0, 20).map((i, k) => <li key={k}>{i.serial}: {i.message}</li>)}</ul>}
          <div className="flex gap-2"><Btn onClick={confirm} disabled={res.kind === "desconhecido" || blocking.length > 0 || res.serials.length === 0}>{mode === "consulta" ? "Abrir" : "Confirmar na operação de origem"}</Btn><Btn variant="secondary" onClick={() => setRes(null)}>Limpar</Btn></div>
        </Card>
      )}
    </>
  );
}

// ---- F06 ----
function F06() {
  const ctx = useCtx();
  const [sp] = useSearchParams();
  const [type, setType] = useState(sp.get("tipo") ?? "serie");
  const [size, setSize] = useState("60x40");
  const [picked, setPicked] = useState<string[]>(sp.get("id") ? [sp.get("id")!] : []);
  const [reason, setReason] = useState("");
  const toggle = (k: string) => setPicked(picked.includes(k) ? picked.filter((x) => x !== k) : [...picked, k]);
  const options: { k: string; label: string; code: string; sub: string }[] =
    type === "serie" ? ctx.db.serials.filter((s) => ctx.companyIds.includes(s.ownerCompanyId) && s.locationId).slice(0, 80).map((s) => ({ k: s.id, label: s.serial, code: s.serial, sub: ctx.db.products.find((x) => x.id === s.productId)?.name ?? "" }))
    : type === "produto" ? ctx.db.products.map((x) => ({ k: x.id, label: x.code, code: x.code, sub: x.name }))
    : type === "local" ? ctx.db.locations.filter((l) => ctx.companyIds.includes(l.companyId)).map((l) => ({ k: l.id, label: l.name, code: `LOC-${l.id.toUpperCase().replace(/_/g, "-")}`, sub: l.type }))
    : ctx.db.motherCodes.filter((m) => ctx.companyIds.includes(m.companyId)).map((m) => ({ k: m.id, label: m.box, code: m.token, sub: `${m.serials.length} séries` }));
  const sel = options.filter((o) => picked.includes(o.k));
  const [w] = size.split("x");
  return (
    <>
      <PageHeader code="F06" title="Etiquetas" subtitle="Modelo da impressora ainda a confirmar (B04): usa a impressão do navegador. Código de barras Code 39; teste com o leitor real pendente."
        actions={<><Btn variant="secondary" onClick={() => window.print()} disabled={sel.length === 0}>Visualizar / Imprimir</Btn><Btn variant="secondary" onClick={() => window.print()} disabled={sel.length === 0}>Salvar PDF</Btn></>} />
      <div className="no-print">
        <Card>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Tipo"><Select value={type} onChange={(e) => { setType(e.target.value); setPicked([]); }}><option value="serie">Série</option><option value="produto">Produto</option><option value="local">Local</option><option value="mae">Caixa / código-mãe</option></Select></Field>
            <Field label="Tamanho"><Select value={size} onChange={(e) => setSize(e.target.value)}><option>60x40</option><option>100x50</option><option>100x150</option></Select></Field>
            <Field label="Etiqueta danificada? motivo (leitura item a item)"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          </div>
          <div className="mt-3 flex max-h-48 flex-wrap gap-2 overflow-auto">{options.map((o) => <button key={o.k} type="button" onClick={() => toggle(o.k)} className={`rounded border px-2 py-1 text-xs ${picked.includes(o.k) ? "border-sky-600 bg-sky-50" : "border-slate-300"}`}>{o.label}</button>)}</div>
        </Card>
      </div>
      <div className="mt-3 flex flex-wrap gap-3">
        {sel.map((o) => (
          <div key={o.k} className="rounded border border-slate-400 bg-white p-2 text-center" style={{ width: `${Number(w) * 3.2}px`, minHeight: 90 }}>
            <div className="text-[10px] text-slate-600">{ctx.company?.name ?? "Grupo"}</div>
            <div className="flex justify-center py-1"><Barcode value={o.code} height={34} /></div>
            <div className="font-mono text-xs font-semibold">{o.code}</div>
            <div className="text-[10px] text-slate-600">{o.sub}</div>
          </div>
        ))}
        {sel.length === 0 && <Empty text="Escolha os itens para visualizar as etiquetas." />}
      </div>
    </>
  );
}

export const screens: Record<string, ComponentType> = { F01, F02, F03, F04, F05, F06 };
