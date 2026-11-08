import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Badge, Btn, Card, ConfirmButton, DataTable, Empty, ExportBar, Field, Input, KV, LinkBtn, Modal, NoPermission, PageHeader, ReadOnlyBanner,
  ReasonButton, Select, StatusBadge, Textarea, useAct, useToast, type Col,
} from "../components/ui";
import { findSerial } from "../domain/core";
import {
  adjustClosedCost, applyPriceSheet, closeConference, conferenceSummary, createInbound, decideDivergence, previewPriceSheet, requestDivergence,
  reverseInbound, scanSerial, setLotPrice, setSerialPrice, startConference, undoScan, validateNfeKey,
} from "../domain/inbound";
import { resolveScan } from "../domain/mothercode";
import { parseCsv } from "../domain/sheets";
import type { Db, Inbound } from "../domain/types";
import { brl, dt, download } from "../format";
import { p, to } from "../routes";
import { useCtx } from "../session";

const supName = (db: Db, id: string) => db.suppliers.find((s) => s.id === id)?.name ?? "—";
const prodName = (db: Db, id: string) => db.products.find((x) => x.id === id)?.name ?? "—";

function useInbound() {
  const ctx = useCtx();
  const { id } = useParams();
  const inb = ctx.db.inbounds.find((i) => i.id === id && ctx.companyIds.includes(i.companyId));
  return { ctx, inb };
}
const NotFound = () => <Empty text="Entrada não encontrada nesta empresa." action={<LinkBtn to={p("/estoque/entradas")}>Voltar</LinkBtn>} />;

// ---- E01 ----
function E01() {
  const ctx = useCtx();
  const [st, setSt] = useState("");
  const rows = ctx.db.inbounds.filter((i) => ctx.companyIds.includes(i.companyId) && (!st || i.status === st));
  const cols: Col<Inbound>[] = [
    { h: "Entrada", cell: (i) => i.number, export: (i) => i.number },
    { h: "Fornecedor", cell: (i) => supName(ctx.db, i.supplierId), export: (i) => supName(ctx.db, i.supplierId) },
    { h: "Chave", cell: (i) => <span className="font-mono text-xs">{i.nfeKey.slice(0, 10)}…</span>, export: (i) => i.nfeKey },
    { h: "Situação fiscal", cell: (i) => <StatusBadge s={i.fiscalStatus} />, export: (i) => i.fiscalStatus },
    { h: "Conferência", cell: (i) => <StatusBadge s={i.status} />, export: (i) => i.status },
    { h: "Lidas / esperadas", cell: (i) => `${i.scans.length} / ${i.items.reduce((a, x) => a + x.qty, 0)}`, right: true, export: (i) => `${i.scans.length}/${i.items.reduce((a, x) => a + x.qty, 0)}` },
  ];
  return (
    <>
      <PageHeader code="E01" title="Entradas" subtitle="O saldo só entra depois de fechar a conferência." actions={<><ExportBar name="entradas" rows={rows} cols={cols} />{!ctx.readOnly && ctx.can("estoque", "criar") && <LinkBtn variant="primary" to={p("/estoque/entradas/nova")}>Nova entrada</LinkBtn>}</>} />
      {ctx.readOnly && <ReadOnlyBanner />}
      <div className="mb-3"><Select className="max-w-52" value={st} onChange={(e) => setSt(e.target.value)}><option value="">Todas</option>{["rascunho", "em_conferencia", "divergente", "fechada", "estornada"].map((s) => <option key={s}>{s}</option>)}</Select></div>
      <DataTable rows={rows} cols={cols} onRow={(i) => p(to(i.status === "em_conferencia" || i.status === "divergente" ? "/estoque/entradas/:id/conferencia" : "/estoque/entradas/:id", { id: i.id }))} empty={<Empty text="Nenhuma entrada." action={<LinkBtn variant="primary" to={p("/estoque/entradas/nova")}>Nova entrada</LinkBtn>} />} />
    </>
  );
}

// ---- E02 ----
interface DraftItem { code: string; name: string; productId: string; qty: number; unitPrice: string; weight: number }
function parseNfeXml(xml: string): { key: string; destCnpj: string; items: DraftItem[] } | null {
  try {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.querySelector("parsererror")) return null;
    const inf = doc.getElementsByTagName("infNFe")[0];
    const key = (inf?.getAttribute("Id") ?? doc.getElementsByTagName("chNFe")[0]?.textContent ?? "").replace(/\D/g, "");
    const destCnpj = (doc.getElementsByTagName("dest")[0]?.getElementsByTagName("CNPJ")[0]?.textContent ?? "").replace(/\D/g, "");
    const items = Array.from(doc.getElementsByTagName("det")).map((d) => ({
      code: d.getElementsByTagName("cProd")[0]?.textContent ?? "", name: d.getElementsByTagName("xProd")[0]?.textContent ?? "",
      productId: "", qty: Number(d.getElementsByTagName("qCom")[0]?.textContent ?? 0), unitPrice: d.getElementsByTagName("vUnCom")[0]?.textContent ?? "", weight: 0,
    }));
    if (!key || items.length === 0) return null;
    return { key, destCnpj, items };
  } catch { return null; }
}

