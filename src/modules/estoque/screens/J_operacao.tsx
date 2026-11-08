import { useState, type ComponentType } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Badge, Btn, Card, ConfirmButton, DataTable, Empty, Field, Input, KV, LinkBtn, NoPermission, PageHeader, ReadOnlyBanner, ReasonButton,
  Select, StatusBadge, Textarea, useAct, useToast,
} from "../components/ui";
import { atomic, audit, balance, findSerial, normalizeCode, updateSerial } from "../domain/core";
import { addAssignedCost, serviceMargin } from "../domain/costing";
import {
  addChips, buildKitUnit, createLink, createWorkOrder, finalizeWorkOrder, openAssist, sendMaterialsToWO, setWOCosts, startKitOrder,
} from "../domain/logistics";
import { eligibilityProblem, quarantineLocation } from "../domain/sales";
import { parseCsv } from "../domain/sheets";
import type { Db } from "../domain/types";
import { getArgos } from "../integrations/argos";
import { brl, dt } from "../format";
import { p, to } from "../routes";
import { useCtx } from "../session";

const custName = (db: Db, id?: string) => db.customers.find((c) => c.id === id)?.name ?? "—";
const svcName = (db: Db, id: string) => db.services.find((s) => s.id === id)?.name ?? "—";
const prodName = (db: Db, id: string) => db.products.find((x) => x.id === id)?.name ?? "—";
const NF = ({ back = "/os" }: { back?: string }) => <Empty text="Registro não encontrado nesta empresa." action={<LinkBtn to={p(back)}>Voltar</LinkBtn>} />;

function useWO() {
  const ctx = useCtx();
  const { id } = useParams();
  const wo = ctx.db.workOrders.find((o) => o.id === id && ctx.companyIds.includes(o.companyId));
  return { ctx, wo };
}

// ---- J01 ----
function J01() {
  const ctx = useCtx();
  const [st, setSt] = useState("");
  const rows = ctx.db.workOrders.filter((o) => ctx.companyIds.includes(o.companyId) && (!st || o.status === st));
  return (
    <>
      <PageHeader code="J01" title="Ordens de serviço" actions={!ctx.readOnly && ctx.can("operacoes", "criar") ? <LinkBtn variant="primary" to={p("/os/nova")}>Nova OS</LinkBtn> : undefined} />
      <div className="mb-3"><Select className="max-w-52" value={st} onChange={(e) => setSt(e.target.value)}><option value="">Todas</option>{["aberta", "em_execucao", "finalizada", "cancelada"].map((s) => <option key={s}>{s}</option>)}</Select></div>
      <DataTable rows={rows} cols={[{ h: "OS", cell: (o) => o.number }, { h: "Serviço", cell: (o) => svcName(ctx.db, o.serviceId) }, { h: "Cliente", cell: (o) => custName(ctx.db, o.customerId) }, { h: "Placa", cell: (o) => o.plate }, { h: "Técnico", cell: (o) => `${o.technician} (${o.technicianKind})` }, { h: "Origem", cell: (o) => o.origin }, { h: "Situação", cell: (o) => <StatusBadge s={o.status} /> }]} onRow={(o) => p(to("/os/:id", { id: o.id }))} empty={<Empty text="Nenhuma OS." action={<LinkBtn variant="primary" to={p("/os/nova")}>Nova OS</LinkBtn>} />} />
    </>
  );
}

