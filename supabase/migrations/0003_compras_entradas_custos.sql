-- Fase 2: compras, importação, entradas, conferência e custo por lote e série (D01-D09, E01-E08).

create table public.est_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.est_companies(id),
  number text not null,
  supplier_id uuid not null references public.est_suppliers(id),
  status text not null default 'rascunho' check (status in ('rascunho','aguardando','aprovado','rejeitado','emitido','parcial','recebido','encerrado','cancelado')),
  currency text not null default 'BRL',
  requested_by uuid not null references auth.users(id),
  approved_by uuid references auth.users(id),
  reject_reason text,
  created_at timestamptz not null default now(),
  unique (company_id, number),
  check (approved_by is null or approved_by <> requested_by) -- quem pede não aprova
);
create table public.est_purchase_order_items (
  order_id uuid not null references public.est_purchase_orders(id),
  product_id uuid not null references public.est_products(id),
  qty numeric not null check (qty > 0),
  unit_price numeric(14,4) not null check (unit_price >= 0),
  received numeric not null default 0,
  primary key (order_id, product_id)
);

create table public.est_imports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.est_companies(id),
  order_id uuid references public.est_purchase_orders(id),
  invoice_no text not null,
  supplier_id uuid not null references public.est_suppliers(id),
  currency text not null,
  fx numeric(14,6),
  status text not null default 'aberto' check (status in ('aberto','em_transito','recebido','fechado')),
  freight numeric(14,2) not null default 0, insurance numeric(14,2) not null default 0,
  taxes numeric(14,2) not null default 0, expenses numeric(14,2) not null default 0,
  criterion text not null default 'valor' check (criterion in ('valor','quantidade','peso')),
  rateio_closed boolean not null default false,
  eta date,
  check (currency = 'BRL' or fx is not null) -- moeda estrangeira exige câmbio
);

create table public.est_inbounds (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.est_companies(id),
  number text not null,
  supplier_id uuid not null references public.est_suppliers(id),
  nfe_key text not null,
  order_id uuid references public.est_purchase_orders(id),
  import_id uuid references public.est_imports(id),
  dest_location_id uuid not null references public.est_locations(id),
  currency text not null default 'BRL',
  fx numeric(14,6) not null default 1,
  status text not null default 'rascunho' check (status in ('rascunho','em_conferencia','divergente','fechada','estornada')),
  fiscal_status text not null default 'nao_verificada',
  conference_by uuid references auth.users(id),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  check (nfe_key ~ '^[0-9]{44}$'),
  unique (company_id, number)
);
-- Chave de NF-e única entre entradas ativas.
create unique index est_inbounds_key_uq on public.est_inbounds (nfe_key) where status <> 'estornada';

-- Lote = item da nota. O preço de compra é guardado aqui (RN-020).
create table public.est_inbound_lots (
  id uuid primary key default gen_random_uuid(),
  inbound_id uuid not null references public.est_inbounds(id),
  product_id uuid not null references public.est_products(id),
  qty numeric not null check (qty > 0),
  unit_price numeric(14,4),
  weight numeric not null default 0,
  allocated numeric(14,2) not null default 0
);

create table public.est_inbound_scans (
  inbound_id uuid not null references public.est_inbounds(id),
  serial text not null,
  lot_id uuid not null references public.est_inbound_lots(id),
  manual boolean not null default false,
  reason text,
  price numeric(14,4), -- preço da série (padrão: o do lote)
  price_changed_by uuid references auth.users(id),
  price_reason text,
  at timestamptz not null default now(),
  primary key (inbound_id, serial),
  check (not manual or reason is not null)
);

create table public.est_divergences (
  id uuid primary key default gen_random_uuid(),
  inbound_id uuid not null references public.est_inbounds(id),
  kind text not null check (kind in ('falta','excesso','item_errado','avaria')),
  lot_id uuid references public.est_inbound_lots(id),
  qty numeric not null,
  reason text not null check (length(trim(reason)) > 0),
  status text not null default 'pendente' check (status in ('pendente','aprovada','rejeitada')),
  requested_by uuid not null references auth.users(id),
  approved_by uuid references auth.users(id),
  check (approved_by is null or approved_by <> requested_by)
);

create table public.est_import_documents (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.est_imports(id),
  type text not null, name text not null,
  storage_path text not null, -- bucket privado; link temporário
  version int not null default 1,
  uploaded_by uuid not null references auth.users(id),
  at timestamptz not null default now()
);
