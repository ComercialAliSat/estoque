-- Fases 3 a 6: código-mãe, saídas, notas (simuladas), transferências, perdas, comodato, OS, assistência, kits, chips, integrações.

create table public.est_mother_codes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.est_companies(id),
  token text not null unique,
  box text not null,
  product_id uuid not null references public.est_products(id),
  version int not null default 1,
  status text not null default 'ativo' check (status in ('ativo','cancelado')),
  created_at timestamptz not null default now()
);
create table public.est_mother_code_items (
  mother_code_id uuid not null references public.est_mother_codes(id),
  serial text not null,
  primary key (mother_code_id, serial)
);

create table public.est_reservations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.est_companies(id),
  customer_id uuid references public.est_customers(id),
  crm_opportunity_id text,
  idempotency_key text not null unique,
  status text not null default 'reservada' check (status in ('reservada','liberada','consumida')),
  created_at timestamptz not null default now()
);
-- RN-018: reserva é SEMPRE por série específica (não existe reserva só por quantidade).
create table public.est_reservation_serials (
  reservation_id uuid not null references public.est_reservations(id),
  serial_id uuid not null references public.est_serials(id),
  active boolean not null default true,
  primary key (reservation_id, serial_id)
);
create unique index est_one_active_reservation_per_serial on public.est_reservation_serials (serial_id) where active;

create table public.est_invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.est_companies(id),
  operation text not null,
  number int,
  access_key text,
  status text not null default 'rascunho' check (status in ('rascunho','em_transmissao','autorizada','com_erro','nao_transmitida','cancelada','inutilizada')),
  simulated boolean not null default true check (simulated), -- provedor SIMULADO: toda nota é "SIMULADA, sem valor fiscal"
  customer_id uuid references public.est_customers(id),
  tax_type_id uuid references public.est_tax_types(id),
  total numeric(14,2) not null default 0,
  tax_total numeric(14,2) not null default 0,
  idempotency_key text not null unique,
  created_at timestamptz not null default now()
);
create unique index est_invoice_number_uq on public.est_invoices (company_id, number) where number is not null;

create table public.est_invoice_items (
  invoice_id uuid not null references public.est_invoices(id),
  line int not null, product_id uuid not null references public.est_products(id),
  serial text, qty numeric not null, unit_value numeric(14,2) not null, cfop text,
  primary key (invoice_id, line)
);
create table public.est_invoice_events (
  id bigint generated always as identity primary key,
  invoice_id uuid not null references public.est_invoices(id),
  at timestamptz not null default now(), type text not null, reason text, user_id uuid references auth.users(id)
);

create table public.est_outbounds (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.est_companies(id),
  number text not null,
  kind text not null check (kind in ('venda','comodato','transferencia','perda','os','devolucao_fornecedor')),
  customer_id uuid references public.est_customers(id),
  contract_id uuid, work_order_id uuid,
  invoice_id uuid references public.est_invoices(id),
  status text not null default 'rascunho' check (status in ('rascunho','separada','aguardando_nota','nota_autorizada','enviada','cancelada')),
  carrier text, tracking text,
  created_at timestamptz not null default now(),
  unique (company_id, number)
);
create table public.est_outbound_items (
  outbound_id uuid not null references public.est_outbounds(id),
  serial_id uuid not null references public.est_serials(id),
  unit_value numeric(14,2) not null default 0,
  primary key (outbound_id, serial_id)
);

create table public.est_transfers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.est_companies(id),
  to_company_id uuid references public.est_companies(id),
  kind text not null check (kind in ('entre_locais','entre_empresas','tecnico_terceiro')),
  from_location_id uuid not null references public.est_locations(id),
  to_location_id uuid not null references public.est_locations(id),
  status text not null default 'rascunho' check (status in ('rascunho','revisada','em_transito','recebida','divergente')),
  invoice_id uuid references public.est_invoices(id),
  sent_at timestamptz, received_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.est_transfer_items (
  transfer_id uuid not null references public.est_transfers(id),
  serial_id uuid not null references public.est_serials(id),
  transfer_value numeric(14,2) not null default 0, -- RN-013: editável por usuário autorizado, com autor/data na auditoria
  primary key (transfer_id, serial_id)
);

create table public.est_loss_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.est_companies(id),
  reason text not null check (length(trim(reason)) > 0),
  evidence text, value numeric(14,2) not null default 0,
  status text not null default 'pendente' check (status in ('pendente','aprovada','rejeitada')),
  requested_by uuid not null references auth.users(id),
  decided_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check (decided_by is null or decided_by <> requested_by)
);
create table public.est_loss_items (
  loss_id uuid not null references public.est_loss_requests(id),
  serial_id uuid not null references public.est_serials(id),
  primary key (loss_id, serial_id)
);