// ---- J02 ----
function J02() {
  const ctx = useCtx();
  const act = useAct();
  const nav = useNavigate();
  const company = ctx.company;
  const [f, setF] = useState({ serviceId: "", customerId: "", plate: "", contractId: "", technician: "", technicianKind: "interno" as "interno" | "terceiro", charged: "", serialsIn: "", date: "" });
  const svc = ctx.db.services.find((s) => s.id === f.serviceId);
  const needsSerial = svc?.kind === "retirada" || svc?.kind === "troca";
  return (
    <>
      <PageHeader code="J02" title="Nova OS" subtitle="Série obrigatória em retirada e troca. Garantia é tratada em Assistência (J08)." />
      {ctx.readOnly && <ReadOnlyBanner />}
      <Card>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Serviço do catálogo"><Select value={f.serviceId} onChange={(e) => { const s = ctx.db.services.find((x) => x.id === e.target.value); setF({ ...f, serviceId: e.target.value, charged: s ? String(s.defaultPrice) : f.charged }); }}><option value="">Escolha…</option>{ctx.db.services.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <Field label="Valor cobrado (R$)"><Input type="number" min={0} step="0.01" value={f.charged} onChange={(e) => setF({ ...f, charged: e.target.value })} /></Field>
          <Field label="Cliente"><Select value={f.customerId} onChange={(e) => setF({ ...f, customerId: e.target.value })}><option value="">Escolha…</option>{ctx.db.customers.filter((c) => company && c.companyIds.includes(company.id)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Placa do veículo"><Input value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value.toUpperCase() })} /></Field>
          <Field label="Contrato (opcional)"><Select value={f.contractId} onChange={(e) => setF({ ...f, contractId: e.target.value })}><option value="">—</option>{ctx.db.contracts.filter((c) => company && c.companyId === company.id).map((c) => <option key={c.id} value={c.id}>{c.number}</option>)}</Select></Field>
          <Field label="Agenda"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Técnico"><Input value={f.technician} onChange={(e) => setF({ ...f, technician: e.target.value })} /></Field>
          <Field label="Tipo de técnico"><Select value={f.technicianKind} onChange={(e) => setF({ ...f, technicianKind: e.target.value as "interno" | "terceiro" })}><option value="interno">Interno</option><option value="terceiro">Terceiro (N3, sem login)</option></Select></Field>
          {needsSerial && <Field label="Série(s) a retirar/trocar (vírgula)"><Input value={f.serialsIn} onChange={(e) => setF({ ...f, serialsIn: e.target.value })} className="font-mono" /></Field>}
        </div>
        <p className="mt-2 text-xs text-slate-500">Vínculo com demanda do Argos é opcional e fica desligado (integração simulada).</p>
        <div className="mt-4 flex gap-2">
          <Btn disabled={ctx.readOnly || !company || !ctx.can("operacoes", "criar")} onClick={() => act((db) => {
            if (!f.customerId) throw new Error("Escolha o cliente.");
            if (!f.technician.trim()) throw new Error("Informe o técnico.");
            const serialsIn = f.serialsIn.split(/[\s,;]+/).filter(Boolean);
            serialsIn.forEach((s) => { if (!findSerial(db, s)) throw new Error(`Série ${s} não encontrada.`); });
            return createWorkOrder(db, { companyId: company!.id, serviceId: f.serviceId, customerId: f.customerId, contractId: f.contractId || undefined, plate: f.plate, technician: f.technician, technicianKind: f.technicianKind, charged: Number(f.charged) || 0, origin: f.contractId ? "comodato" : "manual", serialsIn }, ctx.user.id);
          }, { ok: "OS criada.", go: (o) => p(to("/os/:id", { id: o.id })) })}>Salvar</Btn>
          <Btn variant="secondary" onClick={() => nav(p("/os"))}>Cancelar</Btn>
        </div>
      </Card>
    </>
  );
}

// ---- J03 ----
function J03() {
  const { ctx, wo } = useWO();
  const act = useAct();
  const toast = useToast();
  if (!wo) return <NF />;
  const base = (path: string) => p(to(path, { id: wo.id }));
  const open = wo.status !== "finalizada" && wo.status !== "cancelada";
  return (
    <>
      <PageHeader code="J03" title={`OS ${wo.number}`} subtitle={<StatusBadge s={wo.status} />} actions={<>
        {open && <><LinkBtn to={base("/os/:id/materiais")}>Enviar materiais</LinkBtn><LinkBtn to={base("/os/:id/execucao")}>Registrar execução</LinkBtn><LinkBtn to={base("/os/:id/custos")}>Custos e margem</LinkBtn><LinkBtn variant="primary" to={base("/os/:id/encerrar")}>Finalizar</LinkBtn></>}
        <LinkBtn to={base("/os/:id/historico")}>Comprovante</LinkBtn>
        <Btn variant="secondary" onClick={async () => { await getArgos().linkDemand(wo.id, "—"); toast.ok("Argos está em modo simulado: nenhuma chamada externa foi feita."); }}>Abrir no Argos</Btn>
        {open && <ReasonButton variant="danger" label="Cancelar OS" disabled={ctx.readOnly} onSubmit={(r) => act((db) => { db.workOrders.find((x) => x.id === wo.id)!.status = "cancelada"; audit(db, ctx.user.id, "os.cancelada", wo.id, wo.companyId, r); }, { ok: "OS cancelada.", go: p("/os") })} />}</>} />
      <Card><KV items={[["Serviço", svcName(ctx.db, wo.serviceId)], ["Cliente", custName(ctx.db, wo.customerId)], ["Placa", wo.plate], ["Técnico", `${wo.technician} (${wo.technicianKind})${wo.technicianKind === "terceiro" ? " — registrado pelo Suporte N2" : ""}`], ["Origem", wo.origin], ["Contrato", ctx.db.contracts.find((c) => c.id === wo.contractId)?.number]]} /></Card>
      <Card title="Itens previstos" className="mt-3"><DataTable rows={[...wo.serialsOut.map((s) => ({ s, t: "A instalar/enviar" })), ...wo.serialsIn.map((s) => ({ s, t: "A retirar" }))]} cols={[{ h: "Série", cell: (r) => r.s }, { h: "Papel", cell: (r) => r.t }]} onRow={(r) => p(to("/estoque/equipamentos/:id", { id: findSerial(ctx.db, r.s)?.id ?? "" }))} empty={<p className="text-sm text-slate-500">Nenhuma série vinculada ainda.</p>} /></Card>
    </>
  );
}

// ---- J04 ----
function J04() {
  const { ctx, wo } = useWO();
  const act = useAct();
  const [val, setVal] = useState("");
  if (!wo) return <NF />;
  return (
    <>
      <PageHeader code="J04" title={`Materiais da OS ${wo.number}`} subtitle="Reservar não muda a propriedade." actions={<LinkBtn to={p(to("/os/:id", { id: wo.id }))}>Voltar</LinkBtn>} />
      <Card>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); act((db) => sendMaterialsToWO(db, wo.id, val), { ok: "Série reservada à OS.", then: () => setVal("") }); }}><Input autoFocus className="max-w-sm font-mono" placeholder="Leia a série a reservar" value={val} onChange={(e) => setVal(e.target.value)} /><Btn type="submit" disabled={ctx.readOnly}>Reservar séries</Btn></form>
        <div className="mt-3"><DataTable rows={wo.serialsOut} cols={[{ h: "Série", cell: (s) => s }, { h: "Produto", cell: (s) => prodName(ctx.db, findSerial(ctx.db, s)?.productId ?? "") }, { h: "Local", cell: (s) => ctx.db.locations.find((l) => l.id === findSerial(ctx.db, s)?.locationId)?.name ?? "—" }]} empty={<p className="text-sm text-slate-500">Nenhum material reservado.</p>} /></div>
        <div className="mt-4 flex gap-2"><LinkBtn to={p("/estoque/transferencias/nova")}>Enviar ao técnico</LinkBtn><LinkBtn to={p("/estoque/saidas/nova")}>Emitir nota</LinkBtn></div>
      </Card>
    </>
  );
}

// ---- J05 ----
function J05() {
  const { ctx, wo } = useWO();
  const act = useAct();
  const [f, setF] = useState({ installed: "", removed: "", plate: wo?.plate ?? "", photos: "", chip: "", platform: "", supply: "", supplyQty: "1" });
  if (!wo) return <NF />;
  const stockProducts = ctx.db.products.filter((x) => !x.requiresSerial);
  return (
    <>
      <PageHeader code="J05" title={`Execução da OS ${wo.number}`} subtitle="O Suporte N2 registra em nome do técnico, com evidência. A série instalada precisa estar com o técnico ou no cliente." actions={<LinkBtn to={p(to("/os/:id", { id: wo.id }))}>Voltar</LinkBtn>} />
      <Card>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Série instalada"><Input className="font-mono" value={f.installed} onChange={(e) => setF({ ...f, installed: e.target.value })} placeholder={wo.serialsOut.join(", ")} /></Field>
          <Field label="Série retirada"><Input className="font-mono" value={f.removed} onChange={(e) => setF({ ...f, removed: e.target.value })} placeholder={wo.serialsIn.join(", ")} /></Field>
          <Field label="Placa"><Input value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value.toUpperCase() })} /></Field>
          <Field label="ICCID do chip"><Input className="font-mono" value={f.chip} onChange={(e) => setF({ ...f, chip: e.target.value })} /></Field>
          <Field label="Plataforma"><Input value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })} /></Field>
          <Field label="Fotos (evidência)"><input type="file" multiple accept="image/*" className="text-sm" onChange={(e) => setF({ ...f, photos: [...(e.target.files ?? [])].map((x) => x.name).join(", ") })} /></Field>
          <Field label="Insumo usado (do estoque)"><Select value={f.supply} onChange={(e) => setF({ ...f, supply: e.target.value })}><option value="">—</option>{stockProducts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
          <Field label="Quantidade"><Input type="number" min={1} value={f.supplyQty} onChange={(e) => setF({ ...f, supplyQty: e.target.value })} /></Field>
        </div>
        {f.photos && <p className="mt-2 text-xs text-slate-500">Fotos anexadas (nomes): {f.photos}. O envio dos arquivos usa o armazenamento do Supabase.</p>}
        <div className="mt-4 flex gap-2">
          <Btn disabled={ctx.readOnly} onClick={() => act((db) => {
            const w = db.workOrders.find((x) => x.id === wo.id)!;
            if (f.installed) {
              const s = findSerial(db, f.installed);
              if (!s) throw new Error(`Série ${f.installed} não encontrada.`);
              const withTech = s.custody.includes("João") || db.locations.find((l) => l.id === s.locationId)?.type === "tecnico";
              const reservedHere = w.serialsOut.includes(s.serial);
              if (!withTech && !reservedHere && s.commercial !== "comodato" && s.commercial !== "vendido") throw new Error("A série instalada precisa estar reservada à OS, com o técnico ou no cliente.");
              if (!w.serialsOut.includes(s.serial)) w.serialsOut.push(s.serial);
            }
            if (f.removed) { const r = findSerial(db, f.removed); if (!r) throw new Error(`Série ${f.removed} não encontrada.`); if (!w.serialsIn.includes(r.serial)) w.serialsIn.push(r.serial); }
            if (f.plate) w.plate = f.plate;
            if (f.supply) w.supplies.push({ productId: f.supply, description: prodName(db, f.supply), qty: Number(f.supplyQty) || 1, unitCost: 0, fromStock: true });
            if (f.installed && (f.chip || f.platform)) createLink(db, w.companyId, { serial: f.installed, iccid: f.chip || undefined, platform: f.platform || undefined, plate: w.plate, customerId: w.customerId }, ctx.user.id);
            w.status = "em_execucao";
            audit(db, ctx.user.id, "os.execucao", w.id, w.companyId, f.photos);
          }, { ok: "Execução registrada.", go: p(to("/os/:id", { id: wo.id })) })}>Salvar</Btn>
          <LinkBtn variant="primary" to={p(to("/os/:id/encerrar", { id: wo.id }))}>Finalizar OS</LinkBtn>
        </div>
      </Card>
    </>
  );
}

