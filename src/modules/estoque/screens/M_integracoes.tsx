import { useState, type ComponentType } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Badge, Btn, Card, DataTable, Empty, Field, Input, KV, LinkBtn, PageHeader, Select, StatusBadge, useAct, useToast } from "../components/ui";
import { audit } from "../domain/core";
import { dbIO } from "../data/store";
import { getArgos } from "../integrations/argos";
import { getCorreios } from "../integrations/correios";
import { getCrm } from "../integrations/crm";
import { getNfe } from "../integrations/nfe";
import { integrationMode } from "../integrations/ports";
import type { IntegrationEvent } from "../domain/types";
import { dt } from "../format";
import { p, to } from "../routes";
import { useCtx } from "../session";

const INTEGRATIONS = [
  { id: "crm", name: "CRM", key: "CRM" as const, desc: "Consulta de custo, reserva por série e eventos de oportunidade." },
  { id: "argos", name: "Argos", key: "ARGOS" as const, desc: "Usuários, demandas e financeiro (módulo futuro)." },
  { id: "nfe", name: "Provedor de NF-e", key: "NFE" as const, desc: "Emissão. Hoje: provedor SIMULADO, sem valor fiscal." },
  { id: "correios", name: "Correios", key: "CORREIOS" as const, desc: "Rastreamento de envios." },
];

// ---- M01 ----
function M01() {
  const ctx = useCtx();
  const errs = ctx.db.events.filter((e) => e.status === "erro").length;
  return (
    <>
      <PageHeader code="M01" title="Painel de integrações" subtitle="Falha de integração nunca apaga a operação local. As ligações reais ficam prontas e desligadas até a integração com o Argos." actions={<LinkBtn to={p("/integracoes/fila")}>{errs > 0 ? `Eventos com erro (${errs})` : "Fila de eventos"}</LinkBtn>} />
      <div className="grid gap-3 sm:grid-cols-2">
        {INTEGRATIONS.map((i) => {
          const last = ctx.db.events.filter((e) => e.system === i.id).sort((a, b) => b.at.localeCompare(a.at))[0];
          const mode = integrationMode(i.key);
          return (
            <Link key={i.id} to={p(to("/integracoes/:id", { id: i.id }))} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-sky-500">
              <div className="flex items-center justify-between"><h2 className="font-semibold">{i.name}</h2><Badge tone={mode === "mock" ? "amber" : "green"}>{mode === "mock" ? "simulada (desligada)" : "real (ligada)"}</Badge></div>
              <p className="mt-1 text-sm text-slate-600">{i.desc}</p>
              <p className="mt-2 text-xs text-slate-500">Último evento: {last ? `${last.type} · ${dt(last.at)} · ${last.status}` : "nenhum"}</p>
            </Link>
          );
        })}
      </div>
    </>
  );
}