create table public.est_returns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.est_companies(id),
  origin text not null check (origin in ('cliente','comodato','fornecedor')),
  customer_id uuid references public.est_customers(id),
  reason text not null,
  status text not null default 'triagem' check (status in ('triagem','liberada','assistencia','baixa')),
  created_at timestamptz not null default now()
);

create table public.est_contracts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.est_companies(id),
  number text not null, customer_id uuid not null references public.est_customers(id),
  start_date date not null, end_date date not null,
  monthly_fee numeric(14,2) not null check (monthly_fee > 0), -- tipo M, base do payback
  status text not null default 'ativo' check (status in ('ativo','encerrado')),
  unique (company_id, number)
);
create table public.est_contract_serials (
  contract_id uuid not null references public.est_contracts(id),
  serial_id uuid not null references public.est_serials(id),
  returned boolean not null default false,
  primary key (contract_id, serial_id)
);

create table public.est_work_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.est_companies(id),
  number text not null,
  service_id uuid not null references public.est_services(id),
  customer_id uuid not null references public.est_customers(id),
  contract_id uuid references public.est_contracts(id),
  plate text, technician text, technician_kind text check (technician_kind in ('interno','terceiro')),
  charged numeric(14,2) not null default 0,
  tech_payment numeric(14,2), tech_payment_zero_reason text,
  status text not null default 'aberta' check (status in ('aberta','em_execucao','finalizada','cancelada')),
  origin text not null default 'manual' check (origin in ('crm','manual','comodato')),
  created_at timestamptz not null default now(),
  unique (company_id, number),
  check (tech_payment is distinct from 0 or tech_payment_zero_reason is not null)
);
create table public.est_work_order_supplies (
  id bigint generated always as identity primary key,
  work_order_id uuid not null references public.est_work_orders(id),
  product_id uuid references public.est_products(id),
  description text not null, qty numeric not null, unit_cost numeric(14,4) not null, from_stock boolean not null default false
);

create table public.est_assist_cases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.est_companies(id),
  serial_id uuid not null references public.est_serials(id),
  defect text not null, warranty_until date,
  status text not null default 'triagem' check (status in ('triagem','reparo','substituicao','sem_defeito','encerrado','baixa')),
  repair_cost numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);

create table public.est_kit_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.est_companies(id),
  kit_product_id uuid not null references public.est_products(id),
  qty int not null check (qty > 0),
  status text not null default 'aberta' check (status in ('aberta','em_montagem','concluida'))
);

create table public.est_chips (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.est_companies(id),
  iccid text not null unique check (iccid ~ '^[0-9]{19,20}$'),
  operator text, plan text,
  holder text not null default 'ali_sat' check (holder in ('ali_sat','cliente')),
  status text not null default 'livre' check (status in ('livre','vinculado')),
  cost numeric(14,2) not null default 0
);
create table public.est_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.est_companies(id),
  serial_id uuid not null references public.est_serials(id),
  chip_id uuid references public.est_chips(id),
  platform text, external_id text, plate text,
  customer_id uuid references public.est_customers(id),
  from_at timestamptz not null default now(), to_at timestamptz
);
create unique index est_links_external_uq on public.est_links (external_id) where external_id is not null and to_at is null;
create unique index est_links_chip_uq on public.est_links (chip_id) where chip_id is not null and to_at is null;

create table public.est_inventories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.est_companies(id),
  scope text not null, location_id uuid references public.est_locations(id),
  snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'contando' check (status in ('contando','revisao','ajustado')),
  created_at timestamptz not null default now()
);
create table public.est_inventory_counts (
  inventory_id uuid not null references public.est_inventories(id),
  serial text not null, primary key (inventory_id, serial)
);

create table public.est_integration_events (
  id uuid primary key default gen_random_uuid(),
  system text not null check (system in ('crm','argos','nfe','correios')),
  type text not null,
  idempotency_key text not null unique, -- reprocessar não duplica
  payload jsonb,
  status text not null default 'recebido' check (status in ('recebido','processado','erro','tratado')),
  attempts int not null default 0, error text,
  at timestamptz not null default now()
);

create table public.est_imports_hcontrol (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.est_companies(id),
  status text not null default 'previa' check (status in ('previa','concluida','descartada')),
  counts jsonb, errors jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