// ---- J06 ----
function J06() {
  const { ctx, wo } = useWO();
  const act = useAct();
  if (!wo) return <NF />;
  const svc = ctx.db.services.find((s) => s.id === wo.serviceId);
  const checks = [
    { ok: wo.techPayment !== null && (wo.techPayment !== 0 || !!wo.techPaymentZeroReason?.trim()), label: "Custos da OS lançados (pagamento ao técnico pode ser zero, com motivo)" },
    { ok: !(svc?.kind === "retirada" || svc?.kind === "troca") || wo.serialsIn.length > 0, label: "Série retirada registrada (retirada e troca)" },
    { ok: wo.status !== "cancelada", label: "OS não cancelada" },
  ];
  const mg = serviceMargin(ctx.db, wo);
  return (
    <>
      <PageHeader code="J06" title={`Finalizar OS ${wo.number}`} subtitle="Tudo é gravado numa única operação. Pendência impede a finalização. A cobrança e o financeiro virão com o Argos; aqui só se registra." />
      <Card>
        <ul className="space-y-1 text-sm">{checks.map((c) => <li key={c.label} className={c.ok ? "text-emerald-700" : "text-red-700"}>{c.ok ? "✔" : "✖"} {c.label}</li>)}</ul>
        <div className="mt-3"><KV items={[["Valor a cobrar", brl(wo.charged)], ...(ctx.seeCost ? ([["Custo da OS", brl(mg.cost)], ["Margem", `${brl(mg.margin)} (${mg.marginPct}%)`]] as [string, string][]) : [])]} /></div>
        <div className="mt-4 flex gap-2">
          <ConfirmButton variant="primary" label="Confirmar finalização" message="Finalizar grava vínculos, devoluções e consumo de insumos de uma vez." disabled={ctx.readOnly || checks.some((c) => !c.ok) || wo.status === "finalizada"} onConfirm={() => act((db) => finalizeWorkOrder(db, wo.id, ctx.user.id), { ok: "OS finalizada.", go: p(to("/os/:id/historico", { id: wo.id })) })} />
          <LinkBtn to={p(to("/os/:id/custos", { id: wo.id }))}>Custos e margem</LinkBtn><LinkBtn to={p(to("/os/:id", { id: wo.id }))}>Pendência</LinkBtn>
        </div>
      </Card>
    </>
  );
}

// ---- J07 ----
function J07() {
  const { ctx, wo } = useWO();
  const act = useAct();
  if (!wo) return <NF />;
  const events = ctx.db.audit.filter((a) => a.ref === wo.id);
  const canReopen = ctx.can("operacoes", "aprovar") || ctx.isAdmin;
  return (
    <>
      <PageHeader code="J07" title={`Comprovante da OS ${wo.number}`} subtitle={<StatusBadge s={wo.status} />} actions={<>
        <Btn variant="secondary" onClick={() => window.print()}>Imprimir</Btn>
        <LinkBtn to={p("/fiscal/notas/emitir")}>Emitir nota da venda</LinkBtn><LinkBtn to={p("/os/nova")}>Nova OS</LinkBtn><LinkBtn to={p("/gestao/margem")}>Margem</LinkBtn>
        {wo.status === "finalizada" && <ReasonButton label="Reabrir" disabled={!canReopen || ctx.readOnly} onSubmit={(r) => act((db) => { db.workOrders.find((x) => x.id === wo.id)!.status = "em_execucao"; audit(db, ctx.user.id, "os.reaberta", wo.id, wo.companyId, r); }, { ok: "OS reaberta.", go: p(to("/os/:id", { id: wo.id })) })} />}</>} />
      <Card><KV items={[["Cliente", custName(ctx.db, wo.customerId)], ["Técnico", wo.technician], ["Placa", wo.plate], ["Instalados", wo.serialsOut.join(", ") || "—"], ["Retirados", wo.serialsIn.join(", ") || "—"]]} />
        <div className="mt-3 flex flex-wrap gap-2">{[...wo.serialsOut, ...wo.serialsIn].map((s) => <LinkBtn key={s} to={p(to("/estoque/equipamentos/:id", { id: findSerial(ctx.db, s)?.id ?? "" }))}>{s}</LinkBtn>)}{wo.plate && <LinkBtn to={p(to("/operacao/veiculos/:id", { id: wo.plate }))}>Veículo {wo.plate}</LinkBtn>}</div></Card>
      <Card title="Histórico e alterações" className="mt-3"><DataTable rows={events} cols={[{ h: "Quando", cell: (a) => dt(a.at) }, { h: "Ação", cell: (a) => a.action }, { h: "Por", cell: (a) => ctx.db.profiles.find((x) => x.id === a.by)?.name }, { h: "Detalhe", cell: (a) => a.detail }]} empty={<p className="text-sm text-slate-500">Sem eventos.</p>} /></Card>
    </>
  );
}

