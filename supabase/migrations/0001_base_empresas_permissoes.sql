-- Módulo de estoque (Gestão Integrada Ali Sat). Tabelas com prefixo est_ no schema public.
-- Só depende de auth.users. Fase 0: empresas, perfis, permissões, auditoria, exportações, parâmetros.

create extension if not exists pgcrypto;

create table public.est_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  cnpj text not null unique,
  ie text,
  regime text not null check (regime in ('presumido','real')),
  invoice_series text not null default '1',
  nfe_provider text not null default 'simulado' check (nfe_provider in ('simulado','real')),
  nfe_env text not null default 'homologacao' check (nfe_env in ('homologacao','producao')),
  certificate_ref text, -- referência ao segredo (nunca o certificado em si)
  created_at timestamptz not null default now()
);

create table public.est_profiles (
  user_id uuid primary key references auth.users(id) on delete restrict,
  name text not null,
  email text not null unique,
  role text not null check (role in ('admin','operacao')),
  can_see_cost boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.est_user_companies (
  user_id uuid not null references public.est_profiles(user_id),
  company_id uuid not null references public.est_companies(id),
  primary key (user_id, company_id)
);

-- Permissões por usuário, empresa e área (modelo parte da área; valor final é por usuário).
create table public.est_user_grants (
  user_id uuid not null references public.est_profiles(user_id),
  company_id uuid not null references public.est_companies(id),
  area text not null check (area in ('estoque','financeiro','operacoes','fiscal','auditoria')),
  can_view boolean not null default false,
  can_create boolean not null default false,
  can_edit boolean not null default false,
  can_approve boolean not null default false,
  can_confirm boolean not null default false,
  can_export boolean not null default false,
  primary key (user_id, company_id, area)
);

create table public.est_audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid references auth.users(id),
  company_id uuid references public.est_companies(id),
  action text not null,
  ref text,
  detail text
);

create table public.est_exports (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid not null references auth.users(id),
  company_id uuid references public.est_companies(id),
  screen text not null,
  format text not null check (format in ('csv','xls')),
  row_count int not null
);

create table public.est_params (
  company_id uuid not null references public.est_companies(id),
  key text not null,
  value jsonb not null,
  version int not null default 1,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (company_id, key)
);

create table public.est_decision_points (
  id text primary key,
  title text not null,
  assumed text not null,
  screen text not null,
  decided boolean not null default false,
  note text,
  decided_by uuid references auth.users(id),
  decided_at timestamptz
);

-- ---------- Funções de segurança usadas pelas políticas RLS ----------
create or replace function public.est_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from est_profiles p where p.user_id = auth.uid() and p.role = 'admin' and p.active);
$$;

create or replace function public.est_has_company(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from est_profiles p join est_user_companies uc on uc.user_id = p.user_id
    where p.user_id = auth.uid() and p.active and uc.company_id = cid
  );
$$;

create or replace function public.est_can(cid uuid, a text, act text) returns boolean
language sql stable security definer set search_path = public as $$
  select est_has_company(cid) and (
    est_is_admin() or exists (
      select 1 from est_user_grants g
      where g.user_id = auth.uid() and g.company_id = cid and g.area = a and
        case act when 'ver' then g.can_view when 'criar' then g.can_create when 'editar' then g.can_edit
                 when 'aprovar' then g.can_approve when 'confirmar' then g.can_confirm
                 when 'exportar' then g.can_export else false end)
  );
$$;

create or replace function public.est_can_see_cost(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select est_has_company(cid) and (est_is_admin() or exists (
    select 1 from est_profiles p where p.user_id = auth.uid() and p.can_see_cost));
$$;

-- Auditoria é somente de acréscimo.
create or replace function public.est_block_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'Tabela imutável (%): correção só por estorno ou ajuste.', tg_table_name;
end $$;

create trigger est_audit_immutable before update or delete on public.est_audit_log
  for each row execute function public.est_block_mutation();
