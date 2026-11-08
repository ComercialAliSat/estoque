import { useEffect, useState, type ComponentType, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Btn, Card, Field, Input, KV, LinkBtn, PageHeader, StatusBadge } from "../components/ui";
import { authPort, DEMO_MFA, DEMO_PASSWORD } from "../integrations/auth";
import { p, PUBLIC } from "../routes";
import { useCtx, useSession } from "../session";
import { SCREENS } from "./registry";

function Shell({ code, title, children }: { code: string; title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow">
        <div className="text-xs font-mono text-slate-400">{code}</div>
        <h1 className="mb-1 text-xl font-semibold">{title}</h1>
        <p className="mb-4 text-sm text-slate-500">Gestão Integrada Ali Sat · Estoque</p>
        {children}
      </div>
    </div>
  );
}

// ---- A01 ----
function A01() {
  const nav = useNavigate();
  const loc = useLocation();
  const { signedIn } = useSession();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [fails, setFails] = useState(0);
  const from = (loc.state as { from?: string } | null)?.from;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (fails >= 5) {
      setErr("Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.");
      return;
    }
    setBusy(true);
    const r = await authPort.signIn(email, pw);
    setBusy(false);
    if ("error" in r) {
      setFails(fails + 1);
      setErr(r.error);
      return;
    }
    if (r.needsMfa) {
      nav(PUBLIC.verificacao, { state: { userId: r.userId, from } });
      return;
    }
    signedIn(r.userId);
    nav(from ?? p("/empresa"), { replace: true });
  };

  return (
    <Shell code="A01" title="Entrar">
      <form onSubmit={submit} className="space-y-3">
        <Field label="E-mail"><Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        <Field label="Senha"><Input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required /></Field>
        {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
        <Btn type="submit" disabled={busy} className="w-full">Entrar</Btn>
        <div className="text-center text-sm"><Link className="text-sky-800 underline" to={PUBLIC.recuperar}>Esqueci minha senha</Link></div>
      </form>
      <div className="mt-5 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
        <strong>Modo demonstração.</strong> Senha de todos os usuários: <code>{DEMO_PASSWORD}</code> · código de verificação (administradores): <code>{DEMO_MFA}</code>.
        <ul className="mt-1 list-disc pl-4">
          <li>admin@demo.local (Administrador, as duas empresas)</li>
          <li>admin2@demo.local (outro administrador, para aprovações)</li>
          <li>oper@demo.local (Operação, só Traxor, sem custos)</li>
          <li>oper2@demo.local (Operação, só Ali Sat)</li>
        </ul>
      </div>
    </Shell>
  );
}

// ---- A02 ----
function A02() {
  const nav = useNavigate();
  const loc = useLocation();
  const { signedIn } = useSession();
  const st = (loc.state ?? {}) as { userId?: string; from?: string };
  const [code, setCode] = useState("");
  const [tries, setTries] = useState(0);
  const [err, setErr] = useState("");
  if (!st.userId) {
    return <Shell code="A02" title="Código de verificação"><p className="mb-3 text-sm">Entre primeiro com e-mail e senha.</p><LinkBtn to={PUBLIC.login}>Voltar ao login</LinkBtn></Shell>;
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const ok = await authPort.verifyMfa(st.userId!, code);
    if (ok) {
      signedIn(st.userId!);
      nav(st.from ?? p("/empresa"), { replace: true });
      return;
    }
    const n = tries + 1;
    setTries(n);
    setCode("");
    if (n >= 3) nav(PUBLIC.login, { replace: true });
    else setErr(`Código incorreto. Tentativa ${n} de 3.`);
  };
  return (
    <Shell code="A02" title="Código de verificação">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Código de 6 dígitos do aplicativo autenticador">
          <Input inputMode="numeric" maxLength={6} pattern="[0-9]{6}" value={code} onChange={(e) => setCode(e.target.value)} autoFocus required />
        </Field>
        {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
        <div className="flex gap-2"><Btn type="submit">Confirmar</Btn><LinkBtn to={PUBLIC.login}>Voltar</LinkBtn></div>
      </form>
    </Shell>
  );
}

// ---- A03 ----
function A03() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  return (
    <Shell code="A03" title="Esqueci minha senha">
      {sent ? (
        <>
          <p className="mb-3 text-sm">Se o e-mail estiver cadastrado, enviamos o link.</p>
          <Btn onClick={() => nav(PUBLIC.login)}>Voltar ao login</Btn>
        </>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); setSent(true); }} className="space-y-3">
          <Field label="E-mail"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
          <div className="flex gap-2"><Btn type="submit">Enviar link</Btn><LinkBtn to={PUBLIC.login}>Voltar</LinkBtn></div>
          <p className="text-xs text-slate-500">Demonstração: nenhum e-mail é enviado de verdade.</p>
        </form>
      )}
    </Shell>
  );
}