// ---- J08 ----
function J08() {
  const ctx = useCtx();
  const rows = ctx.db.assists.filter((a) => ctx.companyIds.includes(a.companyId));
  return (
    <>
      <PageHeader code="J08" title="Assistência e garantia" actions={!ctx.readOnly && ctx.can("operacoes", "criar") ? <LinkBtn variant="primary" to={p("/assistencia/novo")}>Abrir chamado</LinkBtn> : undefined} />
      <DataTable rows={rows} cols={[{ h: "Série", cell: (a) => a.serial }, { h: "Defeito", cell: (a) => a.defect }, { h: "Origem", cell: (a) => (ctx.db.contracts.some((c) => c.serials.includes(a.serial)) ? "Comodato" : ctx.db.outbounds.some((o) => o.kind === "venda" && o.serials.includes(a.serial)) ? "Vendido" : "Estoque") }, { h: "Garantia até", cell: (a) => a.warrantyUntil ?? "—" }, { h: "Situação", cell: (a) => <StatusBadge s={a.status} /> }]} onRow={(a) => p(to("/assistencia/:id", { id: a.id }))} empty={<Empty text="Nenhum chamado." />} />
    </>
  );
}

// ---- J09 ----
function J09() {
  const ctx = useCtx();
  const act = useAct();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const [f, setF] = useState({ serial: sp.get("serie") ?? "", defect: "", evidence: "" });
  return (
    <>
      <PageHeader code="J09" title="Abrir chamado" subtitle="Série obrigatória. Garantia de 12 meses (câmeras) contada da venda, do comodato ou da instalação." />
      <Card>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Série"><Input className="font-mono" value={f.serial} onChange={(e) => setF({ ...f, serial: e.target.value })} /></Field>
          <Field label="Defeito"><Input value={f.defect} onChange={(e) => setF({ ...f, defect: e.target.value })} /></Field>
          <Field label="Evidências (descrição ou arquivo)"><Input value={f.evidence} onChange={(e) => setF({ ...f, evidence: e.target.value })} /></Field>
        </div>
        <div className="mt-4 flex gap-2"><Btn disabled={ctx.readOnly || !ctx.company} onClick={() => act((db) => openAssist(db, { companyId: ctx.company!.id, serial: f.serial, defect: f.defect }, ctx.user.id), { ok: "Chamado aberto; item em quarentena.", go: (a) => p(to("/assistencia/:id", { id: a.id })) })}>Salvar</Btn><Btn variant="secondary" onClick={() => nav(p("/assistencia"))}>Cancelar</Btn></div>
      </Card>
    </>
  );
}

// ---- J10 ----
function J10() {
  const ctx = useCtx();
  const { id } = useParams();
  const act = useAct();
  const a = ctx.db.assists.find((x) => x.id === id && ctx.companyIds.includes(x.companyId));
  if (!a) return <NF back="/assistencia" />;
  const s = findSerial(ctx.db, a.serial);
  const inWarranty = a.warrantyUntil ? a.warrantyUntil >= new Date().toISOString().slice(0, 10) : false;
  const go = (status: typeof a.status, path: string) => act((db) => { db.assists.find((x) => x.id === a.id)!.status = status; }, { go: p(to(path, { id: a.id })) });
  return (
    <>
      <PageHeader code="J10" title={`Triagem — ${a.serial}`} subtitle={<StatusBadge s={a.status} />} />
      <Card><KV items={[["Defeito", a.defect], ["Local", ctx.db.locations.find((l) => l.id === s?.locationId)?.name ?? "—"], ["Condição técnica", <StatusBadge key="t" s={s?.technical ?? ""} />], ["Garantia", a.warrantyUntil ? `${a.warrantyUntil} ${inWarranty ? "(dentro da garantia)" : "(vencida)"}` : "sem garantia cadastrada"]]} />
        <p className="mt-2 text-xs text-slate-500">O item fica em quarentena e não aparece como disponível.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Btn disabled={ctx.readOnly} onClick={() => go("reparo", "/assistencia/:id/reparo")}>Enviar para reparo ou RMA</Btn>
          <Btn variant="secondary" disabled={ctx.readOnly} onClick={() => go("substituicao", "/assistencia/:id/substituir")}>Substituir</Btn>
          <Btn variant="secondary" disabled={ctx.readOnly} onClick={() => go("sem_defeito", "/assistencia/:id/encerrar")}>Sem defeito</Btn>
          <LinkBtn to={p(`/estoque/perdas`)}>Dar baixa</LinkBtn>
        </div></Card>
    </>
  );
}

// ---- J11 ----
function J11() {
  const ctx = useCtx();
  const { id } = useParams();
  const act = useAct();
  const a = ctx.db.assists.find((x) => x.id === id && ctx.companyIds.includes(x.companyId));
  const [f, setF] = useState({ supplierId: "", parts: "", cost: "", result: "" });
  if (!a) return <NF back="/assistencia" />;
  return (
    <>
      <PageHeader code="J11" title={`Reparo ou RMA — ${a.serial}`} subtitle="O custo entra no custo do equipamento (RN-016)." />
      <Card>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Fornecedor"><Select value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}><option value="">—</option>{ctx.db.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
          <Field label="Peças"><Input value={f.parts} onChange={(e) => setF({ ...f, parts: e.target.value })} /></Field>
          {ctx.seeCost ? <Field label="Custo (R$)"><Input type="number" min={0} step="0.01" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} /></Field> : <Field label="Custo"><Badge>somente administrador</Badge></Field>}
          <Field label="Resultado"><Input value={f.result} onChange={(e) => setF({ ...f, result: e.target.value })} /></Field>
        </div>
        <div className="mt-4 flex gap-2"><Btn disabled={ctx.readOnly} onClick={() => act((db) => { const x = db.assists.find((y) => y.id === a.id)!; x.repairCost = Number(f.cost) || 0; x.status = "reparo"; audit(db, ctx.user.id, "assistencia.reparo", a.id, a.companyId, `${f.parts} / ${f.result}`); }, { ok: "Reparo registrado.", go: p(to("/assistencia/:id/encerrar", { id: a.id })) })}>Concluir</Btn><LinkBtn to={p(to("/assistencia/:id", { id: a.id }))}>Voltar</LinkBtn></div>
      </Card>
    </>
  );
}

