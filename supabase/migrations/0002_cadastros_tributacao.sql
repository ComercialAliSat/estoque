-- Fase 1: cadastros, serviços e tributação (C01 a C15).
-- Produtos, clientes e fornecedores são compartilhados entre as empresas; locais e tributação são por empresa.

create table public.est_products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  unit text not null default 'UN',
  record_type text not null check (record_type in ('P','C')),
  klass text not null check (klass in ('equipamento','material','kit')),
  requires_serial boolean not null default false,
  requires_iccid boolean not null default false,
  warranty_months int not null default 0,
  ncm text check (ncm ~ '^[0-9]{8}$'),
  active boolean not null default true,
  version int not null default 1,
  created_at timestamptz not null default now()
);

create table public.est_kit_components (
  kit_product_id uuid not null references public.est_products(id),
  component_product_id uuid not null references public.est_products(id),
  qty int not null check (qty > 0),
  primary key (kit_product_id, component_product_id)
);

create table public.est_services (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  kind text not null check (kind in ('instalacao','manutencao','retirada','troca','administrativo')),
  default_price numeric(14,2) not null default 0,
  default_cost numeric(14,2) not null default 0,
  active boolean not null default true
);

create table public.est_customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  document text not null unique,
  state_reg text,
  taxpayer boolean not null default false,
  city text, uf text,
  origin text not null default 'manual' check (origin in ('crm','manual')),
  crm_id text unique,
  active boolean not null default true
);
create table public.est_customer_companies (
  customer_id uuid not null references public.est_customers(id),
  company_id uuid not null references public.est_companies(id),
  primary key (customer_id, company_id)
);

create table public.est_suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  country text not null check (country in ('BR','CN','OUTRO')),
  document text not null,
  currency text not null default 'BRL',
  terms text,
  active boolean not null default true
);

create table public.est_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.est_companies(id),
  name text not null,
  type text not null check (type in ('deposito','transito','tecnico','cliente','manutencao','quarentena')),
  responsible text,
  active boolean not null default true,
  unique (company_id, name)
);

-- Regras de tributação são DADOS editáveis (C12 a C14), nunca fixas no código. Cada edição cria nova versão.
create table public.est_tax_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.est_companies(id),
  name text not null,
  operation text not null check (operation in ('venda','comodato','remessa','retorno','devolucao','transferencia','perda')),
  uf_from text not null default '*', uf_to text not null default '*',
  taxpayer text not null default 'qualquer' check (taxpayer in ('sim','nao','qualquer')),
  partner_financier boolean not null default false,
  cfop text, cst text,
  icms numeric(7,4) not null default 0, ipi numeric(7,4) not null default 0,
  pis numeric(7,4) not null default 0, cofins numeric(7,4) not null default 0,
  message text,
  version int not null default 1,
  active boolean not null default true
);

create table public.est_product_tax (
  product_id uuid not null references public.est_products(id),
  uf text not null,
  ncm text check (ncm ~ '^[0-9]{8}$'),
  cfop text,
  version int not null default 1,
  primary key (product_id, uf)
);
