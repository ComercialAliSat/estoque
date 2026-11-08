import { useEffect, useState, type ComponentType } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Badge, Btn, Card, ConfirmButton, DataTable, Empty, ExportBar, Field, Input, KV, LinkBtn, Modal, PageHeader, ReadOnlyBanner,
  Select, StatusBadge, Textarea, useAct, useToast, type Col,
} from "../components/ui";
import { findSerial, normalizeCode } from "../domain/core";
import { suggestTaxType } from "../domain/fiscal";
import {
  createTransfer, decideLoss, editTransferValue, receiveTransfer, requestLoss, reviewTransfer, sendTransfer,
} from "../domain/logistics";
import { resolveScan } from "../domain/mothercode";
import {
  addOutboundSerial, createOutbound, createReturn, registerShipping, removeOutboundSerial, reviewOutbound, triageReturn,
} from "../domain/sales";
import { openAssist } from "../domain/logistics";
import type { Db, Outbound, OutboundKind } from "../domain/types";
import { brl, dt } from "../format";
import { takePending } from "../leitura";
import { p, to } from "../routes";
import { useCtx } from "../session";

const custName = (db: Db, id?: string) => db.customers.find((c) => c.id === id)?.name ?? "—";
const invOf = (db: Db, o: Outbound) => db.invoices.find((i) => i.id === o.invoiceId);
const NF = () => <Empty text="Registro não encontrado nesta empresa." action={<LinkBtn to={p("/estoque/saidas")}>Voltar</LinkBtn>} />;
const KIND_LABEL: Record<OutboundKind, string> = { venda: "Venda", comodato: "Comodato", transferencia: "Transferência", perda: "Perda", os: "Saída para OS", devolucao_fornecedor: "Devolução a fornecedor" };

// ---- G01 ----
function G01() {
  const ctx = useCtx();
  const [st, setSt] = useState("");
  const rows = ctx.db.outbounds.filter((o) => ctx.companyIds.includes(o.companyId) && (!st || (invOf(ctx.db, o)?.status ?? "sem nota") === st));
  const cols: Col<Outbound>[] = [
    { h: "Saída", cell: (o) => o.number, export: (o) => o.number }, { h: "Tipo", cell: (o) => KIND_LABEL[o.kind], export: (o) => o.kind },
    { h: "Cliente / destino", cell: (o) => custName(ctx.db, o.customerId), export: (o) => custName(ctx.db, o.customerId) },
    { h: "Situação", cell: (o) => <StatusBadge s={o.status} />, export: (o) => o.status },
    { h: "Situação da nota", cell: (o) => <StatusBadge s={invOf(ctx.db, o)?.status ?? "sem nota"} />, export: (o) => invOf(ctx.db, o)?.status ?? "sem nota" },
    { h: "Séries", cell: (o) => o.serials.length, right: true, export: (o) => o.serials.length },
  ];
  return (
    <>
      <PageHeader code="G01" title="Saídas" subtitle="A situação da nota fica sempre visível e filtrável (RN-019)." actions={<><ExportBar name="saidas" rows={rows} cols={cols} />{!ctx.readOnly && ctx.can("estoque", "criar") && <LinkBtn variant="primary" to={p("/estoque/saidas/nova")}>Nova saída</LinkBtn>}</>} />
      {ctx.readOnly && <ReadOnlyBanner />}
      <div className="mb-3"><Select className="max-w-56" value={st} onChange={(e) => setSt(e.target.value)}><option value="">Todas as notas</option>{["sem nota", "rascunho", "autorizada", "com_erro", "nao_transmitida", "cancelada"].map((s) => <option key={s}>{s}</option>)}</Select></div>
      <DataTable rows={rows} cols={cols} onRow={(o) => p(to("/estoque/saidas/:id", { id: o.id }))} empty={<Empty text="Nenhuma saída." action={<LinkBtn variant="primary" to={p("/estoque/saidas/nova")}>Nova saída</LinkBtn>} />} />
    </>
  );
}