// ---- J12 ----
function J12() {
  const ctx = useCtx();
  const { id } = useParams();
  const act = useAct();
  const [val, setVal] = useState("");
  const a = ctx.db.assists.find((x) => x.id === id && ctx.companyIds.includes(x.companyId));
  if (!a) return <NF back="/assistencia" />;
  const old = findSerial(ctx.db, a.serial);
  const oldLinks = ctx.db.links.filter((l) => l.serial === a.serial && l.to === null);
  return (
    <>
      <PageHeader code="J12" title={`Substituição — ${a.serial}`} subtitle="Fecha os vínculos antigos com data e abre os novos. Reaproveitar item exige voltar ao estoque, mesmo que como perda." />
      <Card>
        <KV items={[["Série antiga", a.serial], ["Situação comercial", old?.commercial], ["Vínculos a fechar", oldLinks.map((l) => `${l.iccid ?? "—"} / ${l.platform ?? "—"} / ${l.plate ?? "—"}`).join("; ") || "nenhum"]]} />
        <form className="mt-3 flex gap-2" onSubmit={(e) => e.preventDefault()}><Field label="Ler série nova"><Input className="font-mono" value={val} onChange={(e) => setVal(e.target.value)} /></Field></form>
        <div className="mt-4 flex gap-2"><Btn disabled={ctx.readOnly || !val.trim() || !old} onClick={() => act((db) => {
          const nw = findSerial(db, val);
          if (!nw) throw new Error(`Série ${val} não encontrada.`);
          const prob = eligibilityProblem(db, nw, a.companyId);
          if (prob) throw new Error(`Série nova indisponível: ${prob}.`);
          const o = findSerial(db, a.serial)!;
          const links = db.links.filter((l) => l.serial === o.serial && l.to === null);
          const q = quarantineLocation(db, a.companyId);
          updateSerial(db, nw, { commercial: o.commercial, custody: o.custody, locationId: o.locationId }, ctx.user.id, a.id);
          for (const l of links) l.to = new Date().toISOString(); // fecha os vínculos antigos com data
          for (const l of links) createLink(db, a.companyId, { serial: nw.serial, iccid: l.iccid, platform: l.platform, externalId: undefined, plate: l.plate, customerId: l.customerId }, ctx.user.id);
          if (o.locationId && db.locations.find((x) => x.id === o.locationId)?.type !== "quarentena") updateSerial(db, o, { locationId: q }, ctx.user.id, a.id);
          updateSerial(db, o, { commercial: "disponivel", technical: "defeito", custody: "Quarentena" }, ctx.user.id, a.id);
          db.assists.find((x) => x.id === a.id)!.status = "substituicao";
        }, { ok: "Substituição registrada.", go: p(to("/assistencia/:id/encerrar", { id: a.id })) })}>Ler série nova e confirmar</Btn><LinkBtn to={p(to("/assistencia/:id", { id: a.id }))}>Voltar</LinkBtn></div>
      </Card>
    </>
  );
}

// ---- J13 ----
function J13() {
  const ctx = useCtx();
  const { id } = useParams();
  const act = useAct();
  const [f, setF] = useState({ dest: "estoque", laudo: "", inspected: false });
  const a = ctx.db.assists.find((x) => x.id === id && ctx.companyIds.includes(x.companyId));
  if (!a) return <NF back="/assistencia" />;
  return (
    <>
      <PageHeader code="J13" title={`Encerrar assistência — ${a.serial}`} subtitle="Não volta a “disponível” sem inspeção." />
      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Destino"><Select value={f.dest} onChange={(e) => setF({ ...f, dest: e.target.value })}><option value="estoque">Voltar ao estoque</option><option value="cliente">Devolver ao cliente</option></Select></Field>
          <Field label="Laudo"><Input value={f.laudo} onChange={(e) => setF({ ...f, laudo: e.target.value })} /></Field>
        </div>
        <p className="mt-2 text-sm">Custo do reparo: {ctx.seeCost ? brl(a.repairCost) : "oculto"} · garantia até {a.warrantyUntil ?? "—"}</p>
        {f.dest === "estoque" && <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={f.inspected} onChange={(e) => setF({ ...f, inspected: e.target.checked })} /> Inspeção concluída (obrigatória para voltar ao estoque)</label>}
        <div className="mt-4 flex gap-2"><Btn disabled={ctx.readOnly || !f.laudo.trim()} onClick={() => act((db) => {
          const x = db.assists.find((y) => y.id === a.id)!;
          if (f.dest === "estoque" && !f.inspected) throw new Error("Sem inspeção o item não volta a ficar disponível.");
          const s = findSerial(db, x.serial)!;
          atomic(db, () => {
            if (x.repairCost > 0 && !db.serialHistory.some((h) => h.ref === `assistencia:${x.id}`)) addAssignedCost(db, x.serial, x.repairCost, `assistencia:${x.id}`, ctx.user.id);
            if (f.dest === "estoque") {
              const dep = db.locations.find((l) => l.companyId === x.companyId && l.type === "deposito");
              if (dep && s.commercial === "disponivel") updateSerial(db, s, { locationId: dep.id, technical: "bom", custody: dep.name }, ctx.user.id, x.id);
              else updateSerial(db, s, { technical: "bom" }, ctx.user.id, x.id);
            }
            x.status = "encerrado";
            audit(db, ctx.user.id, "assistencia.encerrada", x.id, x.companyId, f.laudo);
          });
        }, { ok: "Assistência encerrada.", go: p(to("/estoque/equipamentos/:id", { id: findSerial(ctx.db, a.serial)?.id ?? "" })) })}>Confirmar</Btn><LinkBtn to={p("/assistencia")}>Voltar</LinkBtn></div>
      </Card>
    </>
  );
}