function E02() {
  const ctx = useCtx();
  const act = useAct();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const order = ctx.db.orders.find((o) => o.id === sp.get("pedido"));
  const imp = ctx.db.imports.find((i) => i.id === sp.get("importacao"));
  const [mode, setMode] = useState<"xml" | "chave" | "manual">("manual");
  const [key, setKey] = useState("");
  const [supplierId, setSupplier] = useState(order?.supplierId ?? imp?.supplierId ?? "");
  const deps = ctx.db.locations.filter((l) => ctx.company && l.companyId === ctx.company.id && l.type === "deposito");
  const [dest, setDest] = useState(deps[0]?.id ?? "");
  const [items, setItems] = useState<DraftItem[]>(
    order ? order.items.map((i) => ({ code: "", name: prodName(ctx.db, i.productId), productId: i.productId, qty: Math.max(1, i.qty - i.received), unitPrice: String(i.unitPrice), weight: 0 })) : [{ code: "", name: "", productId: "", qty: 1, unitPrice: "", weight: 0 }],
  );
  const [msg, setMsg] = useState("");
  const upd = (i: number, patch: Partial<DraftItem>) => setItems(items.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  const onXml = async (f: File | undefined) => {
    if (!f) return;
    const r = parseNfeXml(await f.text());
    if (!r) return setMsg("XML inválido: não foi possível ler a chave e os itens.");
    if (r.destCnpj && ctx.company && r.destCnpj !== ctx.company.cnpj.replace(/\D/g, "")) return setMsg("O destinatário da nota não é o CNPJ da empresa atual.");
    setKey(r.key);
    setItems(r.items.map((it) => ({ ...it, productId: ctx.db.products.find((x) => x.code === it.code)?.id ?? "" })));
    setMsg(`XML lido: ${r.items.length} item(ns). Vincule os produtos que faltam.`);
  };
  const consult = () => setMsg("A chave sozinha não traz os itens (provedor simulado). Lance os itens à mão ou envie o XML.");
  const go = () => act((db) => {
    if (!ctx.company) throw new Error("Escolha uma empresa.");
    if (items.some((i) => !i.productId)) throw new Error("Item sem produto bloqueia a conferência: vincule ou crie o produto.");
    return createInbound(db, {
      companyId: ctx.company.id, supplierId, nfeKey: key, destLocationId: dest, orderId: order?.id, importId: imp?.id,
      currency: imp?.currency ?? order?.currency ?? "BRL", fx: imp?.fx,
      items: items.map((i) => ({ productId: i.productId, qty: i.qty, unitPrice: i.unitPrice === "" || !ctx.seeCost && !order && !imp ? (i.unitPrice === "" ? null : Number(i.unitPrice)) : Number(i.unitPrice), weight: i.weight })),
    }, ctx.user.id);
  }, { ok: "Entrada criada.", go: (i) => p(to("/estoque/entradas/:id/itens", { id: i.id })) });
  return (
    <>
      <PageHeader code="E02" title="Nova entrada" subtitle={order ? `Origem: pedido ${order.number}` : imp ? `Origem: importação ${imp.invoiceNo}` : "Enviar XML, informar a chave ou lançar à mão."} />
      {ctx.readOnly && <ReadOnlyBanner />}
      <Card>
        <div className="mb-3 flex gap-2">{(["xml", "chave", "manual"] as const).map((m) => <Btn key={m} variant={mode === m ? "primary" : "secondary"} onClick={() => setMode(m)}>{m === "xml" ? "Enviar XML" : m === "chave" ? "Informar a chave" : "Lançar à mão"}</Btn>)}</div>
        {mode === "xml" && <Field label="Arquivo XML da NF-e"><input type="file" accept=".xml,text/xml" onChange={(e) => onXml(e.target.files?.[0])} /></Field>}
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label="Chave da NF-e (44 dígitos)"><Input value={key} maxLength={50} onChange={(e) => setKey(e.target.value)} /></Field>
          <Field label="Fornecedor"><Select value={supplierId} onChange={(e) => setSupplier(e.target.value)}><option value="">Escolha…</option>{ctx.db.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <Field label="Local de destino"><Select value={dest} onChange={(e) => setDest(e.target.value)}>{deps.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
        </div>
        {mode === "chave" && <div className="mt-2"><Btn variant="secondary" onClick={consult} disabled={!validateNfeKey(key)}>Consultar chave</Btn></div>}
        {msg && <p className="mt-2 text-sm text-amber-800" role="status">{msg}</p>}
        <h3 className="mb-2 mt-4 text-sm font-semibold">Itens</h3>
        {items.map((it, i) => (
          <div key={i} className="mb-2 grid gap-2 sm:grid-cols-[1fr_1fr_90px_130px_auto]">
            <Input aria-label="Descrição" placeholder="Descrição da nota" value={it.name} onChange={(e) => upd(i, { name: e.target.value })} />
            <Select aria-label="Produto do cadastro" value={it.productId} onChange={(e) => upd(i, { productId: e.target.value })}><option value="">Vincular produto…</option>{ctx.db.products.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}</Select>
            <Input aria-label="Quantidade" type="number" min={1} value={it.qty} onChange={(e) => upd(i, { qty: Number(e.target.value) })} />
            {ctx.seeCost ? <Input aria-label="Preço unitário" type="number" min={0} step="0.01" placeholder="Preço" value={it.unitPrice} onChange={(e) => upd(i, { unitPrice: e.target.value })} /> : <Badge>preço: administrador</Badge>}
            <Btn variant="ghost" disabled={items.length === 1} onClick={() => setItems(items.filter((_, k) => k !== i))}>Remover</Btn>
          </div>
        ))}
        <div className="flex gap-2"><Btn variant="secondary" onClick={() => setItems([...items, { code: "", name: "", productId: "", qty: 1, unitPrice: "", weight: 0 }])}>+ Item</Btn><LinkBtn to={p("/cadastros/produtos/novo")}>Criar produto</LinkBtn></div>
        <div className="mt-4 flex gap-2"><Btn onClick={go} disabled={ctx.readOnly || !ctx.can("estoque", "criar")}>Continuar</Btn><Btn variant="secondary" onClick={() => nav(p("/estoque/entradas"))}>Cancelar</Btn></div>
      </Card>
    </>
  );
}

// ---- E03 ----
function E03() {
  const { ctx, inb } = useInbound();
  const act = useAct();
  const nav = useNavigate();
  const [prices, setPrices] = useState<Record<string, string>>({});
  if (!inb) return <NotFound />;
  const missing = inb.items.some((i) => i.unitPrice === null);
  return (
    <>
      <PageHeader code="E03" title={`Itens da nota ${inb.number}`} subtitle="Quantidades e valores da nota não são alterados. Preço de compra é obrigatório em todo item." />
      <Card>
        <DataTable rows={inb.items} cols={[
          { h: "Produto", cell: (i) => prodName(ctx.db, i.productId) },
          { h: "Exige série", cell: (i) => (ctx.db.products.find((x) => x.id === i.productId)?.requiresSerial ? "Sim" : "Não") },
          { h: "Quantidade", cell: (i) => i.qty, right: true },
          { h: "Preço unitário", right: true, cell: (i) => ctx.seeCost && inb.status !== "fechada"
            ? <Input type="number" min={0} step="0.01" className="w-32 text-right" value={prices[i.id] ?? (i.unitPrice ?? "")} onChange={(e) => setPrices({ ...prices, [i.id]: e.target.value })} onBlur={() => { const v = prices[i.id]; if (v !== undefined && v !== "") act((db) => setLotPrice(db, inb.id, i.id, Number(v), ctx.user.id)); }} />
            : (ctx.seeCost ? brl(i.unitPrice) : "oculto") },
        ]} />
        <p className="mt-2 text-xs text-slate-500">Item sem produto bloqueia a conferência. <LinkBtn to={p("/cadastros/produtos/novo")}>Criar produto</LinkBtn></p>
        {missing && <p className="mt-2 text-sm text-red-700" role="alert">Há item sem preço de compra. Um administrador precisa preencher antes de iniciar a conferência.</p>}
        <div className="mt-4 flex gap-2">
          <Btn disabled={ctx.readOnly || missing || inb.status === "fechada"} onClick={() => act((db) => startConference(db, inb.id, ctx.user.id), { ok: "Conferência iniciada.", go: p(to("/estoque/entradas/:id/conferencia", { id: inb.id })) })}>Iniciar conferência</Btn>
          <Btn variant="secondary" onClick={() => nav(p("/estoque/entradas"))}>Salvar e sair</Btn>
        </div>
      </Card>
    </>
  );
}

// ---- E04 ----
type Pending = { serial: string; itemId: string; manual: boolean; reason?: string };
const draftKey = (id: string) => `estoque.conferencia.rascunho.${id}`;
const loadDraft = (id: string): Pending[] => { try { return JSON.parse(localStorage.getItem(draftKey(id)) ?? "[]"); } catch { return []; } };
const saveDraft = (id: string, v: Pending[]) => { try { localStorage.setItem(draftKey(id), JSON.stringify(v)); } catch { /* sem armazenamento */ } };

function E04() {
  const { ctx, inb } = useInbound();
  const act = useAct();
  const toast = useToast();
  const nav = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [val, setVal] = useState("");
  const [itemId, setItemId] = useState("");
  const [manual, setManual] = useState(false);
  const [reason, setReason] = useState("");
  const [log, setLog] = useState<{ ok: boolean; text: string }[]>([]);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [queue, setQueue] = useState<Pending[]>(() => (inb ? loadDraft(inb.id) : []));
  const [preview, setPreview] = useState<ReturnType<typeof resolveScan> | null>(null);
  const inbId = inb?.id;

  const apply = useCallback((items: Pending[]) => {
    const failed: Pending[] = [];
    const msgs: { ok: boolean; text: string }[] = [];
    for (const it of items) {
      const r = act((db) => scanSerial(db, inbId!, it.serial, it.itemId, ctx.user.id, { manual: it.manual, reason: it.reason }));
      msgs.push(r.ok ? { ok: true, text: `${it.serial} lida` } : { ok: false, text: `${it.serial}: ${r.error}` });
      if (!r.ok) failed.push(it);
    }
    setLog((l) => [...msgs, ...l].slice(0, 30));
    return failed;
   
  }, [act, inbId, ctx.user.id]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  // Ao voltar a conexão, sobe as leituras guardadas no aparelho; o servidor valida de novo.
  useEffect(() => {
    if (online && queue.length > 0 && inbId) {
      const failed = apply(queue);
      setQueue(failed);
      saveDraft(inbId, failed);
      toast.ok(`${queue.length - failed.length} leitura(s) do aparelho enviadas${failed.length ? `; ${failed.length} recusada(s) pelo servidor` : ""}.`);
    }
   
  }, [online]);
  useEffect(() => { input.current?.focus(); });

  if (!inb) return <NotFound />;
  const sum = conferenceSummary(inb);
  const readOnly = ctx.readOnly || inb.status === "fechada" || (!!inb.conferenceBy && inb.conferenceBy !== ctx.user.id);
  const curItem = itemId || sum.unreadByItem.find((u) => u.missing > 0)?.itemId || inb.items[0]?.id;

  const submit = (raw: string) => {
    const code = raw.trim();
    if (!code || readOnly) return;
    if (manual && !reason.trim()) return setLog((l) => [{ ok: false, text: "Digitar à mão exige motivo." }, ...l]);
    const scan = resolveScan(ctx.db, code, "conferencia", inb.companyId, inb.scans.map((s) => s.serial));
    if (scan.kind === "codigo_mae") { setPreview(scan); setVal(""); return; }
    const entry: Pending = { serial: code, itemId: curItem!, manual, reason: manual ? reason : undefined };
    if (!online) {
      const q = [...queue, entry];
      setQueue(q); saveDraft(inb.id, q);
      setLog((l) => [{ ok: true, text: `${code} guardada no aparelho (sem internet)` }, ...l]);
    } else {
      const failed = apply([entry]);
      void failed;
    }
    setVal("");
  };
  const applyMother = () => {
    if (!preview) return;
    if (preview.issues.some((i) => !i.serial || !i.message.includes("releitura"))) { /* mostra, mas só bloqueia problemas de integridade */ }
    const blocking = preview.issues.filter((i) => !i.serial);
    if (blocking.length) return setLog((l) => [{ ok: false, text: blocking[0].message }, ...l]);
    const entries = preview.serials.filter((s) => !inb.scans.some((x) => x.serial === s)).map((s) => ({ serial: s, itemId: curItem!, manual: false }));
    apply(entries);
    setPreview(null);
  };

  return (
    <>
      <PageHeader code="E04" title={`Conferência ${inb.number}`} subtitle={`${sum.read} de ${sum.expected} lidas`} actions={<>
        <Btn variant="secondary" onClick={() => nav(p("/estoque/entradas"))}>Salvar e continuar depois</Btn>
        <LinkBtn to={p(to("/estoque/entradas/:id/divergencias", { id: inb.id }))}>Revisar divergências</LinkBtn>
      </>} />
      {readOnly && <div className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{inb.status === "fechada" ? "Entrada fechada." : "Outra pessoa já está conferindo (ou visão Grupo): abre só para ver."}</div>}
      {!online && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">Sem internet: as leituras ficam salvas neste aparelho e sobem sozinhas quando a conexão voltar. Fechar a conferência exige internet.</div>}
      {queue.length > 0 && <div className="mb-3 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-900">{queue.length} leitura(s) guardada(s) no aparelho aguardando envio.</div>}
      <div className="grid gap-3 lg:grid-cols-[1fr_320px]">
        <Card title="Leitura">
          <form onSubmit={(e) => { e.preventDefault(); submit(val); }} className="space-y-3">
            <Field label="Leia o código (leitor Bluetooth em modo teclado envia Enter ao final)">
              <input ref={input} value={val} onChange={(e) => setVal(e.target.value)} disabled={readOnly} autoComplete="off" className="w-full rounded-md border-2 border-sky-600 px-3 py-3 font-mono text-lg" aria-label="Campo de leitura" />
            </Field>
            <Field label="Item da nota"><Select value={curItem} onChange={(e) => setItemId(e.target.value)}>{inb.items.map((i) => <option key={i.id} value={i.id}>{prodName(ctx.db, i.productId)} — {inb.scans.filter((s) => s.itemId === i.id).length}/{i.qty}</option>)}</Select></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} /> Digitar série à mão (exige motivo)</label>
            {manual && <Input placeholder="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} />}
            <Btn type="submit" disabled={readOnly}>Registrar leitura</Btn>
          </form>
          <ul className="mt-3 space-y-1 text-sm" aria-live="polite">{log.slice(0, 8).map((l, i) => <li key={i} className={l.ok ? "text-emerald-700" : "text-red-700"}>{l.ok ? "✔" : "✖"} {l.text}</li>)}</ul>
        </Card>
        <Card title="Lidas">
          <ul className="max-h-96 divide-y divide-slate-100 overflow-auto text-sm">
            {[...inb.scans].reverse().map((s) => (
              <li key={s.serial} className="flex items-center justify-between py-1"><span className="font-mono text-emerald-700">● {s.serial}{s.manual && " (manual)"}</span>
                {!readOnly && <Btn variant="ghost" onClick={() => act((db) => undoScan(db, inb.id, s.serial))}>Desfazer</Btn>}</li>
            ))}
            {inb.scans.length === 0 && <li className="py-2 text-slate-500">Nenhuma leitura ainda.</li>}
          </ul>
        </Card>
      </div>
      {preview && (
        <Modal title="Código-mãe lido (prévia)" onClose={() => setPreview(null)}>
          <p className="mb-2 text-sm">Caixa {preview.motherCode?.box}: {preview.serials.length} série(s). Nada é aplicado até confirmar.</p>
          {preview.issues.length > 0 && <ul className="mb-2 list-disc pl-5 text-sm text-amber-800">{preview.issues.slice(0, 8).map((i, k) => <li key={k}>{i.serial ? `${i.serial}: ` : ""}{i.message}</li>)}</ul>}
          <div className="flex justify-end gap-2"><Btn variant="secondary" onClick={() => setPreview(null)}>Voltar</Btn><Btn onClick={applyMother}>Aplicar leitura</Btn></div>
        </Modal>
      )}
      <div className="mt-4"><LinkBtn variant="primary" to={p(to("/estoque/entradas/:id/divergencias", { id: inb.id }))}>Revisar divergências e seguir</LinkBtn></div>
    </>
  );
}

// ---- E05 ----
function E05() {
  const { ctx, inb } = useInbound();
  const act = useAct();
  const [d, setD] = useState({ kind: "falta" as "falta" | "excesso" | "item_errado" | "avaria", itemId: "", qty: 1, reason: "" });
  if (!inb) return <NotFound />;
  const sum = conferenceSummary(inb);
  return (
    <>
      <PageHeader code="E05" title={`Divergências ${inb.number}`} subtitle="Divergência exige motivo e aprovação de um administrador." actions={<><LinkBtn to={p(to("/estoque/entradas/:id/conferencia", { id: inb.id }))}>Corrigir</LinkBtn><LinkBtn variant="primary" to={p(to("/estoque/entradas/:id/custos", { id: inb.id }))}>Seguir para os custos</LinkBtn></>} />
      <Card title="Resumo"><KV items={[["Esperadas", sum.expected], ["Lidas", sum.read], ["Faltando por item", sum.unreadByItem.map((u) => `${prodName(ctx.db, inb.items.find((i) => i.id === u.itemId)!.productId)}: ${u.missing}`).join(" · ")]]} /></Card>
      <Card title="Registrar divergência" className="mt-3">
        <div className="grid gap-2 sm:grid-cols-5">
          <Select value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value as typeof d.kind })}><option value="falta">Falta</option><option value="excesso">Excesso</option><option value="item_errado">Item errado</option><option value="avaria">Avaria</option></Select>
          <Select value={d.itemId} onChange={(e) => setD({ ...d, itemId: e.target.value })}><option value="">Item…</option>{inb.items.map((i) => <option key={i.id} value={i.id}>{prodName(ctx.db, i.productId)}</option>)}</Select>
          <Input type="number" min={1} value={d.qty} onChange={(e) => setD({ ...d, qty: Number(e.target.value) })} />
          <Input placeholder="Motivo (obrigatório)" value={d.reason} onChange={(e) => setD({ ...d, reason: e.target.value })} className="sm:col-span-2" />
        </div>
        <div className="mt-2"><Btn disabled={ctx.readOnly} onClick={() => act((db) => requestDivergence(db, inb.id, { ...d, itemId: d.itemId || undefined }, ctx.user.id), { ok: "Aguardando aprovação.", then: () => setD({ ...d, reason: "" }) })}>Pedir aprovação</Btn></div>
      </Card>
      <Card title="Divergências" className="mt-3">
        <DataTable rows={inb.divergences} cols={[
          { h: "Tipo", cell: (x) => x.kind }, { h: "Item", cell: (x) => (x.itemId ? prodName(ctx.db, inb.items.find((i) => i.id === x.itemId)?.productId ?? "") : "—") }, { h: "Qtd", cell: (x) => x.qty, right: true },
          { h: "Motivo", cell: (x) => x.reason }, { h: "Situação", cell: (x) => <StatusBadge s={x.status} /> },
          { h: "", cell: (x) => x.status === "pendente" ? <span className="flex gap-1">
            <Btn disabled={!ctx.isAdmin || x.requestedBy === ctx.user.id} title={x.requestedBy === ctx.user.id ? "Quem pede não aprova" : ""} onClick={() => act((db) => decideDivergence(db, inb.id, x.id, true, ctx.user.id), { ok: "Aprovada." })}>Aprovar</Btn>
            <Btn variant="danger" disabled={!ctx.isAdmin || x.requestedBy === ctx.user.id} onClick={() => act((db) => decideDivergence(db, inb.id, x.id, false, ctx.user.id), { ok: "Rejeitada." })}>Rejeitar</Btn></span> : null },
        ]} empty={<p className="text-sm text-slate-500">Nenhuma divergência.</p>} />
      </Card>
    </>
  );
}

// ---- E06 ----
function E06() {
  const { ctx, inb } = useInbound();
  const act = useAct();
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => { const a = () => setOnline(true), b = () => setOnline(false); window.addEventListener("online", a); window.addEventListener("offline", b); return () => { window.removeEventListener("online", a); window.removeEventListener("offline", b); }; }, []);
  if (!inb) return <NotFound />;
  const sum = conferenceSummary(inb);
  const total = inb.scans.reduce((a, s) => a + (s.price ?? 0), 0) * (inb.currency === "BRL" ? 1 : inb.fx);
  const blockers = [
    sum.missingPrice > 0 && `${sum.missingPrice} série(s) sem preço de compra (RN-020)`,
    sum.pendingDivergences > 0 && `${sum.pendingDivergences} divergência(s) aguardando aprovação`,
    inb.scans.length === 0 && "nenhuma série lida",
    !online && "sem internet (fechar exige conexão)",
  ].filter(Boolean) as string[];
  return (
    <>
      <PageHeader code="E06" title={`Fechar conferência ${inb.number}`} actions={<LinkBtn to={p(to("/estoque/entradas/:id/custos", { id: inb.id }))}>Voltar</LinkBtn>} />
      <Card>
        <KV items={[["Esperadas", sum.expected], ["Lidas", sum.read], ["Destino", ctx.db.locations.find((l) => l.id === inb.destLocationId)?.name], ["Custo do lote", ctx.seeCost ? brl(total) : "oculto"]]} />
        {blockers.length > 0 && <ul className="mt-3 list-disc pl-5 text-sm text-red-700" role="alert">{blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
        <p className="mt-3 text-xs text-slate-500">Aplica todas as séries ou nenhuma. Repetir a operação não duplica. Itens não conferidos continuam bloqueados.</p>
        <div className="mt-4">
          <ConfirmButton variant="primary" label="Confirmar fechamento" message="Fechar a conferência cria as séries e dá entrada no estoque. Depois só estorno ou ajuste." disabled={ctx.readOnly || inb.status === "fechada" || !ctx.can("estoque", "confirmar")} onConfirm={() => act((db) => closeConference(db, inb.id, ctx.user.id), { ok: "Conferência fechada. Estoque atualizado.", go: p(to("/estoque/entradas/:id", { id: inb.id })) })} />
        </div>
      </Card>
    </>
  );
}

// ---- E07 ----
function E07() {
  const { ctx, inb } = useInbound();
  const act = useAct();
  if (!inb) return <NotFound />;
  const sers = ctx.db.serials.filter((s) => s.inboundId === inb.id);
  const xml = () => download(`${inb.number}.xml`, `<?xml version="1.0" encoding="UTF-8"?>\n<entrada numero="${inb.number}" chave="${inb.nfeKey}"/>`, "application/xml");
  return (
    <>
      <PageHeader code="E07" title={`Entrada ${inb.number}`} subtitle={<StatusBadge s={inb.status} />} actions={<>
        {ctx.seeCost && <LinkBtn to={p(to("/estoque/entradas/:id/custos", { id: inb.id }))}>Ver custos</LinkBtn>}
        <Btn variant="secondary" onClick={() => window.print()}>Imprimir comprovante</Btn>
        <Btn variant="secondary" onClick={xml}>Baixar XML</Btn>
        <LinkBtn to={p("/estoque/etiquetas")}>Imprimir etiquetas</LinkBtn>
        {ctx.isAdmin && inb.status === "fechada" && <ReasonButton variant="danger" label="Estornar" title="Estornar entrada" onSubmit={(r) => act((db) => reverseInbound(db, inb.id, ctx.user.id, r), { ok: "Entrada estornada.", go: p("/estoque/entradas") })} />}
        <LinkBtn to={p("/estoque/entradas")}>Voltar</LinkBtn></>} />
      <Card><KV items={[["Fornecedor", supName(ctx.db, inb.supplierId)], ["Chave", <span key="k" className="font-mono text-xs">{inb.nfeKey}</span>], ["Situação fiscal", <StatusBadge key="f" s={inb.fiscalStatus} />], ["Conferido por", ctx.db.profiles.find((x) => x.id === inb.conferenceBy)?.name], ["Fechada em", dt(inb.closedAt)]]} /></Card>
      <Card title="Itens" className="mt-3"><DataTable rows={inb.items} cols={[{ h: "Produto", cell: (i) => prodName(ctx.db, i.productId) }, { h: "Qtd", cell: (i) => i.qty, right: true }, { h: "Lidas", cell: (i) => inb.scans.filter((s) => s.itemId === i.id).length, right: true }]} /></Card>
      <Card title={`Séries (${sers.length})`} className="mt-3">
        <DataTable rows={sers} cols={[{ h: "Série", cell: (s) => s.serial }, { h: "Situação", cell: (s) => <StatusBadge s={s.commercial} /> }, ...(ctx.seeCost ? [{ h: "Custo", cell: (s: typeof sers[number]) => brl(s.cost), right: true }] : [])]} onRow={(s) => p(to("/estoque/equipamentos/:id", { id: s.id }))} empty={<p className="text-sm text-slate-500">Séries são criadas ao fechar a conferência.</p>} />
      </Card>
    </>
  );
}

// ---- E08 ----
function E08() {
  const { ctx, inb } = useInbound();
  const act = useAct();
  const [open, setOpen] = useState<string | null>(null);
  const [sheet, setSheet] = useState("");
  const [adj, setAdj] = useState<{ serial: string; price: string } | null>(null);
  const [adjReason, setAdjReason] = useState("");
  if (!inb) return <NotFound />;
  if (!ctx.seeCost) return <NoPermission what="Somente administradores veem e editam custos." />;
  const closed = inb.status === "fechada";
  const imp = ctx.db.imports.find((i) => i.id === inb.importId);
  const rows = sheet.trim() ? parseCsv(sheet).filter((r) => !/^serie/i.test(r[0])).map((r) => ({ serial: r[0], price: Number((r[1] ?? "").replace(",", ".")) })) : [];
  const pv = rows.length ? previewPriceSheet(ctx.db, inb.id, rows) : null;
  const rate = inb.currency === "BRL" ? 1 : inb.fx;
  const lotLines = (lotId: string) => closed ? ctx.db.serials.filter((s) => s.lotId === lotId).map((s) => ({ serial: s.serial, price: s.purchasePrice, cost: s.cost, status: s.costStatus })) : inb.scans.filter((s) => s.itemId === lotId).map((s) => ({ serial: s.serial, price: s.price === null ? null : s.price * rate, cost: s.price === null ? null : s.price * rate, status: "provisorio" as const }));
  const model = () => download("modelo-precos.csv", "serie;preco\r\nSERIE001;100,00", "text/csv");
  return (
    <>
      <PageHeader code="E08" title={`Custo por lote e série — ${inb.number}`} subtitle={imp && !imp.rateioClosed ? "Importação: custo provisório até fechar o rateio (D08)." : "Preço de compra obrigatório em toda série para fechar a conferência (RN-020)."}
        actions={<><Btn variant="secondary" onClick={model}>Baixar planilha modelo</Btn><LinkBtn to={p(to(closed ? "/estoque/entradas/:id" : "/estoque/entradas/:id/divergencias", { id: inb.id }))}>Voltar</LinkBtn>{!closed && <LinkBtn variant="primary" to={p(to("/estoque/entradas/:id/fechar", { id: inb.id }))}>Seguir para fechar</LinkBtn>}</>} />
      {inb.currency !== "BRL" && <p className="mb-2 text-sm text-slate-600">Compra em {inb.currency}, câmbio usado: {inb.fx}.</p>}
      {inb.items.map((it) => {
        const lines = lotLines(it.id);
        return (
          <Card key={it.id} className="mb-3" title={`${prodName(ctx.db, it.productId)} · ${it.qty} un.`} actions={<Btn variant="ghost" onClick={() => setOpen(open === it.id ? null : it.id)}>{open === it.id ? "Fechar lote" : "Abrir lote"}</Btn>}>
            <div className="grid gap-3 sm:grid-cols-4 text-sm">
              <Field label={`Preço unitário (${inb.currency})`}><Input type="number" step="0.01" min={0} disabled={closed} defaultValue={it.unitPrice ?? ""} onBlur={(e) => e.target.value !== "" && Number(e.target.value) !== it.unitPrice && act((db) => setLotPrice(db, inb.id, it.id, Number(e.target.value), ctx.user.id), { ok: "Preço do lote atualizado (séries alteradas à mão foram preservadas)." })} /></Field>
              <div><div className="text-xs text-slate-500">Custo rateado</div><div>{brl(it.allocated)}</div></div>
              <div><div className="text-xs text-slate-500">Custo total do lote</div><div className="font-semibold">{brl(lines.reduce((a, l) => a + (l.cost ?? 0), 0) + (closed ? 0 : it.allocated))}</div></div>
              <div><div className="text-xs text-slate-500">Situação do custo</div><StatusBadge s={lines[0]?.status ?? "provisorio"} /></div>
            </div>
            {open === it.id && (
              <div className="mt-3">
                <DataTable rows={lines} cols={[
                  { h: "Série", cell: (l) => l.serial }, { h: "Preço de compra (R$)", cell: (l) => (l.price === null ? <Badge tone="red">sem preço</Badge> : brl(l.price)), right: true },
                  { h: "Custo", cell: (l) => brl(l.cost), right: true }, { h: "Situação", cell: (l) => <StatusBadge s={l.status} /> },
                  { h: "", cell: (l) => closed
                    ? <Btn variant="ghost" onClick={() => setAdj({ serial: l.serial, price: String(l.price ?? "") })}>Ajustar custo</Btn>
                    : <ReasonButton label="Editar preço" variant="ghost" title={`Preço da série ${l.serial}`} onSubmit={(r) => { const v = prompt(`Novo preço para ${l.serial} (${inb.currency})`, String(l.price ?? "")); if (v !== null) act((db) => setSerialPrice(db, inb.id, l.serial, v === "" ? null : Number(v.replace(",", ".")), r, ctx.user.id), { ok: "Preço da série alterado." }); }} /> },
                ]} />
              </div>
            )}
          </Card>
        );
      })}
      {!closed && (
        <Card title="Importar planilha série + preço">
          <Textarea rows={4} placeholder="serie;preco" value={sheet} onChange={(e) => setSheet(e.target.value)} />
          <input type="file" accept=".csv" className="mt-2 text-sm" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setSheet(await f.text()); }} />
          {pv && <div className="mt-2 text-sm"><p>{pv.count} linha(s) lidas, {pv.errors.length} erro(s). Nada grava antes de confirmar.</p><ul className="list-disc pl-5 text-red-700">{pv.errors.map((e) => <li key={e.line}>Linha {e.line}: {e.message}</li>)}</ul></div>}
          <div className="mt-2"><Btn disabled={!pv?.ok} onClick={() => act((db) => applyPriceSheet(db, inb.id, rows, ctx.user.id), { ok: "Preços importados.", then: () => setSheet("") })}>Confirmar importação</Btn></div>
        </Card>
      )}
      {adj && (
        <Modal title={`Ajustar custo — ${adj.serial}`} onClose={() => setAdj(null)}>
          <p className="mb-2 text-xs text-slate-500">Entrada fechada: o ajuste exige motivo e fica no histórico.</p>
          <Field label="Novo preço de compra (R$)"><Input type="number" step="0.01" min={0} value={adj.price} onChange={(e) => setAdj({ ...adj, price: e.target.value })} /></Field>
          <Field label="Motivo (obrigatório)" className="mt-2"><Textarea rows={2} value={adjReason} onChange={(e) => setAdjReason(e.target.value)} /></Field>
          <div className="mt-3 flex justify-end gap-2"><Btn variant="secondary" onClick={() => setAdj(null)}>Cancelar</Btn><Btn onClick={() => { const r = act((db) => adjustClosedCost(db, adj.serial, Number(adj.price), adjReason, ctx.user.id), { ok: "Custo ajustado e registrado." }); if (r.ok) { setAdj(null); setAdjReason(""); } }}>Confirmar</Btn></div>
        </Modal>
      )}
      {closed && (
        <Card title="Histórico de ajustes" className="mt-3">
          <DataTable rows={ctx.db.costAdjustments.filter((a) => inb.scans.some((s) => findSerial(ctx.db, s.serial)?.id === a.serialId))} cols={[{ h: "Quando", cell: (a) => dt(a.at) }, { h: "Série", cell: (a) => ctx.db.serials.find((s) => s.id === a.serialId)?.serial }, { h: "De", cell: (a) => brl(a.from), right: true }, { h: "Para", cell: (a) => brl(a.to), right: true }, { h: "Motivo", cell: (a) => a.reason }, { h: "Por", cell: (a) => ctx.db.profiles.find((x) => x.id === a.by)?.name }]} empty={<p className="text-sm text-slate-500">Sem ajustes.</p>} />
        </Card>
      )}
    </>
  );
}

export const screens: Record<string, ComponentType> = { E01, E02, E03, E04, E05, E06, E07, E08 };