// ---- G02 ----
function G02() {
  const ctx = useCtx();
  const act = useAct();
  const nav = useNavigate();
  const [f, setF] = useState({ kind: "venda" as OutboundKind, customerId: "", reservationId: "", contractId: "", taxTypeId: "" });
  const company = ctx.company;
  const customers = ctx.db.customers.filter((c) => company && c.companyIds.includes(company.id));
  const reservations = ctx.db.reservations.filter((r) => company && r.companyId === company.id && r.status === "reservada");
  const contracts = ctx.db.contracts.filter((c) => company && c.companyId === company.id && c.status === "ativo");
  const op = f.kind === "comodato" ? "comodato" : f.kind === "venda" ? "venda" : f.kind === "devolucao_fornecedor" ? "devolucao" : f.kind === "transferencia" ? "transferencia" : "remessa";
  const suggested = company ? suggestTaxType(ctx.db, { companyId: company.id, operation: op, customerId: f.customerId }) : undefined;
  const taxTypes = ctx.db.taxTypes.filter((t) => company && t.companyId === company.id && t.active);
  const taxId = f.taxTypeId || suggested?.id || "";
  const needsCustomer = f.kind === "venda" || f.kind === "comodato";
  return (
    <>
      <PageHeader code="G02" title="Nova saída" />
      {ctx.readOnly && <ReadOnlyBanner />}
      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tipo"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as OutboundKind })}>{(["venda", "comodato", "devolucao_fornecedor", "os"] as OutboundKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</Select></Field>
          <Field label="Empresa"><Input disabled value={company?.name ?? "—"} /></Field>
          <Field label="Cliente"><Select value={f.customerId} onChange={(e) => setF({ ...f, customerId: e.target.value })}><option value="">{needsCustomer ? "Escolha…" : "(opcional)"}</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Origem: reserva do CRM"><Select value={f.reservationId} onChange={(e) => setF({ ...f, reservationId: e.target.value })}><option value="">Sem reserva</option>{reservations.map((r) => <option key={r.id} value={r.id}>{r.id} · {r.serials.length} série(s)</option>)}</Select></Field>
          {f.kind === "comodato" && <Field label="Contrato"><Select value={f.contractId} onChange={(e) => setF({ ...f, contractId: e.target.value })}><option value="">Escolha…</option>{contracts.map((c) => <option key={c.id} value={c.id}>{c.number} · {custName(ctx.db, c.customerId)}</option>)}</Select></Field>}
          <Field label="Tipo de tributação sugerido" hint={suggested ? "Sugestão pela regra mais específica (RN-017)." : "Nenhuma regra encontrada: escolha ou crie em C12."}><Select value={taxId} onChange={(e) => setF({ ...f, taxTypeId: e.target.value })}><option value="">—</option>{taxTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
        </div>
        {f.kind === "venda" && !f.reservationId && <p className="mt-3 rounded bg-amber-50 p-2 text-sm text-amber-900">Venda sem reserva do CRM: confira se o negócio foi ganho e reservado antes de seguir.</p>}
        <div className="mt-4 flex gap-2">
          <Btn disabled={ctx.readOnly || !company || !ctx.can("estoque", "criar")} onClick={() => act((db) => {
            const o = createOutbound(db, { companyId: company!.id, kind: f.kind, customerId: f.customerId || undefined, contractId: f.contractId || undefined, reservationId: f.reservationId || undefined, taxTypeId: taxId || undefined }, ctx.user.id);
            return o;
          }, { ok: "Saída criada.", go: (o) => p(to("/estoque/saidas/:id/separar", { id: o.id })) })}>Continuar</Btn>
          <Btn variant="secondary" onClick={() => nav(p("/estoque/saidas"))}>Cancelar</Btn>
        </div>
      </Card>
    </>
  );
}

// ---- G03 ----
function G03() {
  const ctx = useCtx();
  const { id } = useParams();
  const act = useAct();
  const toast = useToast();
  const nav = useNavigate();
  const [val, setVal] = useState("");
  const [value, setValue] = useState("");
  const o = ctx.db.outbounds.find((x) => x.id === id && ctx.companyIds.includes(x.companyId));
  useEffect(() => {
    const pend = takePending("saida");
    if (pend && o) {
      const failed: string[] = [];
      for (const s of pend.serials) {
        const r = act((db) => addOutboundSerial(db, o.id, s, 0));
        if (!r.ok) failed.push(s);
      }
      if (pend.serials.length) toast.ok(`${pend.serials.length - failed.length} série(s) vindas do leitor universal.`);
    }
   
  }, []);
  if (!o) return <NF />;
  const add = (raw: string) => {
    const r = resolveScan(ctx.db, raw, "saida", o.companyId, o.serials);
    if (r.kind === "desconhecido") return toast.err(r.issues[0].message);
    if (r.kind === "codigo_mae") {
      const blocking = r.issues.filter((i) => !i.serial);
      if (blocking.length) return toast.err(blocking[0].message);
      const bad = r.issues.filter((i) => i.serial && !i.message.includes("releitura"));
      if (bad.length) return toast.err(`Código-mãe com série não elegível (${bad[0].serial}: ${bad[0].message}). Nada foi aplicado.`);
      act((db) => { for (const s of r.serials) if (!db.outbounds.find((x) => x.id === o.id)!.serials.includes(s)) addOutboundSerial(db, o.id, s, Number(value) || 0); }, { ok: `${r.serials.length} série(s) do código-mãe.` });
    } else act((db) => addOutboundSerial(db, o.id, raw, Number(value) || 0));
    setVal("");
  };
  const editable = o.status === "rascunho" || o.status === "separada";
  return (
    <>
      <PageHeader code="G03" title={`Separação ${o.number}`} subtitle="Série reservada a outra operação, em outro local, em quarentena ou de outra empresa é recusada." actions={<LinkBtn to={p(`/leitura?modo=saida&voltar=${encodeURIComponent(p(to("/estoque/saidas/:id/separar", { id: o.id })))}`)}>Leitor universal</LinkBtn>} />
      <Card>
        <form onSubmit={(e) => { e.preventDefault(); add(val); }} className="flex flex-wrap gap-2">
          <Input autoFocus className="max-w-sm font-mono" placeholder="Leia a série ou o código-mãe" value={val} onChange={(e) => setVal(e.target.value)} disabled={!editable} aria-label="Campo de leitura" />
          {o.kind === "venda" && <Input className="w-36" type="number" min={0} step="0.01" placeholder="Valor unitário" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Valor unitário" />}
          <Btn type="submit" disabled={!editable}>Adicionar</Btn>
        </form>
        <div className="mt-3">
          <DataTable rows={o.serials} cols={[
            { h: "Série", cell: (s) => s }, { h: "Produto", cell: (s) => ctx.db.products.find((x) => x.id === findSerial(ctx.db, s)?.productId)?.name },
            { h: "Local", cell: (s) => ctx.db.locations.find((l) => l.id === findSerial(ctx.db, s)?.locationId)?.name }, { h: "Valor", cell: (s) => brl(o.unitValue[s] ?? 0), right: true },
            { h: "", cell: (s) => editable ? <Btn variant="ghost" onClick={() => { act((db) => removeOutboundSerial(db, o.id, s)); }}>Trocar / remover</Btn> : null },
          ]} empty={<p className="text-sm text-slate-500">Nenhuma série separada.</p>} />
        </div>
        <div className="mt-4 flex gap-2">
          <Btn disabled={!editable || ctx.readOnly} onClick={() => act((db) => reviewOutbound(db, o.id), { go: p(to("/estoque/saidas/:id/revisar", { id: o.id })) })}>Revisar</Btn>
          <Btn variant="secondary" onClick={() => nav(p("/estoque/saidas"))}>Salvar rascunho</Btn>
        </div>
      </Card>
    </>
  );
}

// ---- G04 ----
function G04() {
  const ctx = useCtx();
  const { id } = useParams();
  const act = useAct();
  const o = ctx.db.outbounds.find((x) => x.id === id && ctx.companyIds.includes(x.companyId));
  if (!o) return <NF />;
  const tt = ctx.db.taxTypes.find((t) => t.id === o.taxTypeId);
  const total = o.serials.reduce((a, s) => a + (o.unitValue[s] ?? 0), 0);
  return (
    <>
      <PageHeader code="G04" title={`Revisão ${o.number}`} subtitle="O estoque só baixa com a nota autorizada (RN-015)." />
      <Card>
        <KV items={[["Tipo", KIND_LABEL[o.kind]], ["Destino", custName(ctx.db, o.customerId)], ["Tipo de tributação", tt?.name ?? "— (sem regra)"], ["CFOP", tt?.cfop || "—"], ["Valor total", brl(total)], ["Séries", o.serials.length]]} />
        <div className="mt-3"><DataTable rows={o.serials} cols={[{ h: "Série", cell: (s) => s }, { h: "Valor", cell: (s) => brl(o.unitValue[s] ?? 0), right: true }]} /></div>
        <p className="mt-2 text-xs text-slate-500">Exceção para saída sem nota (mesma empresa): ponto em aberto em B04; padrão = exige nota.</p>
        <div className="mt-4 flex gap-2">
          <Btn disabled={ctx.readOnly || o.status === "nota_autorizada" || o.status === "enviada"} onClick={() => act((db) => { const x = db.outbounds.find((y) => y.id === o.id)!; if (x.status === "rascunho") reviewOutbound(db, x.id); }, { go: p(`/fiscal/notas/emitir?saida=${o.id}`) })}>Seguir para a nota</Btn>
          <LinkBtn to={p(to("/estoque/saidas/:id/separar", { id: o.id }))}>Corrigir</LinkBtn>
        </div>
      </Card>
    </>
  );
}

// ---- G05 ----
function G05() {
  const ctx = useCtx();
  const { id } = useParams();
  const act = useAct();
  const [ship, setShip] = useState<{ carrier: string; tracking: string } | null>(null);
  const o = ctx.db.outbounds.find((x) => x.id === id && ctx.companyIds.includes(x.companyId));
  if (!o) return <NF />;
  const inv = invOf(ctx.db, o);
  return (
    <>
      <PageHeader code="G05" title={`Saída ${o.number}`} subtitle={<><StatusBadge s={o.status} /> {inv && <> · nota <StatusBadge s={inv.status} /></>}</>} actions={<>
        {inv && <LinkBtn to={p(to("/fiscal/notas/:id", { id: inv.id }))}>Nota</LinkBtn>}
        {o.workOrderId && <LinkBtn to={p(to("/os/:id", { id: o.workOrderId }))}>OS</LinkBtn>}
        <Btn variant="secondary" onClick={() => window.print()}>Imprimir romaneio</Btn>
        {o.status === "nota_autorizada" && <Btn onClick={() => setShip({ carrier: "", tracking: "" })} disabled={ctx.readOnly}>Registrar envio</Btn>}
        {(o.status === "rascunho" || o.status === "separada") && <LinkBtn variant="primary" to={p(to("/estoque/saidas/:id/separar", { id: o.id }))}>Continuar separação</LinkBtn>}
        {o.status === "aguardando_nota" && <LinkBtn variant="primary" to={p(`/fiscal/notas/emitir?saida=${o.id}`)}>Ir para a nota</LinkBtn>}</>} />
      {o.status === "aguardando_nota" && <div className="mb-3 rounded bg-amber-50 p-2 text-sm text-amber-900">Aguardando nota: o estoque ainda não baixou e o envio só pode ser registrado depois da nota autorizada.</div>}
      <Card><KV items={[["Tipo", KIND_LABEL[o.kind]], ["Cliente", custName(ctx.db, o.customerId)], ["Envio", o.shipping ? `${o.shipping.carrier} · ${o.shipping.tracking || "sem rastreio"}` : "—"], ["Criada em", dt(o.createdAt)]]} /></Card>
      <Card title="Séries" className="mt-3"><DataTable rows={o.serials} cols={[{ h: "Série", cell: (s) => s }, { h: "Valor", cell: (s) => brl(o.unitValue[s] ?? 0), right: true }]} onRow={(s) => p(to("/estoque/equipamentos/:id", { id: findSerial(ctx.db, s)?.id ?? "" }))} /></Card>
      {ship && (
        <Modal title="Registrar envio" onClose={() => setShip(null)}>
          <Field label="Transportadora (ex.: Correios)"><Input value={ship.carrier} onChange={(e) => setShip({ ...ship, carrier: e.target.value })} /></Field>
          <Field label="Código de rastreio" className="mt-2"><Input value={ship.tracking} onChange={(e) => setShip({ ...ship, tracking: e.target.value })} /></Field>
          <div className="mt-3 flex justify-end gap-2"><Btn variant="secondary" onClick={() => setShip(null)}>Cancelar</Btn><Btn onClick={() => { const r = act((db) => registerShipping(db, o.id, ship.carrier, ship.tracking), { ok: "Envio registrado." }); if (r.ok) setShip(null); }}>Salvar</Btn></div>
        </Modal>
      )}
    </>
  );
}

// ---- G06 ----
function G06() {
  const ctx = useCtx();
  const rows = ctx.db.returns.filter((r) => ctx.companyIds.includes(r.companyId));
  return (
    <>
      <PageHeader code="G06" title="Devoluções" actions={!ctx.readOnly && ctx.can("estoque", "criar") ? <LinkBtn variant="primary" to={p("/estoque/devolucoes/nova")}>Nova devolução</LinkBtn> : undefined} />
      <DataTable rows={rows} cols={[{ h: "Origem", cell: (r) => r.origin }, { h: "Cliente", cell: (r) => custName(ctx.db, r.customerId) }, { h: "Séries", cell: (r) => r.serials.length, right: true }, { h: "Situação", cell: (r) => <StatusBadge s={r.status} /> }, { h: "Quando", cell: (r) => dt(r.createdAt) }]} onRow={(r) => p(to("/estoque/devolucoes/:id", { id: r.id }))} empty={<Empty text="Nenhuma devolução." />} />
    </>
  );
}

// ---- G07 ----
function G07() {
  const ctx = useCtx();
  const nav = useNavigate();
  const toast = useToast();
  const prev = (useLocation().state ?? {}) as { origin?: "cliente" | "comodato" | "fornecedor"; customerId?: string; serials?: string[] };
  const [origin, setOrigin] = useState(prev.origin ?? "cliente");
  const [customerId, setCustomer] = useState(prev.customerId ?? "");
  const [serials, setSerials] = useState<string[]>(prev.serials ?? []);
  const [val, setVal] = useState("");
  const add = () => {
    const c = normalizeCode(val);
    if (!c) return;
    if (!findSerial(ctx.db, c)) return toast.err(`Série ${c} não encontrada.`);
    if (serials.includes(c)) return toast.err("Série já lida.");
    if (origin !== "fornecedor") {
      const left = ctx.db.outbounds.some((o) => o.customerId === customerId && o.serials.includes(c) && (o.status === "nota_autorizada" || o.status === "enviada"));
      if (!left) return toast.err(`Série ${c} não saiu para este cliente.`);
    }
    setSerials([...serials, c]); setVal("");
  };
  const customers = ctx.db.customers.filter((c) => ctx.company && c.companyIds.includes(ctx.company.id));
  return (
    <>
      <PageHeader code="G07" title="Nova devolução" subtitle="A série precisa ter saído para aquele cliente. Devolução ao fornecedor exige nota (K02)." />
      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Origem"><Select value={origin} onChange={(e) => setOrigin(e.target.value as typeof origin)}><option value="cliente">Devolução de cliente</option><option value="comodato">Retorno de comodato</option><option value="fornecedor">Devolução ao fornecedor</option></Select></Field>
          {origin !== "fornecedor" && <Field label="Cliente"><Select value={customerId} onChange={(e) => setCustomer(e.target.value)}><option value="">Escolha…</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>}
        </div>
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}><Input className="max-w-sm font-mono" placeholder="Leia a série" value={val} onChange={(e) => setVal(e.target.value)} /><Btn type="submit">Ler</Btn></form>
        <ul className="mt-2 flex flex-wrap gap-2">{serials.map((s) => <li key={s}><Badge tone="blue">{s} <button className="ml-1" aria-label={`Remover ${s}`} onClick={() => setSerials(serials.filter((x) => x !== s))}>✕</button></Badge></li>)}</ul>
        <div className="mt-4 flex gap-2">
          <Btn disabled={serials.length === 0 || (origin !== "fornecedor" && !customerId) || ctx.readOnly} onClick={() => nav(p("/estoque/devolucoes/revisar"), { state: { origin, customerId, serials } })}>Continuar</Btn>
          <Btn variant="secondary" onClick={() => nav(p("/estoque/devolucoes"))}>Cancelar</Btn>
        </div>
      </Card>
    </>
  );
}

// ---- G08 ----
function G08() {
  const ctx = useCtx();
  const act = useAct();
  const nav = useNavigate();
  const st = (useLocation().state ?? {}) as { origin?: "cliente" | "comodato" | "fornecedor"; customerId?: string; serials?: string[] };
  const [reason, setReason] = useState("");
  if (!st.serials || !ctx.company) return <Empty text="Nenhuma devolução em andamento." action={<LinkBtn to={p("/estoque/devolucoes/nova")}>Nova devolução</LinkBtn>} />;
  return (
    <>
      <PageHeader code="G08" title="Revisão da devolução" subtitle="O item sempre volta pela quarentena." />
      <Card>
        <KV items={[["Origem", st.origin], ["Cliente", custName(ctx.db, st.customerId)], ["Séries", st.serials.join(", ")], ["Destino", "Quarentena"]]} />
        <Field label="Motivo (obrigatório)" className="mt-3"><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <div className="mt-4 flex flex-wrap gap-2">
          <Btn disabled={!reason.trim() || ctx.readOnly} onClick={() => act((db) => createReturn(db, { companyId: ctx.company!.id, origin: st.origin!, customerId: st.customerId, serials: st.serials!, reason }, ctx.user.id), { ok: "Devolução registrada, itens em quarentena.", go: (r) => p(to("/estoque/devolucoes/:id", { id: r.id })) })}>Confirmar</Btn>
          <LinkBtn to={p("/fiscal/notas/emitir")}>Emitir nota de devolução</LinkBtn>
          <Btn variant="secondary" onClick={() => nav(p("/estoque/devolucoes/nova"), { state: st })}>Voltar</Btn>
        </div>
      </Card>
    </>
  );
}

// ---- G09 ----
function G09() {
  const ctx = useCtx();
  const { id } = useParams();
  const act = useAct();
  const nav = useNavigate();
  const r = ctx.db.returns.find((x) => x.id === id && ctx.companyIds.includes(x.companyId));
  if (!r) return <NF />;
  const open = r.status === "triagem";
  return (
    <>
      <PageHeader code="G09" title="Triagem da devolução" subtitle={<StatusBadge s={r.status} />} />
      <Card><KV items={[["Origem", r.origin], ["Cliente", custName(ctx.db, r.customerId)], ["Motivo", r.reason], ["Quando", dt(r.createdAt)]]} /></Card>
      <Card title="Séries em triagem" className="mt-3"><DataTable rows={r.serials} cols={[{ h: "Série", cell: (s) => s }, { h: "Condição técnica", cell: (s) => <StatusBadge s={findSerial(ctx.db, s)?.technical ?? ""} /> }]} onRow={(s) => p(to("/estoque/equipamentos/:id", { id: findSerial(ctx.db, s)?.id ?? "" }))} /></Card>
      <div className="mt-4 flex flex-wrap gap-2">
        <ConfirmButton variant="primary" label="Liberar para estoque" disabled={!open || ctx.readOnly} message="Só libere depois da inspeção. As séries voltam a ficar disponíveis." onConfirm={() => act((db) => triageReturn(db, r.id, "liberar", ctx.user.id), { ok: "Liberado para o estoque.", go: p(to("/estoque/equipamentos/:id", { id: findSerial(ctx.db, r.serials[0])?.id ?? "" })) })} />
        <Btn variant="secondary" disabled={!open || ctx.readOnly} onClick={() => act((db) => { r.serials.forEach((s) => openAssist(db, { companyId: r.companyId, serial: s, defect: `Devolução: ${r.reason}` }, ctx.user.id)); triageReturn(db, r.id, "assistencia", ctx.user.id); }, { ok: "Enviado para assistência.", go: p("/assistencia") })}>Enviar para assistência</Btn>
        <Btn variant="danger" disabled={!open || ctx.readOnly} onClick={() => nav(p("/estoque/perdas"), { state: { serials: r.serials, reason: `Devolução sem recuperação: ${r.reason}` } })}>Dar baixa por perda</Btn>
      </div>
    </>
  );
}

// ---- G10 ----
function G10() {
  const ctx = useCtx();
  const rows = ctx.db.transfers.filter((t) => ctx.companyIds.includes(t.companyId));
  const lname = (id: string) => ctx.db.locations.find((l) => l.id === id)?.name ?? "—";
  return (
    <>
      <PageHeader code="G10" title="Transferências" actions={<><LinkBtn to={p("/estoque/transferencias/transito")}>Em trânsito</LinkBtn>{!ctx.readOnly && ctx.can("estoque", "criar") && <LinkBtn variant="primary" to={p("/estoque/transferencias/nova")}>Nova transferência</LinkBtn>}</>} />
      <DataTable rows={rows} cols={[{ h: "Tipo", cell: (t) => t.kind.replace(/_/g, " ") }, { h: "Origem", cell: (t) => lname(t.fromLocationId) }, { h: "Destino", cell: (t) => lname(t.toLocationId) }, { h: "Séries", cell: (t) => t.serials.length, right: true }, { h: "Situação", cell: (t) => <StatusBadge s={t.status} /> }]} onRow={(t) => p(to(t.status === "rascunho" ? "/estoque/transferencias/:id/revisar" : "/estoque/transferencias/:id", { id: t.id }))} empty={<Empty text="Nenhuma transferência." />} />
    </>
  );
}

// ---- G11 ----
function G11() {
  const ctx = useCtx();
  const act = useAct();
  const toast = useToast();
  const [f, setF] = useState({ kind: "entre_locais" as "entre_locais" | "entre_empresas" | "tecnico_terceiro", from: "", to: "", toCompany: "" });
  const [serials, setSerials] = useState<string[]>([]);
  const [val, setVal] = useState("");
  useEffect(() => {
    const pend = takePending("transferencia");
    if (pend) setSerials((s) => [...new Set([...s, ...pend.serials])]);
  }, []);
  const mine = ctx.db.locations.filter((l) => ctx.company && l.companyId === ctx.company.id && l.active);
  const dests = f.kind === "entre_empresas" ? ctx.db.locations.filter((l) => l.companyId === f.toCompany && l.active) : f.kind === "tecnico_terceiro" ? mine.filter((l) => l.type === "tecnico") : mine;
  const add = () => {
    const r = resolveScan(ctx.db, val, "transferencia", ctx.company?.id ?? "", serials);
    if (r.kind === "desconhecido") return toast.err(r.issues[0].message);
    const bad = r.issues.filter((i) => !i.message.includes("releitura"));
    if (bad.length) return toast.err(bad[0].message);
    setSerials([...new Set([...serials, ...r.serials])]); setVal("");
  };
  return (
    <>
      <PageHeader code="G11" title="Nova transferência" subtitle="Entre empresas é operação fiscal própria. Suporte N2 registra o envio ao técnico N3. Item reservado é bloqueado." actions={<LinkBtn to={p(`/leitura?modo=transferencia&voltar=${encodeURIComponent(p("/estoque/transferencias/nova"))}`)}>Leitor universal</LinkBtn>} />
      {ctx.readOnly && <ReadOnlyBanner />}
      <Card>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Tipo"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as typeof f.kind, to: "" })}><option value="entre_locais">Entre locais</option><option value="entre_empresas">Entre empresas</option><option value="tecnico_terceiro">Para técnico terceiro</option></Select></Field>
          <Field label="Origem"><Select value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })}><option value="">Escolha…</option>{mine.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
          {f.kind === "entre_empresas" && <Field label="Empresa de destino"><Select value={f.toCompany} onChange={(e) => setF({ ...f, toCompany: e.target.value, to: "" })}><option value="">Escolha…</option>{ctx.db.companies.filter((c) => c.id !== ctx.company?.id && ctx.user.companyIds.includes(c.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>}
          <Field label="Destino"><Select value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })}><option value="">Escolha…</option>{dests.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
        </div>
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}><Input className="max-w-sm font-mono" placeholder="Leia a série ou código-mãe" value={val} onChange={(e) => setVal(e.target.value)} /><Btn type="submit">Ler</Btn></form>
        <ul className="mt-2 flex flex-wrap gap-2">{serials.map((s) => <li key={s}><Badge tone="blue">{s} <button aria-label={`Remover ${s}`} onClick={() => setSerials(serials.filter((x) => x !== s))}>✕</button></Badge></li>)}</ul>
        <div className="mt-4 flex gap-2">
          <Btn disabled={ctx.readOnly || !f.from || !f.to || serials.length === 0} onClick={() => act((db) => createTransfer(db, { companyId: ctx.company!.id, kind: f.kind, fromLocationId: f.from, toLocationId: f.to, toCompanyId: f.toCompany || undefined, serials }, ctx.user.id), { ok: "Transferência criada.", go: (t) => p(to("/estoque/transferencias/:id/revisar", { id: t.id })) })}>Continuar</Btn>
          <LinkBtn to={p("/estoque/transferencias")}>Cancelar</LinkBtn>
        </div>
      </Card>
    </>
  );
}