// ---- J14 / J15 / J16 ----
function J14() {
  const ctx = useCtx();
  const rows = ctx.db.kitOrders.filter((k) => ctx.companyIds.includes(k.companyId));
  return (
    <>
      <PageHeader code="J14" title="Montagem de kits" actions={!ctx.readOnly && ctx.can("operacoes", "criar") ? <LinkBtn variant="primary" to={p("/operacao/kits/nova")}>Nova ordem</LinkBtn> : undefined} />
      <DataTable rows={rows} cols={[{ h: "Kit", cell: (k) => prodName(ctx.db, k.kitProductId) }, { h: "Quantidade", cell: (k) => k.qty, right: true }, { h: "Montados", cell: (k) => k.built.length, right: true }, { h: "Situação", cell: (k) => <StatusBadge s={k.status} /> }]} onRow={(k) => p(to("/operacao/kits/:id", { id: k.id }))} empty={<Empty text="Nenhuma ordem de montagem." />} />
    </>
  );
}
function J15() {
  const ctx = useCtx();
  const act = useAct();
  const [f, setF] = useState({ kit: "", qty: "1" });
  const kit = ctx.db.products.find((x) => x.id === f.kit);
  return (
    <>
      <PageHeader code="J15" title="Nova ordem de montagem" subtitle="Componentes precisam estar disponíveis; ficam reservados." />
      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Kit"><Select value={f.kit} onChange={(e) => setF({ ...f, kit: e.target.value })}><option value="">Escolha…</option>{ctx.db.products.filter((x) => x.klass === "kit").map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
          <Field label="Quantidade"><Input type="number" min={1} value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></Field>
        </div>
        {kit && <p className="mt-2 text-sm">Componentes por kit: {kit.kitComponents.map((c) => `${c.qty}× ${prodName(ctx.db, c.productId)}`).join(", ")}</p>}
        <div className="mt-4 flex gap-2"><Btn disabled={ctx.readOnly || !ctx.company} onClick={() => act((db) => startKitOrder(db, { companyId: ctx.company!.id, kitProductId: f.kit, qty: Number(f.qty) }), { ok: "Montagem iniciada.", go: (o) => p(to("/operacao/kits/:id", { id: o.id })) })}>Iniciar montagem</Btn><LinkBtn to={p("/operacao/kits")}>Cancelar</LinkBtn></div>
      </Card>
    </>
  );
}
function J16() {
  const ctx = useCtx();
  const { id } = useParams();
  const act = useAct();
  const [kitSerial, setKitSerial] = useState("");
  const [comps, setComps] = useState<string[]>([]);
  const [val, setVal] = useState("");
  const toast = useToast();
  const o = ctx.db.kitOrders.find((k) => k.id === id && ctx.companyIds.includes(k.companyId));
  if (!o) return <NF back="/operacao/kits" />;
  const kit = ctx.db.products.find((x) => x.id === o.kitProductId)!;
  const need = kit.kitComponents.reduce((a, c) => a + c.qty, 0);
  const add = () => {
    const s = findSerial(ctx.db, val);
    if (!s) return toast.err(`Série ${normalizeCode(val)} não encontrada.`);
    const prob = eligibilityProblem(ctx.db, s, o.companyId);
    if (prob) return toast.err(`Componente indisponível: ${prob}.`);
    if (!comps.includes(s.serial)) setComps([...comps, s.serial]);
    setVal("");
  };
  return (
    <>
      <PageHeader code="J16" title={`Montagem — ${kit.name}`} subtitle={`${o.built.length} de ${o.qty} unidades. Consome os componentes e cria o item do kit com custo somado.`} actions={<LinkBtn to={p("/operacao/kits")}>Concluir ordem</LinkBtn>} />
      <Card title="Unidade atual">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Série do kit (nova)"><Input className="font-mono" value={kitSerial} onChange={(e) => setKitSerial(e.target.value)} /></Field>
          <form onSubmit={(e) => { e.preventDefault(); add(); }}><Field label={`Ler componente (${comps.length}/${need})`}><Input className="font-mono" value={val} onChange={(e) => setVal(e.target.value)} /></Field></form>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">{comps.map((c) => <Badge key={c} tone="blue">{c} <button aria-label={`Remover ${c}`} onClick={() => setComps(comps.filter((x) => x !== c))}>✕</button></Badge>)}</div>
        <div className="mt-4 flex gap-2">
          <Btn disabled={ctx.readOnly || o.status === "concluida" || !kitSerial.trim() || comps.length !== need} onClick={() => act((db) => buildKitUnit(db, o.id, kitSerial, comps, ctx.user.id), { ok: "Unidade concluída.", then: () => { setKitSerial(""); setComps([]); } })}>Concluir unidade</Btn>
          <LinkBtn to={p("/assistencia/novo")}>Unidade com defeito</LinkBtn>
        </div>
      </Card>
      <Card title="Unidades montadas" className="mt-3"><DataTable rows={o.built} cols={[{ h: "Série do kit", cell: (s) => s }, ...(ctx.seeCost ? [{ h: "Custo somado", cell: (s: string) => brl(findSerial(ctx.db, s)?.cost), right: true }] : [])]} onRow={(s) => p(to("/estoque/equipamentos/:id", { id: findSerial(ctx.db, s)?.id ?? "" }))} empty={<p className="text-sm text-slate-500">Nenhuma ainda.</p>} /></Card>
    </>
  );
}

// ---- J17 / J18 / J19 ----
function J17() {
  const ctx = useCtx();
  const rows = ctx.db.chips.filter((c) => ctx.companyIds.includes(c.companyId));
  return (
    <>
      <PageHeader code="J17" title="Chips" actions={!ctx.readOnly && ctx.can("operacoes", "criar") ? <LinkBtn variant="primary" to={p("/operacao/chips/novo")}>Entrada de chips</LinkBtn> : undefined} />
      <DataTable rows={rows} cols={[{ h: "ICCID", cell: (c) => <span className="font-mono">{c.iccid}</span> }, { h: "Operadora", cell: (c) => c.operator }, { h: "Plano", cell: (c) => c.plan }, { h: "Titular", cell: (c) => (c.holder === "ali_sat" ? "Ali Sat" : "Cliente") }, { h: "Situação", cell: (c) => <StatusBadge s={c.status} /> }, ...(ctx.seeCost ? [{ h: "Custo", cell: (c: (typeof rows)[number]) => brl(c.cost), right: true }] : [])]} onRow={(c) => p(to("/operacao/chips/:id", { id: c.id }))} empty={<Empty text="Nenhum chip." />} />
    </>
  );
}
function J18() {
  const ctx = useCtx();
  const { id } = useParams();
  const c = ctx.db.chips.find((x) => x.id === id && ctx.companyIds.includes(x.companyId));
  if (!c) return <NF back="/operacao/chips" />;
  const links = ctx.db.links.filter((l) => l.iccid === c.iccid);
  return (
    <>
      <PageHeader code="J18" title={`Chip ${c.iccid}`} subtitle={<StatusBadge s={c.status} />} actions={<><LinkBtn to={p("/operacao/plataformas/vinculo")}>Vincular ou trocar</LinkBtn><LinkBtn to={p("/operacao/chips")}>Voltar</LinkBtn></>} />
      <Card><KV items={[["Operadora", c.operator], ["Plano", c.plan], ["Titular", c.holder === "ali_sat" ? "Ali Sat" : "Cliente"], ...(ctx.seeCost ? ([["Custo", brl(c.cost)]] as [string, string][]) : [])]} /></Card>
      <Card title="Vínculos (desvincular não apaga o histórico)" className="mt-3"><DataTable rows={links} cols={[{ h: "Equipamento", cell: (l) => l.serial }, { h: "Plataforma", cell: (l) => l.platform }, { h: "Placa", cell: (l) => l.plate }, { h: "Início", cell: (l) => dt(l.from) }, { h: "Fim", cell: (l) => (l.to ? dt(l.to) : "vigente") }]} onRow={(l) => p(to("/estoque/equipamentos/:id", { id: findSerial(ctx.db, l.serial)?.id ?? "" }))} empty={<p className="text-sm text-slate-500">Sem vínculos.</p>} /></Card>
    </>
  );
}
function J19() {
  const ctx = useCtx();
  const act = useAct();
  const [text, setText] = useState("");
  const [meta, setMeta] = useState({ operator: "", plan: "", cost: "", holder: "ali_sat" as "ali_sat" | "cliente" });
  const ids = text.trim() ? parseCsv(text.replace(/[\s,;]+/g, "\n")).map((r) => r[0]).filter((x) => x && !/^iccid/i.test(x)) : [];
  const seen = new Set<string>();
  const check = ids.map((i) => { const dup = seen.has(i) || ctx.db.chips.some((c) => c.iccid === i); seen.add(i); return { i, err: !/^\d{19,20}$/.test(i) ? "formato inválido" : dup ? "duplicado" : "" }; });
  const bad = check.filter((c) => c.err);
  return (
    <>
      <PageHeader code="J19" title="Entrada de chips" subtitle="ICCID duplicado ou com formato inválido é recusado." />
      <Card>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Operadora"><Input value={meta.operator} onChange={(e) => setMeta({ ...meta, operator: e.target.value })} /></Field>
          <Field label="Plano / lote"><Input value={meta.plan} onChange={(e) => setMeta({ ...meta, plan: e.target.value })} /></Field>
          {ctx.seeCost && <Field label="Custo (R$)"><Input type="number" min={0} step="0.01" value={meta.cost} onChange={(e) => setMeta({ ...meta, cost: e.target.value })} /></Field>}
          <Field label="Titular"><Select value={meta.holder} onChange={(e) => setMeta({ ...meta, holder: e.target.value as "ali_sat" | "cliente" })}><option value="ali_sat">Ali Sat</option><option value="cliente">Cliente</option></Select></Field>
        </div>
        <Field label="ICCIDs (um por linha, colados ou de CSV)" className="mt-3"><Textarea rows={5} className="font-mono" value={text} onChange={(e) => setText(e.target.value)} /></Field>
        <input type="file" accept=".csv,.txt" className="mt-2 text-sm" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
        {check.length > 0 && <p className="mt-2 text-sm">{check.length - bad.length} válido(s), <span className="text-red-700">{bad.length} com erro</span>{bad.slice(0, 5).map((b) => ` · ${b.i}: ${b.err}`)}</p>}
        <div className="mt-4 flex gap-2"><Btn disabled={ctx.readOnly || check.length === 0 || bad.length > 0} onClick={() => act((db) => addChips(db, ctx.company!.id, ids.map((i) => ({ iccid: i, operator: meta.operator, plan: meta.plan, cost: Number(meta.cost) || 0, holder: meta.holder }))), { ok: `${ids.length} chip(s) cadastrados.`, go: p("/operacao/chips") })}>Salvar</Btn><LinkBtn to={p("/operacao/chips")}>Cancelar</LinkBtn></div>
      </Card>
    </>
  );
}