// ---- M02 ----
function M02() {
  const ctx = useCtx();
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const act = useAct();
  const info = INTEGRATIONS.find((i) => i.id === id);
  const [version, setVersion] = useState("v1");
  const [mapping, setMapping] = useState(id === "crm" ? "oportunidade.id → crmOpportunityId\ncliente.id → customerId\nitens[].produto → productId" : "");
  const [result, setResult] = useState("");
  const [q, setQ] = useState({ productId: "", serial: "" });
  if (!info) return <Empty text="Integração não encontrada." action={<LinkBtn to={p("/integracoes")}>Voltar</LinkBtn>} />;
  const test = async () => {
    try {
      if (info.id === "crm") {
        const crm = getCrm(dbIO, () => ctx.user.id);
        const answers = await crm.queryCost({ productId: q.productId || undefined, serial: q.serial || undefined }, ctx.company?.id ?? ctx.companyIds[0]);
        setResult(`Conexão simulada OK. Consulta de custo devolveu ${answers.length} linha(s): ${answers.slice(0, 5).map((a) => `${a.serial ?? a.productId}=${a.cost ?? "s/ custo"}${a.provisional ? " (provisório)" : ""}`).join("; ")}`);
      } else if (info.id === "argos") { await getArgos().listUsers(); setResult("Argos (simulado): OK, sem chamada externa."); }
      else if (info.id === "nfe") { const r = await getNfe().transmit("teste"); setResult(`NF-e: ${r.status} — ${r.message}`); }
      else { const r = await getCorreios().track("TESTE123"); setResult(`Correios: ${r.status}`); }
    } catch (e) { setResult(`Falha: ${(e as Error).message}`); }
  };
  return (
    <>
      <PageHeader code="M02" title={`Configurar ${info.name}`} subtitle="Segredos ficam no servidor (Edge Functions) e nunca no navegador. Logs sem dados sensíveis." />
      <Card>
        <KV items={[["Modo", integrationMode(info.key) === "mock" ? "Simulado (padrão)" : "Real"], ["Chave de ambiente", `VITE_INTEGRATION_${info.key}`], ["Endereço do webhook (Edge Function)", info.id === "crm" ? "https://<projeto>.supabase.co/functions/v1/crm-webhook" : "—"], ["Credenciais", "Guardadas como segredo no servidor; não exibidas aqui."]]} />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Versão do contrato"><Select value={version} onChange={(e) => setVersion(e.target.value)}><option>v1</option></Select></Field>
          <Field label="Mapeamento de campos" className="sm:col-span-2"><textarea className="w-full rounded-md border border-slate-300 p-2 font-mono text-xs" rows={4} value={mapping} onChange={(e) => setMapping(e.target.value)} /></Field>
        </div>
        {info.id === "crm" && (
          <div className="mt-3 rounded-lg bg-slate-50 p-3">
            <p className="mb-2 text-sm">O CRM consulta aqui o <strong>custo de compra por produto e por série</strong> ao montar o orçamento, antes de reservar as séries. A margem do orçamento é calculada no CRM.</p>
            <div className="flex flex-wrap gap-2"><Select className="max-w-64" value={q.productId} onChange={(e) => setQ({ ...q, productId: e.target.value })}><option value="">Por produto…</option>{ctx.db.products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select><Input className="max-w-48 font-mono" placeholder="ou por série" value={q.serial} onChange={(e) => setQ({ ...q, serial: e.target.value })} /></div>
          </div>
        )}
        {result && <p className="mt-3 rounded bg-slate-100 p-2 text-sm" role="status">{result}</p>}
        <div className="mt-4 flex gap-2"><Btn variant="secondary" onClick={test}>Testar conexão</Btn><Btn onClick={() => act((db) => { audit(db, ctx.user.id, "integracao.config", info.id, undefined, `versão ${version}`); }, { ok: "Configuração salva (mapeamento guardado só como registro no modo demonstração).", go: p("/integracoes") })}>Salvar</Btn><Btn variant="ghost" onClick={() => { toast.ok("Cancelado."); nav(p("/integracoes")); }}>Cancelar</Btn></div>
      </Card>
    </>
  );
}

// ---- M03 ----
function M03() {
  const ctx = useCtx();
  const act = useAct();
  const toast = useToast();
  const [sel, setSel] = useState<IntegrationEvent | null>(null);
  const rows = [...ctx.db.events].sort((a, b) => b.at.localeCompare(a.at));
  const reprocess = async (e: IntegrationEvent) => {
    if (e.system !== "crm") return toast.err("Só eventos do CRM podem ser reprocessados no modo simulado.");
    await getCrm(dbIO, () => ctx.user.id).handleEvent({ idempotencyKey: e.idempotencyKey, type: e.type as "opportunity.won" | "opportunity.cancelled", payload: e.payload });
    toast.ok("Reprocessado (não duplica reserva, nota, cliente nem OS).");
  };
  const inject = (type: "opportunity.won" | "opportunity.cancelled") => act((db) => {
    const n = db.events.length + 1;
    db.events.push({ id: `evt_x${n}`, system: "crm", type, idempotencyKey: `crm-sim-${n}`, payload: { opportunityId: `OPP-SIM-${n}`, customerId: "c_1", value: 500, items: [] }, status: "recebido", attempts: 0, at: new Date().toISOString() });
  }, { ok: "Evento simulado do CRM recebido." });
  return (
    <>
      <PageHeader code="M03" title="Fila de eventos" subtitle="Reprocessar não duplica reserva, nota, cliente nem OS. Falha do CRM não apaga a operação local." actions={<><Btn variant="secondary" onClick={() => inject("opportunity.won")}>Simular “oportunidade ganha”</Btn><LinkBtn to={p("/integracoes")}>Voltar</LinkBtn></>} />
      <DataTable rows={rows} cols={[
        { h: "Evento", cell: (e) => `${e.system}: ${e.type}` }, { h: "Chave de idempotência", cell: (e) => <span className="font-mono text-xs">{e.idempotencyKey}</span> }, { h: "Tentativas", cell: (e) => e.attempts, right: true },
        { h: "Situação", cell: (e) => <StatusBadge s={e.status} /> }, { h: "Erro", cell: (e) => e.error },
        { h: "", cell: (e) => <span className="flex gap-1"><Btn variant="ghost" onClick={() => setSel(e)}>Detalhe</Btn><Btn variant="ghost" onClick={() => reprocess(e)} disabled={e.status === "tratado"}>Reprocessar</Btn><Btn variant="ghost" disabled={e.status === "tratado"} onClick={() => act((db) => { db.events.find((x) => x.id === e.id)!.status = "tratado"; })}>Marcar como tratado</Btn></span> },
      ]} empty={<Empty text="Fila vazia." />} />
      {sel && (
        <div className="fixed inset-y-0 right-0 z-40 w-full max-w-md overflow-auto border-l border-slate-200 bg-white p-5 shadow-xl" role="dialog" aria-label="Detalhe do evento">
          <div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">Detalhe do evento</h3><button aria-label="Fechar" onClick={() => setSel(null)}>✕</button></div>
          <KV items={[["Tipo", sel.type], ["Sistema", sel.system], ["Recebido", dt(sel.at)], ["Situação", sel.status], ["Erro", sel.error]]} />
          <pre className="mt-3 max-h-64 overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100">{JSON.stringify(sel.payload, null, 2)}</pre>
        </div>
      )}
    </>
  );
}

export const screens: Record<string, ComponentType> = { M01, M02, M03 };
