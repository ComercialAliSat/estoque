import { useRef, useState, type ComponentType } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Badge, Btn, Card, ConfirmButton, DataTable, Empty, Field, Input, KV, LinkBtn, PageHeader, Select, SIMULATED_BANNER, StatusBadge, Textarea, useAct, useToast,
} from "../components/ui";
import { audit } from "../domain/core";
import { SIMULATED_LABEL, createInvoiceDraft, inutilize, invoiceEvent, invoiceXml, previewTaxes, transmitInvoice, suggestTaxType } from "../domain/fiscal";
import { sendTransfer } from "../domain/logistics";
import { cancelOutboundAfterInvoiceCancel, requestOutboundInvoice, transmitOutboundInvoice } from "../domain/sales";
import type { Db, Invoice } from "../domain/types";
import { brl, dt, download } from "../format";
import { p, to } from "../routes";
import { useCtx } from "../session";

const cust = (db: Db, id?: string) => db.customers.find((c) => c.id === id)?.name ?? "—";
const protocol = (inv: Invoice) => (inv.status === "autorizada" || inv.status === "cancelada" ? `SIMULADO-${inv.number ?? 0}` : "—");

// ---- K01 ----
function K01() {
  const ctx = useCtx();
  const act = useAct();
  const [sp] = useSearchParams();
  const initial = sp.get("situacao") === "erro" ? "erro" : "";
  const [st, setSt] = useState(initial);
  const [op, setOp] = useState("");
  const [from, setFrom] = useState("");
  const [to2, setTo2] = useState("");
  const rows = ctx.db.invoices.filter((i) => ctx.companyIds.includes(i.companyId)
    && (!st || (st === "erro" ? i.status === "com_erro" || i.status === "nao_transmitida" : i.status === st))
    && (!op || i.operation === op) && (!from || i.createdAt.slice(0, 10) >= from) && (!to2 || i.createdAt.slice(0, 10) <= to2));
  const batch = () => {
    const xml = rows.filter((i) => i.status === "autorizada").map((i) => invoiceXml(ctx.db, i)).join("\n\n");
    if (!xml) return;
    download("notas-simuladas.xml", xml, "application/xml");
    act((db) => { db.exports.push({ id: `exp_${db.exports.length + 1}`, at: new Date().toISOString(), by: ctx.user.id, companyId: ctx.company?.id, screen: "notas-xml-lote", format: "csv", rows: rows.length }); }, { ok: "XML em lote baixado e registrado em Exportações." });
  };
  return (
    <>
      <PageHeader code="K01" title="Notas fiscais" subtitle="Todas as notas, sempre visíveis e filtráveis por situação (RN-019)." actions={<><Btn variant="secondary" onClick={batch} disabled={!ctx.can("fiscal", "exportar")}>Baixar XML em lote</Btn><LinkBtn to={p("/fiscal/inutilizacao")}>Inutilizar</LinkBtn>{!ctx.readOnly && ctx.can("fiscal", "criar") && <LinkBtn variant="primary" to={p("/fiscal/notas/emitir")}>Emitir nota</LinkBtn>}</>} />
      {SIMULATED_BANNER}
      <div className="mb-3 flex flex-wrap gap-2">
        <Select className="max-w-52" value={st} onChange={(e) => setSt(e.target.value)}><option value="">Todas as situações</option><option value="erro">Com erro ou não transmitidas</option>{["rascunho", "autorizada", "cancelada", "inutilizada", "com_erro", "nao_transmitida", "em_transmissao"].map((s) => <option key={s}>{s}</option>)}</Select>
        <Select className="max-w-44" value={op} onChange={(e) => setOp(e.target.value)}><option value="">Todos os tipos</option>{["venda", "comodato", "remessa", "retorno", "devolucao", "transferencia", "perda"].map((o) => <option key={o}>{o}</option>)}</Select>
        <Input type="date" className="max-w-40" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="De" /><Input type="date" className="max-w-40" value={to2} onChange={(e) => setTo2(e.target.value)} aria-label="Até" />
      </div>
      <DataTable rows={rows} cols={[
        { h: "Nota", cell: (i) => i.number ?? "rascunho" }, { h: "Empresa", cell: (i) => ctx.db.companies.find((c) => c.id === i.companyId)?.name }, { h: "Tipo", cell: (i) => i.operation },
        { h: "Cliente", cell: (i) => cust(ctx.db, i.customerId) }, { h: "Total", cell: (i) => brl(i.total), right: true }, { h: "Situação", cell: (i) => <StatusBadge s={i.status} /> }, { h: "", cell: () => <Badge tone="amber">SIMULADA</Badge> },
      ]} onRow={(i) => p(to("/fiscal/notas/:id", { id: i.id }))} empty={<Empty text="Nenhuma nota." action={<LinkBtn variant="primary" to={p("/fiscal/notas/emitir")}>Emitir nota</LinkBtn>} />} />
    </>
  );
}