// ---- A04 ----
const COMMON = ["1234567890", "senha12345", "password123", "qwertyuiop", "0123456789", "abcdefghij"];
function A04() {
  const nav = useNavigate();
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [err, setErr] = useState("");
  const [expired, setExpired] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (a.length < 10) return setErr("A senha precisa ter no mínimo 10 caracteres.");
    if (COMMON.includes(a.toLowerCase())) return setErr("Essa senha é muito comum. Escolha outra.");
    if (a !== b) return setErr("As senhas não conferem.");
    nav(PUBLIC.login, { state: { msg: "Senha alterada" } });
  };
  if (expired) {
    return <Shell code="A04" title="Link vencido"><p className="mb-3 text-sm">Este link venceu. Peça um novo.</p><LinkBtn to={PUBLIC.recuperar}>Pedir novo link</LinkBtn></Shell>;
  }
  return (
    <Shell code="A04" title="Definir senha">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Nova senha" hint="Mínimo de 10 caracteres. Senhas comuns são recusadas."><Input type="password" value={a} onChange={(e) => setA(e.target.value)} required /></Field>
        <Field label="Confirmar senha"><Input type="password" value={b} onChange={(e) => setB(e.target.value)} required /></Field>
        {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
        <div className="flex gap-2"><Btn type="submit">Salvar</Btn><Btn variant="ghost" onClick={() => setExpired(true)}>Simular link vencido</Btn></div>
        <p className="text-xs text-slate-500">Validade do link: 24 horas (padrão assumido; ponto em aberto em B04).</p>
      </form>
    </Shell>
  );
}

// ---- A05 ----
function A05() {
  const ctx = useCtx();
  const mine = ctx.db.companies.filter((c) => ctx.user.companyIds.includes(c.id));
  if (mine.length === 0 || (ctx.user.role === "operacao" && ctx.user.areas.length === 0)) {
    return <A07 />;
  }
  const shortcuts = SCREENS.filter((s) => s.menu && (!s.adminOnly || ctx.isAdmin) && (s.area === "geral" || ctx.can(s.area, "ver")) && s.menu !== "Início" && s.menu !== "Administração").slice(0, 8);
  return (
    <>
      <PageHeader code="A05" title={`Boas-vindas, ${ctx.user.name}`} subtitle="Empresas e áreas liberadas para você." />
      <Card title="Seu acesso">
        <KV items={[["Empresas", mine.map((c) => c.name).join(", ")], ["Áreas", ctx.user.role === "admin" ? "Todas (administrador)" : ctx.user.areas.join(", ")]]} />
      </Card>
      <Card title="Atalhos" className="mt-3">
        <div className="flex flex-wrap gap-2">{shortcuts.map((s) => <LinkBtn key={s.code} to={p(s.paths[0])}>{s.title}</LinkBtn>)}</div>
      </Card>
      <div className="mt-4 flex gap-2">
        <LinkBtn variant="primary" to={p("")}>Começar</LinkBtn>
        {ctx.isAdmin && <LinkBtn to={p("/admin/configuracao-inicial")}>Configurar o sistema</LinkBtn>}
      </div>
    </>
  );
}

// ---- A06 ----
function A06() {
  const ctx = useCtx();
  const nav = useNavigate();
  const mine = ctx.db.companies.filter((c) => ctx.user.companyIds.includes(c.id));
  const go = (id: string) => { ctx.setCompany(id); nav(p("")); };
  const only = mine.length === 1 ? mine[0].id : null;
  useEffect(() => {
    if (only) {
      ctx.setCompany(only);
      nav(p(""), { replace: true });
    }
     
  }, [only]);
  if (mine.length === 0) return <A07 />;
  return (
    <>
      <PageHeader code="A06" title="Escolha a empresa" subtitle="A empresa atual fica sempre visível no topo." />
      <div className="grid gap-3 sm:grid-cols-3">
        {mine.map((c) => (
          <Card key={c.id} title={c.name}>
            <p className="mb-3 text-xs text-slate-500">CNPJ {c.cnpj}</p>
            <Btn onClick={() => go(c.id)}>Entrar em {c.name}</Btn>
          </Card>
        ))}
        {ctx.isAdmin && mine.length > 1 && (
          <Card title="Grupo (somente leitura)">
            <p className="mb-3 text-xs text-slate-500">Visão consolidada, sem ações operacionais.</p>
            <Btn variant="secondary" onClick={() => go("grupo")}>Ver Grupo</Btn>
          </Card>
        )}
      </div>
      <div className="mt-4"><Btn variant="ghost" onClick={() => { ctx.logout(); nav(PUBLIC.login); }}>Sair</Btn></div>
    </>
  );
}