// ---- G12 ----
function G12() {
  const ctx = useCtx();
  const { id } = useParams();
  const act = useAct();
  const t = ctx.db.transfers.find((x) => x.id === id && ctx.companyIds.includes(x.companyId));
  const [edit, setEdit] = useState<Record<string, string>>({});
  if (!t) return <Empty text="Transferência não encontrada." action={<LinkBtn to={p("/estoque/transferencias")}>Voltar</LinkBtn>} />;
  const needsInvoice = t.kind === "entre_empresas" || (t.kind === "entre_locais" && ctx.db.params.transferSameCompanyNeedsInvoice);
  const lname = (x: string) => ctx.db.locations.find((l) => l.id === x)?.name;
  return (
    <>
      <PageHeader code="G12" title="Revisão da transferência" subtitle="O valor é editável por usuário autorizado (RN-013) e registra quem e quando." />
      <Card>
        <KV items={[["Tipo", t.kind.replace(/_/g, " ")], ["Origem", lname(t.fromLocationId)], ["Destino", lname(t.toLocationId)], ["Documento exigido", needsInvoice ? "Nota de transferência (simulada)" : "Nenhum (mesma empresa; parâmetro em N11)"]]} />
        <div className="mt-3"><DataTable rows={t.serials} cols={[{ h: "Série", cell: (s) => s }, { h: "Valor de transferência", right: true, cell: (s) => <span className="flex justify-end gap-1"><Input type="number" min={0} step="0.01" className="w-32 text-right" value={edit[s] ?? t.transferValue[s] ?? 0} onChange={(e) => setEdit({ ...edit, [s]: e.target.value })} disabled={t.status !== "rascunho" && t.status !== "revisada"} /><Btn variant="ghost" disabled={edit[s] === undefined} onClick={() => act((db) => editTransferValue(db, t.id, s, Number(edit[s]), ctx.user.id), { ok: "Valor atualizado." })}>OK</Btn></span> }]} /></div>
        <div className="mt-4 flex gap-2">
          {t.status === "rascunho" && <Btn onClick={() => act((db) => reviewTransfer(db, t.id), { ok: "Revisada." })} disabled={ctx.readOnly}>Marcar como revisada</Btn>}
          {t.status === "revisada" && needsInvoice && <LinkBtn variant="primary" to={p(`/fiscal/notas/emitir?transferencia=${t.id}`)}>Confirmar saída (seguir para a nota)</LinkBtn>}
          {t.status === "revisada" && !needsInvoice && <Btn variant="primary" disabled={ctx.readOnly} onClick={() => act((db) => sendTransfer(db, t.id, ctx.user.id), { ok: "Saída confirmada.", go: p("/estoque/transferencias/transito") })}>Confirmar saída</Btn>}
          <LinkBtn to={p("/estoque/transferencias/nova")}>Voltar</LinkBtn>
        </div>
      </Card>
    </>
  );
}
// ---- G13 ----
function G13() {
  const ctx = useCtx();
  const { id } = useParams();
  const act = useAct();
  const toast = useToast();
  const nav = useNavigate();
  const [recv, setRecv] = useState<{ id: string; read: string[] } | null>(null);
  const [val, setVal] = useState("");
  const overdue = (t: { sentAt?: string }) => !!t.sentAt && (Date.now() - new Date(t.sentAt).getTime()) / 86400000 > ctx.db.params.transitDays;
  const lname = (x: string) => ctx.db.locations.find((l) => l.id === x)?.name;
  useEffect(() => {
    const pend = takePending("transferencia");
    if (pend && recv) setRecv({ ...recv, read: [...new Set([...recv.read, ...pend.serials])] });
   
  }, []);
  if (id) {
    const t = ctx.db.transfers.find((x) => x.id === id && ctx.companyIds.includes(x.companyId));
    if (!t) return <Empty text="Transferência não encontrada." />;
    return (
      <>
        <PageHeader code="G13" title="Detalhe da transferência" subtitle={<StatusBadge s={t.status} />} actions={<LinkBtn to={p("/estoque/transferencias")}>Voltar</LinkBtn>} />
        <Card><KV items={[["Origem", lname(t.fromLocationId)], ["Destino", lname(t.toLocationId)], ["Enviada em", dt(t.sentAt)], ["Recebida em", dt(t.receivedAt)], ["Nota", t.invoiceId ? "Sim" : "—"]]} /></Card>
        <Card title="Séries" className="mt-3"><DataTable rows={t.serials} cols={[{ h: "Série", cell: (s) => s }, { h: "Situação", cell: (s) => <StatusBadge s={findSerial(ctx.db, s)?.commercial ?? ""} /> }]} /></Card>
        {t.invoiceId && <div className="mt-3"><LinkBtn to={p(to("/fiscal/notas/:id", { id: t.invoiceId }))}>Ver nota</LinkBtn></div>}
      </>
    );
  }
  const rows = ctx.db.transfers.filter((t) => ctx.companyIds.includes(t.companyId) && t.status === "em_transito");
  return (
    <>
      <PageHeader code="G13" title="Em trânsito e recebimento" subtitle="Saída não presume entrega. Atraso em trânsito gera aviso." />
      <DataTable rows={rows} cols={[
        { h: "Origem", cell: (t) => lname(t.fromLocationId) }, { h: "Destino", cell: (t) => lname(t.toLocationId) }, { h: "Séries", cell: (t) => t.serials.length, right: true },
        { h: "Enviada", cell: (t) => <span>{dt(t.sentAt)} {overdue(t) && <Badge tone="red">atrasada</Badge>}</span> },
        { h: "", cell: (t) => <span className="flex gap-1"><Btn disabled={ctx.readOnly} onClick={() => setRecv({ id: t.id, read: [] })}>Receber</Btn><LinkBtn to={p(to("/estoque/transferencias/:id", { id: t.id }))}>Detalhe</LinkBtn></span> },
      ]} empty={<Empty text="Nada em trânsito." />} />
      {recv && (() => {
        const t = ctx.db.transfers.find((x) => x.id === recv.id)!;
        const add = () => { const c = normalizeCode(val); if (!t.serials.includes(c)) return toast.err(`Série ${c} não faz parte desta transferência.`); setRecv({ ...recv, read: [...new Set([...recv.read, c])] }); setVal(""); };
        const missing = t.serials.filter((s) => !recv.read.includes(s));
        return (
          <Modal title="Receber transferência" onClose={() => setRecv(null)}>
            <form className="mb-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); add(); }}><Input autoFocus className="font-mono" placeholder="Leia as séries" value={val} onChange={(e) => setVal(e.target.value)} /><Btn type="submit">Ler</Btn></form>
            <p className="text-sm">{recv.read.length} de {t.serials.length} lidas. {missing.length > 0 && <span className="text-amber-800">Faltam: {missing.join(", ")} — vira divergência.</span>}</p>
            <div className="mt-3 flex justify-end gap-2"><Btn variant="secondary" onClick={() => setRecv(null)}>Cancelar</Btn>
              <Btn disabled={recv.read.length === 0} onClick={() => { const r = act((db) => receiveTransfer(db, t.id, recv.read, ctx.user.id), { ok: "Recebimento registrado." }); if (r.ok) { setRecv(null); nav(r.value.missing.length ? p("/pendencias") : p("/estoque/transferencias")); } }}>Confirmar recebimento</Btn></div>
          </Modal>
        );
      })()}
    </>
  );
}