// ---- K02 ----
function K02() {
  const ctx = useCtx();
  const act = useAct();
  const nav = useNavigate();
  const toast = useToast();
  const [sp] = useSearchParams();
  const key = useRef(`manual:${Math.random().toString(36).slice(2)}`);
  const outbound = ctx.db.outbounds.find((o) => o.id === sp.get("saida"));
  const transfer = ctx.db.transfers.find((t) => t.id === sp.get("transferencia"));
  const company = ctx.company;
  const [manual, setManual] = useState({ operation: "devolucao" as Invoice["operation"], customerId: "", desc: "", qty: "1", value: "0" });
  const [taxId, setTaxId] = useState(outbound?.taxTypeId ?? "");
  const [fail, setFail] = useState<"" | "erro" | "nao_transmitida">("");
  const [transport, setTransport] = useState("");
  const operation: Invoice["operation"] = outbound ? (outbound.kind === "comodato" ? "comodato" : outbound.kind === "venda" ? "venda" : outbound.kind === "devolucao_fornecedor" ? "devolucao" : "remessa") : transfer ? "transferencia" : manual.operation;
  const customerId = outbound?.customerId ?? manual.customerId;
  const items: { desc: string; serial?: string; qty: number; unit: number }[] = outbound
    ? outbound.serials.map((s) => ({ desc: ctx.db.products.find((x) => x.id === ctx.db.serials.find((y) => y.serial === s)?.productId)?.name ?? s, serial: s, qty: 1, unit: outbound.unitValue[s] ?? 0 }))
    : transfer ? transfer.serials.map((s) => ({ desc: s, serial: s, qty: 1, unit: transfer.transferValue[s] ?? 0 }))
    : [{ desc: manual.desc || "Item avulso", qty: Number(manual.qty) || 1, unit: Number(manual.value) || 0 }];
  const suggested = company ? suggestTaxType(ctx.db, { companyId: company.id, operation, customerId }) : undefined;
  const tt = ctx.db.taxTypes.find((t) => t.id === (taxId || suggested?.id));
  const prev = tt ? previewTaxes(tt, items.map((i) => ({ qty: i.qty, unitValue: i.unit }))) : null;
  const total = items.reduce((a, i) => a + i.qty * i.unit, 0);
  const options = ctx.db.taxTypes.filter((t) => company && t.companyId === company.id && t.active && t.operation === operation);
  const cfop = tt?.cfop ?? "";

  const transmit = () => {
    if (!company) return;
    const run = (db: Db): string => {
      if (outbound) {
        const o = db.outbounds.find((x) => x.id === outbound.id)!;
        if (taxId || suggested?.id) o.taxTypeId = taxId || suggested?.id;
        const inv = requestOutboundInvoice(db, o.id, ctx.user.id);
        const dbInv = db.invoices.find((i) => i.id === inv.id)!;
        dbInv.taxTypeId = o.taxTypeId;
        dbInv.taxTotal = prev?.total ?? 0;
        dbInv.items.forEach((it) => { it.cfop = cfop; });
        transmitOutboundInvoice(db, o.id, ctx.user.id, fail ? { simulateFailure: fail } : {});
        return inv.id;
      }
      if (transfer) {
        sendTransfer(db, transfer.id, ctx.user.id);
        return db.transfers.find((t) => t.id === transfer.id)!.invoiceId!;
      }
      if (!manual.customerId && operation !== "transferencia") throw new Error("Escolha o destinatário.");
      const inv = createInvoiceDraft(db, { companyId: company.id, operation, customerId: manual.customerId || undefined, taxTypeId: taxId || suggested?.id, idempotencyKey: key.current, items: items.map((i) => ({ productId: "", qty: i.qty, unitValue: i.unit, cfop })) }, ctx.user.id);
      transmitInvoice(db, inv.id, ctx.user.id, fail ? { simulateFailure: fail } : {});
      return inv.id;
    };
    act(run, { ok: fail ? "Provedor simulado devolveu falha: veja a nota." : "Nota SIMULADA autorizada.", go: (id) => p(to("/fiscal/notas/:id", { id })) });
  };
  const draft = () => act((db) => {
    if (outbound) { requestOutboundInvoice(db, outbound.id, ctx.user.id); return; }
    createInvoiceDraft(db, { companyId: company!.id, operation, customerId: manual.customerId || undefined, taxTypeId: taxId || suggested?.id, idempotencyKey: key.current, items: items.map((i) => ({ productId: "", qty: i.qty, unitValue: i.unit, cfop })) }, ctx.user.id);
  }, { ok: "Rascunho salvo.", go: p("/fiscal/notas") });

  return (
    <>
      <PageHeader code="K02" title="Emitir nota" subtitle="Prévia antes de transmitir (RN-017). Clique repetido não gera duas notas." />
      {SIMULATED_BANNER}
      <Card>
        <KV items={[["Operação", operation], ["Destinatário", cust(ctx.db, customerId) || "—"], ["Origem", outbound ? `Saída ${outbound.number}` : transfer ? "Transferência entre empresas/locais" : "Avulsa"], ["Total", brl(total)]]} />
        {!outbound && !transfer && (
          <div className="mt-3 grid gap-3 sm:grid-cols-5">
            <Field label="Operação"><Select value={manual.operation} onChange={(e) => setManual({ ...manual, operation: e.target.value as Invoice["operation"] })}>{["devolucao", "retorno", "remessa", "perda", "venda", "comodato"].map((o) => <option key={o}>{o}</option>)}</Select></Field>
            <Field label="Destinatário"><Select value={manual.customerId} onChange={(e) => setManual({ ...manual, customerId: e.target.value })}><option value="">Escolha…</option>{ctx.db.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
            <Field label="Descrição"><Input value={manual.desc} onChange={(e) => setManual({ ...manual, desc: e.target.value })} /></Field>
            <Field label="Qtd"><Input type="number" min={1} value={manual.qty} onChange={(e) => setManual({ ...manual, qty: e.target.value })} /></Field>
            <Field label="Valor unit."><Input type="number" min={0} step="0.01" value={manual.value} onChange={(e) => setManual({ ...manual, value: e.target.value })} /></Field>
          </div>
        )}
        <div className="mt-3"><DataTable rows={items} cols={[{ h: "Item", cell: (i) => i.desc }, { h: "Série", cell: (i) => i.serial ?? "—" }, { h: "Qtd", cell: (i) => i.qty, right: true }, { h: "Valor", cell: (i) => brl(i.unit), right: true }, { h: "CFOP", cell: () => cfop || "—" }, { h: "Impostos", cell: (i) => (tt ? brl(previewTaxes(tt, [{ qty: i.qty, unitValue: i.unit }]).total) : "—"), right: true }]} /></div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label="Tipo de tributação aplicado" hint={tt ? `Regra v${tt.version}. ${tt.message}` : "Nenhuma regra encontrada (crie em C12)."}><Select value={taxId || suggested?.id || ""} onChange={(e) => setTaxId(e.target.value)}><option value="">—</option>{options.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
          <Field label="Transporte"><Input value={transport} onChange={(e) => setTransport(e.target.value)} placeholder="Transportadora / frete" /></Field>
          <Field label="Teste do provedor simulado"><Select value={fail} onChange={(e) => setFail(e.target.value as typeof fail)}><option value="">Autorizar normalmente</option><option value="erro">Simular rejeição (com erro)</option><option value="nao_transmitida">Simular falha de comunicação</option></Select></Field>
        </div>
        <p className="mt-2 text-sm">Impostos da prévia: <strong>{brl(prev?.total ?? 0)}</strong>. Alíquotas vêm do tipo de tributação; os exemplos do sistema estão zerados até o Fiscal preencher.</p>
        <div className="mt-4 flex gap-2">
          <ConfirmButton variant="primary" label="Transmitir" message="Transmitir a nota SIMULADA. Só com a nota autorizada o estoque baixa (RN-015)." disabled={ctx.readOnly || !company || !ctx.can("fiscal", "confirmar")} onConfirm={transmit} />
          <Btn variant="secondary" onClick={draft} disabled={ctx.readOnly || !!transfer}>Salvar rascunho</Btn>
          <Btn variant="ghost" onClick={() => (outbound ? nav(p(to("/estoque/saidas/:id/revisar", { id: outbound.id }))) : transfer ? nav(p(to("/estoque/transferencias/:id/revisar", { id: transfer.id }))) : nav(p("/fiscal/notas")))}>Voltar</Btn>
        </div>
        <p className="mt-2 text-xs text-slate-500" onClick={() => toast.ok("Configuração fiscal real (certificado, provedor) fica em N06/A09.")}>Emissão real fica bloqueada até concluir a configuração inicial (A09).</p>
      </Card>
    </>
  );
}

// ---- K03 ----
function K03() {
  const ctx = useCtx();
  const { id } = useParams();
  const act = useAct();
  const toast = useToast();
  const inv = ctx.db.invoices.find((i) => i.id === id && ctx.companyIds.includes(i.companyId));
  if (!inv) return <Empty text="Nota não encontrada." action={<LinkBtn to={p("/fiscal/notas")}>Voltar</LinkBtn>} />;
  const ob = ctx.db.outbounds.find((o) => o.invoiceId === inv.id);
  const retry = () => act((db) => { if (ob) transmitOutboundInvoice(db, ob.id, ctx.user.id); else transmitInvoice(db, inv.id, ctx.user.id); }, { ok: "Transmissão reenviada." });
  const xml = invoiceXml(ctx.db, inv);
  const margin = ctx.seeCost ? inv.items.reduce((a, it) => a + (it.unitValue * it.qty - (ctx.db.serials.find((s) => s.serial === it.serial)?.cost ?? 0)), 0) : null;
  return (
    <>
      <PageHeader code="K03" title={`Nota ${inv.number ?? "(rascunho)"}`} subtitle={<StatusBadge s={inv.status} />} actions={<>
        <Btn variant="secondary" onClick={() => download(`nota-${inv.number ?? inv.id}.xml`, xml, "application/xml")}>Baixar XML</Btn>
        <Btn variant="secondary" onClick={() => window.print()}>Baixar PDF (DANFE simulado)</Btn>
        <ConfirmButton variant="secondary" label="Reenviar por e-mail" message="Reenviar a nota por e-mail ao destinatário? (simulado: nenhum e-mail é enviado)" onConfirm={() => toast.ok("E-mail simulado: nenhuma mensagem foi enviada.")} />
        {(inv.status === "com_erro" || inv.status === "nao_transmitida") && <Btn onClick={retry}>Reenviar transmissão</Btn>}
        {ctx.seeCost && <LinkBtn to={p("/gestao/margem")}>Ver margem</LinkBtn>}
        {inv.status === "autorizada" && <LinkBtn to={p(to("/fiscal/notas/:id/evento", { id: inv.id }))}>Cancelar ou carta de correção</LinkBtn>}
        {ob ? <LinkBtn to={p(to("/estoque/saidas/:id", { id: ob.id }))}>Voltar</LinkBtn> : <LinkBtn to={p("/fiscal/notas")}>Voltar</LinkBtn>}</>} />
      <div className="mb-3 rounded-md border-2 border-amber-400 bg-amber-50 px-3 py-2 text-center text-sm font-bold text-amber-900">{SIMULATED_LABEL.toUpperCase()}</div>
      <Card><KV items={[["Empresa", ctx.db.companies.find((c) => c.id === inv.companyId)?.name], ["Operação", inv.operation], ["Cliente", cust(ctx.db, inv.customerId)], ["Chave (fictícia)", <span key="k" className="break-all font-mono text-xs">{inv.key ?? "—"}</span>], ["Protocolo", protocol(inv)], ["Total", brl(inv.total)], ["Impostos", brl(inv.taxTotal)], ...(margin !== null && inv.status === "autorizada" ? ([["Margem dos itens vendidos", brl(margin)]] as [string, string][]) : [])]} /></Card>
      <Card title="Itens" className="mt-3"><DataTable rows={inv.items} cols={[{ h: "Série", cell: (i) => i.serial ?? "—" }, { h: "Qtd", cell: (i) => i.qty, right: true }, { h: "Valor", cell: (i) => brl(i.unitValue), right: true }, { h: "CFOP", cell: (i) => i.cfop || "—" }, ...(ctx.seeCost ? [{ h: "Custo", cell: (i: Invoice["items"][number]) => brl(ctx.db.serials.find((s) => s.serial === i.serial)?.cost), right: true }] : [])]} /></Card>
      <Card title="Eventos" className="mt-3"><DataTable rows={inv.events} cols={[{ h: "Quando", cell: (e) => dt(e.at) }, { h: "Evento", cell: (e) => e.type }, { h: "Detalhe", cell: (e) => e.reason }, { h: "Por", cell: (e) => ctx.db.profiles.find((x) => x.id === e.by)?.name }]} /></Card>
      <Card title="XML (exemplo, simulado)" className="mt-3"><pre className="max-h-48 overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100">{xml}</pre></Card>
    </>
  );
}

// ---- K04 ----
function K04() {
  const ctx = useCtx();
  const { id } = useParams();
  const act = useAct();
  const [type, setType] = useState<"cancelamento" | "carta_correcao">("cancelamento");
  const [reason, setReason] = useState("");
  const inv = ctx.db.invoices.find((i) => i.id === id && ctx.companyIds.includes(i.companyId));
  if (!inv) return <Empty text="Nota não encontrada." />;
  const ob = ctx.db.outbounds.find((o) => o.invoiceId === inv.id);
  return (
    <>
      <PageHeader code="K04" title="Cancelar ou corrigir nota" subtitle="Cancelar nota que baixou estoque estorna a saída (decisão registrada). O prazo legal de cancelamento deve ser conferido com o Fiscal: o sistema ainda não o valida." />
      {SIMULATED_BANNER}
      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tipo do evento"><Select value={type} onChange={(e) => setType(e.target.value as typeof type)}><option value="cancelamento">Cancelamento</option><option value="carta_correcao">Carta de correção</option></Select></Field>
        </div>
        <Field label={`Motivo (mínimo de 15 caracteres) — ${reason.trim().length}/15`} className="mt-3"><Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="mt-4 flex gap-2">
          <ConfirmButton variant="danger" label="Confirmar" message={type === "cancelamento" && ob ? "Cancelar a nota estorna a saída de estoque desta nota." : "Registrar o evento na nota?"} disabled={ctx.readOnly || reason.trim().length < 15} onConfirm={() => act((db) => { invoiceEvent(db, inv.id, type, reason, ctx.user.id); if (type === "cancelamento" && ob && (ob.status === "nota_autorizada" || ob.status === "enviada")) cancelOutboundAfterInvoiceCancel(db, ob.id, ctx.user.id); audit(db, ctx.user.id, `nota.${type}`, inv.id, inv.companyId, reason); }, { ok: "Evento registrado.", go: p(to("/fiscal/notas/:id", { id: inv.id })) })} />
          <LinkBtn to={p(to("/fiscal/notas/:id", { id: inv.id }))}>Voltar</LinkBtn>
        </div>
      </Card>
    </>
  );
}

// ---- K05 ----
function K05() {
  const ctx = useCtx();
  const act = useAct();
  const nav = useNavigate();
  const [f, setF] = useState({ series: "1", from: "", to: "", reason: "" });
  return (
    <>
      <PageHeader code="K05" title="Inutilização" subtitle="Só números não usados. Justificativa obrigatória." />
      <Card>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Série"><Input value={f.series} onChange={(e) => setF({ ...f, series: e.target.value })} /></Field>
          <Field label="Número inicial"><Input type="number" min={1} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
          <Field label="Número final"><Input type="number" min={1} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
        </div>
        <Field label="Justificativa" className="mt-3"><Textarea rows={2} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        <div className="mt-4 flex gap-2"><Btn disabled={ctx.readOnly || !ctx.company} onClick={() => act((db) => inutilize(db, ctx.company!.id, Number(f.from), Number(f.to), f.reason, ctx.user.id), { ok: "Faixa inutilizada (simulado).", go: p("/fiscal/notas") })}>Inutilizar</Btn><Btn variant="secondary" onClick={() => nav(p("/fiscal/notas"))}>Cancelar</Btn></div>
      </Card>
    </>
  );
}

export const screens: Record<string, ComponentType> = { K01, K02, K03, K04, K05 };