// ---- A07 ----
function A07() {
  const ctx = useCtx();
  const nav = useNavigate();
  const hasAccess = ctx.user.companyIds.length > 0;
  return (
    <>
      <PageHeader code="A07" title="Sem acesso" />
      <Card>
        <p className="mb-3 text-sm">Você não tem acesso a esta área ou empresa. Fale com o administrador para liberar.</p>
        <div className="flex gap-2">
          {hasAccess && <LinkBtn to={p("")}>Voltar ao início</LinkBtn>}
          <Btn variant="secondary" onClick={() => { ctx.logout(); nav(PUBLIC.login); }}>Sair</Btn>
        </div>
      </Card>
    </>
  );
}

// ---- A08 ----
function A08() {
  const ctx = useCtx();
  const nav = useNavigate();
  return (
    <>
      <PageHeader code="A08" title="Meu perfil" />
      <Card>
        <KV items={[
          ["Nome", ctx.user.name], ["E-mail", ctx.user.email],
          ["Perfil", ctx.isAdmin ? "Administrador" : "Operação"],
          ["Empresas", ctx.db.companies.filter((c) => ctx.user.companyIds.includes(c.id)).map((c) => c.name).join(", ")],
          ["Áreas", ctx.isAdmin ? "Todas" : ctx.user.areas.join(", ")],
          ["Verificação em duas etapas", ctx.isAdmin ? <StatusBadge s="ativo" /> : "Opcional"],
        ]} />
        <div className="mt-4 flex flex-wrap gap-2">
          <LinkBtn to={PUBLIC.definirSenha}>Trocar senha</LinkBtn>
          <Btn variant="secondary" onClick={() => nav(PUBLIC.verificacao, { state: { userId: ctx.user.id } })}>Ativar verificação</Btn>
          <Btn variant="ghost" onClick={() => { ctx.logout(); nav(PUBLIC.login); }}>Sair</Btn>
        </div>
      </Card>
    </>
  );
}

// ---- A09 ----
function A09() {
  const ctx = useCtx();
  const db = ctx.db;
  const steps: { label: string; done: boolean; code: string; path: string }[] = [
    { label: "Empresas", done: db.companies.every((c) => !!c.cnpj), code: "N05", path: "/admin/empresas" },
    { label: "Provedor de NF-e e certificado", done: db.companies.every((c) => c.certificateOk), code: "N06", path: "/admin/empresas" },
    { label: "Locais", done: db.locations.length > 0, code: "C10", path: "/cadastros/locais" },
    { label: "Áreas e permissões", done: db.profiles.some((x) => x.role === "operacao" && x.grants.length > 0), code: "N03", path: "/admin/areas" },
    { label: "Usuários", done: db.profiles.length > 1, code: "N01", path: "/admin/usuarios" },
    { label: "Importação do H-Control", done: db.hcontrol.some((h) => h.status === "concluida"), code: "N07", path: "/admin/importacao" },
    { label: "Tipos de tributação", done: db.taxTypes.some((t) => t.active), code: "C12", path: "/cadastros/tributacao" },
    { label: "Conexão com CRM e Argos", done: false, code: "M01", path: "/integracoes" },
  ];
  const done = steps.filter((s) => s.done).length;
  return (
    <>
      <PageHeader code="A09" title="Configuração inicial" subtitle={`${done} de ${steps.length} passos concluídos. Emissão de nota real fica bloqueada até concluir empresas, provedor/certificado e tributação (hoje, provedor simulado).`} />
      <div className="mb-3 h-2 overflow-hidden rounded bg-slate-200"><div className="h-2 bg-sky-700" style={{ width: `${(done / steps.length) * 100}%` }} /></div>
      <Card>
        <ul className="divide-y divide-slate-100">
          {steps.map((s) => (
            <li key={s.label} className="flex items-center justify-between py-2 text-sm">
              <span>{s.done ? "✅" : "⬜"} {s.label} <span className="text-xs text-slate-400">({s.code})</span></span>
              <LinkBtn to={p(s.path)}>Abrir</LinkBtn>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

export const screens: Record<string, ComponentType> = { A01, A02, A03, A04, A05, A06, A07, A08, A09 };