// ---- G14 ----
function G14() {
  const ctx = useCtx();
  const act = useAct();
  const pre = (useLocation().state ?? {}) as { serials?: string[]; reason?: string };
  const [f, setF] = useState({ serials: (pre.serials ?? []).join(", "), reason: pre.reason ?? "", evidence: "" });
  const rows = ctx.db.losses.filter((l) => ctx.companyIds.includes(l.companyId));
  return (
    <>
      <PageHeader code="G14" title="Perdas e baixas" subtitle="Não existe saída sem desfecho (RN-011). O ativo não é apagado, muda de situação. Aprovação por administrador." />
      {!ctx.readOnly && ctx.can("estoque", "criar") && (
        <Card title="Solicitar baixa">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Séries (separadas por vírgula)"><Input value={f.serials} onChange={(e) => setF({ ...f, serials: e.target.value })} /></Field>
            <Field label="Motivo"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
            <Field label="Evidência (descrição ou link)"><Input value={f.evidence} onChange={(e) => setF({ ...f, evidence: e.target.value })} /></Field>
          </div>
          <div className="mt-3"><Btn onClick={() => act((db) => requestLoss(db, { companyId: ctx.company!.id, serials: f.serials.split(/[\s,;]+/).filter(Boolean), reason: f.reason, evidence: f.evidence }, ctx.user.id), { ok: "Aguardando aprovação.", then: () => setF({ serials: "", reason: "", evidence: "" }) })}>Solicitar baixa</Btn></div>
        </Card>
      )}
      <Card title="Solicitações" className="mt-3">
        <DataTable rows={rows} cols={[
          { h: "Séries", cell: (l) => l.serials.join(", ") }, { h: "Motivo", cell: (l) => l.reason },
          { h: "Valor", cell: (l) => (ctx.seeCost ? brl(l.value) : "oculto"), right: true },
          { h: "Pedido por", cell: (l) => ctx.db.profiles.find((x) => x.id === l.requestedBy)?.name }, { h: "Situação", cell: (l) => <StatusBadge s={l.status} /> },
          { h: "", cell: (l) => l.status === "pendente" ? <span className="flex gap-1">
            <Btn disabled={!ctx.isAdmin || l.requestedBy === ctx.user.id} title={l.requestedBy === ctx.user.id ? "Quem pede não aprova" : ctx.isAdmin ? "" : "Só administradores aprovam"} onClick={() => act((db) => decideLoss(db, l.id, true, ctx.user.id), { ok: "Baixa aprovada." })}>Aprovar</Btn>
            <Btn variant="danger" disabled={!ctx.isAdmin || l.requestedBy === ctx.user.id} onClick={() => act((db) => decideLoss(db, l.id, false, ctx.user.id), { ok: "Rejeitada: volta ao solicitante." })}>Rejeitar</Btn></span>
            : l.status === "aprovada" ? <LinkBtn to={p(to("/estoque/equipamentos/:id", { id: findSerial(ctx.db, l.serials[0])?.id ?? "" }))}>Ver ficha</LinkBtn> : null },
        ]} empty={<Empty text="Nenhuma solicitação." />} />
        <p className="mt-2 text-xs text-slate-500">Nota de perda (quando exigida pela operação) é emitida em K02. Sem limite de valor para aprovação por enquanto.</p>
      </Card>
    </>
  );
}

export const screens: Record<string, ComponentType> = { G01, G02, G03, G04, G05, G06, G07, G08, G09, G10, G11, G12, G13, G14 };