// ---- J20 / J21 / J22 ----
function J20() {
  const ctx = useCtx();
  const rows = ctx.db.links.filter((l) => ctx.companyIds.includes(l.companyId));
  return (
    <>
      <PageHeader code="J20" title="Plataformas e vínculos" subtitle="Histórico por data." actions={!ctx.readOnly && ctx.can("operacoes", "criar") ? <LinkBtn variant="primary" to={p("/operacao/plataformas/vinculo")}>Novo vínculo</LinkBtn> : undefined} />
      <DataTable rows={rows} cols={[{ h: "Equipamento", cell: (l) => l.serial }, { h: "Chip", cell: (l) => l.iccid }, { h: "Plataforma", cell: (l) => `${l.platform ?? "—"} ${l.externalId ? `(${l.externalId})` : ""}` }, { h: "Cliente", cell: (l) => custName(ctx.db, l.customerId) }, { h: "Placa", cell: (l) => l.plate }, { h: "Início", cell: (l) => dt(l.from) }, { h: "Fim", cell: (l) => (l.to ? dt(l.to) : "vigente") }]} onRow={(l) => p(to("/operacao/veiculos/:id", { id: l.plate ?? "sem-placa" }))} empty={<Empty text="Nenhum vínculo." />} />
    </>
  );
}
function J21() {
  const ctx = useCtx();
  const act = useAct();
  const nav = useNavigate();
  const [f, setF] = useState({ serial: "", iccid: "", platform: "", externalId: "", plate: "", customerId: "" });
  const [review, setReview] = useState(false);
  return (
    <>
      <PageHeader code="J21" title="Novo vínculo ou troca" subtitle="Encerra o vínculo anterior com data. ID externo em conflito é bloqueado. Segredos das plataformas ficam no servidor." />
      <Card>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Equipamento (série)"><Input className="font-mono" value={f.serial} onChange={(e) => setF({ ...f, serial: e.target.value })} /></Field>
          <Field label="Chip"><Select value={f.iccid} onChange={(e) => setF({ ...f, iccid: e.target.value })}><option value="">—</option>{ctx.db.chips.filter((c) => ctx.company && c.companyId === ctx.company.id).map((c) => <option key={c.id} value={c.iccid}>{c.iccid} ({c.status})</option>)}</Select></Field>
          <Field label="Plataforma"><Input value={f.platform} onChange={(e) => setF({ ...f, platform: e.target.value })} /></Field>
          <Field label="ID externo"><Input value={f.externalId} onChange={(e) => setF({ ...f, externalId: e.target.value })} /></Field>
          <Field label="Placa"><Input value={f.plate} onChange={(e) => setF({ ...f, plate: e.target.value.toUpperCase() })} /></Field>
          <Field label="Cliente"><Select value={f.customerId} onChange={(e) => setF({ ...f, customerId: e.target.value })}><option value="">—</option>{ctx.db.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        </div>
        {review && <p className="mt-3 rounded bg-slate-50 p-2 text-sm">Revisar: {f.serial} ⇄ {f.iccid || "sem chip"} / {f.platform || "sem plataforma"} / {f.plate || "sem placa"}. O vínculo anterior deste equipamento será encerrado hoje.</p>}
        <div className="mt-4 flex gap-2">
          {!review ? <Btn onClick={() => setReview(true)} disabled={!f.serial.trim()}>Revisar</Btn> : <Btn disabled={ctx.readOnly} onClick={() => act((db) => createLink(db, ctx.company!.id, { serial: f.serial, iccid: f.iccid || undefined, platform: f.platform || undefined, externalId: f.externalId || undefined, plate: f.plate || undefined, customerId: f.customerId || undefined }, ctx.user.id), { ok: "Vínculo registrado.", go: p("/operacao/plataformas") })}>Confirmar</Btn>}
          <Btn variant="secondary" onClick={() => nav(p("/operacao/plataformas"))}>Cancelar</Btn>
        </div>
      </Card>
    </>
  );
}
function J22() {
  const ctx = useCtx();
  const { id } = useParams();
  const plate = decodeURIComponent(id ?? "");
  const links = ctx.db.links.filter((l) => ctx.companyIds.includes(l.companyId) && l.plate === plate);
  const wos = ctx.db.workOrders.filter((o) => ctx.companyIds.includes(o.companyId) && o.plate === plate);
  if (links.length + wos.length === 0) return <NF back="/operacao/plataformas" />;
  const customer = links[0]?.customerId ?? wos[0]?.customerId;
  return (
    <>
      <PageHeader code="J22" title={`Veículo ${plate}`} subtitle={custName(ctx.db, customer)} actions={<LinkBtn to={p("/os/nova")}>Nova OS</LinkBtn>} />
      <Card title="Equipamentos, chips e plataforma (com vigências)"><DataTable rows={links} cols={[{ h: "Equipamento", cell: (l) => l.serial }, { h: "Chip", cell: (l) => l.iccid }, { h: "Plataforma", cell: (l) => l.platform }, { h: "Início", cell: (l) => dt(l.from) }, { h: "Fim", cell: (l) => (l.to ? dt(l.to) : "vigente") }]} onRow={(l) => p(to("/estoque/equipamentos/:id", { id: findSerial(ctx.db, l.serial)?.id ?? "" }))} /></Card>
      <Card title="OS" className="mt-3"><DataTable rows={wos} cols={[{ h: "OS", cell: (o) => o.number }, { h: "Serviço", cell: (o) => svcName(ctx.db, o.serviceId) }, { h: "Situação", cell: (o) => <StatusBadge s={o.status} /> }]} onRow={(o) => p(to("/os/:id", { id: o.id }))} /></Card>
      <p className="mt-2 text-xs text-slate-500">Troca não apaga a associação anterior.</p>
    </>
  );
}

// ---- J23 ----
function J23() {
  const { ctx, wo } = useWO();
  const act = useAct();
  const [f, setF] = useState({ charged: String(wo?.charged ?? 0), pay: wo?.techPayment === null || wo?.techPayment === undefined ? "" : String(wo.techPayment), zero: wo?.techPaymentZeroReason ?? "", ref: "" });
  const [sup, setSup] = useState<{ productId: string; qty: string; desc: string; cost: string }>({ productId: "", qty: "1", desc: "", cost: "" });
  if (!wo) return <NF />;
  if (!ctx.seeCost) return <NoPermission what="Valores de custo só aparecem para quem tem permissão de custo (administradores)." />;
  const mg = serviceMargin(ctx.db, { ...wo, charged: Number(f.charged) || 0, techPayment: f.pay === "" ? null : Number(f.pay) });
  const dep = ctx.db.locations.find((l) => ctx.company && l.companyId === wo.companyId && l.type === "deposito");
  const stockCost = (pid: string) => ctx.db.serials.find((s) => s.productId === pid && s.cost !== null)?.cost ?? null;
  return (
    <>
      <PageHeader code="J23" title={`Custos e margem da OS ${wo.number}`} subtitle="Insumo do estoque baixa o item e entra no custo da OS ao finalizar." actions={<><LinkBtn to={p("/gestao/margem")}>Ver margem</LinkBtn><LinkBtn to={p(to("/os/:id", { id: wo.id }))}>Voltar</LinkBtn></>} />
      <Card title="Serviço e técnico">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Valor cobrado do cliente (R$)"><Input type="number" min={0} step="0.01" value={f.charged} onChange={(e) => setF({ ...f, charged: e.target.value })} /></Field>
          <Field label={`Pagamento ao técnico (${wo.technicianKind})`}><Input type="number" min={0} step="0.01" value={f.pay} onChange={(e) => setF({ ...f, pay: e.target.value })} /></Field>
          <Field label="Referência"><Input value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} /></Field>
          {f.pay !== "" && Number(f.pay) === 0 && <Field label="Motivo do pagamento zero"><Input value={f.zero} onChange={(e) => setF({ ...f, zero: e.target.value })} /></Field>}
        </div>
      </Card>
      <Card title="Insumos" className="mt-3">
        <DataTable rows={wo.supplies} cols={[{ h: "Insumo", cell: (s) => s.description }, { h: "Origem", cell: (s) => (s.fromStock ? "Estoque (custo de compra automático)" : "Compra avulsa") }, { h: "Qtd", cell: (s) => s.qty, right: true }, { h: "Custo unitário", cell: (s) => brl(s.fromStock && s.productId ? stockCost(s.productId) ?? s.unitCost : s.unitCost), right: true }]} empty={<p className="text-sm text-slate-500">Nenhum insumo.</p>} />
        <div className="mt-3 grid gap-2 sm:grid-cols-5">
          <Select aria-label="Insumo do estoque" value={sup.productId} onChange={(e) => setSup({ ...sup, productId: e.target.value })}><option value="">Insumo do estoque…</option>{ctx.db.products.filter((x) => !x.requiresSerial).map((x) => <option key={x.id} value={x.id}>{x.name} ({dep ? balance(ctx.db, wo.companyId, x.id, dep.id) : 0} em estoque)</option>)}</Select>
          <Input aria-label="Descrição avulsa" placeholder="ou custo avulso: descrição" value={sup.desc} onChange={(e) => setSup({ ...sup, desc: e.target.value })} />
          <Input aria-label="Custo avulso" type="number" min={0} step="0.01" placeholder="Custo unit." value={sup.cost} onChange={(e) => setSup({ ...sup, cost: e.target.value })} />
          <Input aria-label="Quantidade" type="number" min={1} value={sup.qty} onChange={(e) => setSup({ ...sup, qty: e.target.value })} />
          <Btn variant="secondary" disabled={ctx.readOnly || (!sup.productId && !sup.desc)} onClick={() => act((db) => {
            const w = db.workOrders.find((x) => x.id === wo.id)!;
            w.supplies.push(sup.productId ? { productId: sup.productId, description: prodName(db, sup.productId), qty: Number(sup.qty) || 1, unitCost: 0, fromStock: true } : { description: sup.desc, qty: Number(sup.qty) || 1, unitCost: Number(sup.cost) || 0, fromStock: false });
          }, { then: () => setSup({ productId: "", qty: "1", desc: "", cost: "" }) })}>Adicionar</Btn>
        </div>
      </Card>
      <Card title="Resultado" className="mt-3">
        <KV items={[["Valor cobrado", brl(mg.revenue)], ["Custo total (técnico + insumos)", brl(mg.cost)], ["Margem do serviço", <strong key="m">{brl(mg.margin)} ({mg.marginPct}%)</strong>]]} />
        <div className="mt-3"><Btn disabled={ctx.readOnly} onClick={() => act((db) => setWOCosts(db, wo.id, ctx.user.id, { charged: Number(f.charged) || 0, techPayment: f.pay === "" ? null : Number(f.pay), zeroReason: f.zero }), { ok: "Custos salvos." })}>Salvar</Btn></div>
      </Card>
    </>
  );
}

export const screens: Record<string, ComponentType> = { J01, J02, J03, J04, J05, J06, J07, J08, J09, J10, J11, J12, J13, J14, J15, J16, J17, J18, J19, J20, J21, J22, J23 };
