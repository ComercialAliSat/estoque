-- Séries (equipamentos), razão de movimentações imutável e histórico por data.
-- Dono, local, custódia, situação comercial e condição técnica são colunas separadas.

create table public.est_serials (
  id uuid primary key default gen_random_uuid(),
  serial text not null,
  iccid text,
  product_id uuid not null references public.est_products(id),
  owner_company_id uuid not null references public.est_companies(id), -- DONO
  location_id uuid references public.est_locations(id),               -- LOCAL
  custody text,                                                        -- CUSTÓDIA
  commercial text not null default 'disponivel' check (commercial in ('disponivel','reservado','vendido','comodato','em_transito','perdido','baixado')),
  technical text not null default 'novo' check (technical in ('novo','bom','quarentena','defeito','reparo','descartado')),
  inbound_id uuid references public.est_inbounds(id),
  lot_id uuid references public.est_inbound_lots(id),
  purchase_price numeric(14,2),
  allocated_cost numeric(14,2) not null default 0,
  assigned_cost numeric(14,2) not null default 0, -- reparo/RMA (RN-016)
  cost numeric(14,2),                             -- custo por série específica (sem custo médio)
  cost_status text not null default 'provisorio' check (cost_status in ('provisorio','definitivo')),
  reservation_id uuid,
  created_at timestamptz not null default now()
);
create unique index est_serials_serial_uq on public.est_serials (serial);                    -- série única
create unique index est_serials_iccid_uq on public.est_serials (iccid) where iccid is not null; -- ICCID único

create table public.est_serial_history (
  id bigint generated always as identity primary key,
  serial_id uuid not null references public.est_serials(id),
  at timestamptz not null default now(),
  user_id uuid references auth.users(id),
  field text not null check (field in ('dono','local','custodia','comercial','tecnica','custo')),
  from_value text, to_value text, ref text
);
create trigger est_serial_history_immutable before update or delete on public.est_serial_history
  for each row execute function public.est_block_mutation();

create table public.est_cost_adjustments (
  id bigint generated always as identity primary key,
  serial_id uuid not null references public.est_serials(id),
  at timestamptz not null default now(),
  user_id uuid not null references auth.users(id),
  from_cost numeric(14,2), to_cost numeric(14,2) not null,
  reason text not null check (length(trim(reason)) > 0) -- depois de fechada, só ajuste com motivo
);
create trigger est_cost_adj_immutable before update or delete on public.est_cost_adjustments
  for each row execute function public.est_block_mutation();

-- Razão: só acrescenta. Saldo é sempre derivado (view), nunca gravado.
create table public.est_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.est_companies(id),
  product_id uuid not null references public.est_products(id),
  serial_id uuid references public.est_serials(id),
  qty numeric not null check (qty > 0),
  kind text not null check (kind in ('entrada','saida','transferencia_saida','transferencia_entrada','devolucao','perda','ajuste','consumo_os','abertura','estorno')),
  from_location_id uuid references public.est_locations(id),
  to_location_id uuid references public.est_locations(id),
  outcome text check (outcome in ('venda','comodato','perda','consumo_os','devolucao_fornecedor','transferencia_externa','ajuste')),
  ref_type text not null, ref_id text not null,
  idempotency_key text not null unique,   -- clique duplo não duplica
  reason text,
  user_id uuid not null references auth.users(id),
  at timestamptz not null default now(),
  reversal_of uuid references public.est_movements(id),
  check (from_location_id is not null or to_location_id is not null),
  -- RN-011: nenhuma saída sem desfecho
  check (from_location_id is null or to_location_id is not null or outcome is not null)
);
create trigger est_movements_immutable before update or delete on public.est_movements
  for each row execute function public.est_block_mutation();
create unique index est_movements_one_reversal on public.est_movements (reversal_of) where reversal_of is not null;

create view public.est_balances with (security_invoker = true) as
select company_id, product_id, location_id, sum(delta) as qty from (
  select company_id, product_id, to_location_id as location_id, qty as delta from est_movements where to_location_id is not null
  union all
  select company_id, product_id, from_location_id, -qty from est_movements where from_location_id is not null
) t group by company_id, product_id, location_id;

-- Fechar a conferência: tudo ou nada, idempotente, exige preço em todas as séries (RN-020).
create or replace function public.est_close_conference(p_inbound uuid) returns int
language plpgsql security definer set search_path = public as $$
declare inb est_inbounds; n int := 0; r record; lot est_inbound_lots;
begin
  select * into inb from est_inbounds where id = p_inbound for update;
  if not found then raise exception 'Entrada não encontrada'; end if;
  if not est_can(inb.company_id, 'estoque', 'confirmar') then raise exception 'Sem permissão'; end if;
  if inb.status = 'fechada' then return 0; end if; -- idempotente
  if inb.status = 'estornada' then raise exception 'Entrada estornada'; end if;
  if exists (select 1 from est_inbound_scans where inbound_id = p_inbound and price is null) then
    raise exception 'RN-020: há séries sem preço de compra';
  end if;
  if exists (select 1 from est_divergences where inbound_id = p_inbound and status = 'pendente') then
    raise exception 'Há divergências aguardando aprovação';
  end if;
  for r in select * from est_inbound_scans where inbound_id = p_inbound loop
    select * into lot from est_inbound_lots where id = r.lot_id;
    insert into est_serials (serial, product_id, owner_company_id, location_id, inbound_id, lot_id, purchase_price, cost, cost_status)
    values (r.serial, lot.product_id, inb.company_id, inb.dest_location_id, p_inbound, lot.id,
            r.price * inb.fx, r.price * inb.fx,
            case when inb.import_id is not null and not exists (select 1 from est_imports i where i.id = inb.import_id and i.rateio_closed) then 'provisorio' else 'definitivo' end);
    insert into est_movements (company_id, product_id, serial_id, qty, kind, to_location_id, ref_type, ref_id, idempotency_key, user_id)
    select inb.company_id, lot.product_id, s.id, 1, 'entrada', inb.dest_location_id, 'entrada', p_inbound::text,
           'entrada:' || p_inbound || ':' || r.serial, auth.uid()
    from est_serials s where s.serial = r.serial;
    n := n + 1;
  end loop;
  update est_inbounds set status = 'fechada', closed_at = now() where id = p_inbound;
  insert into est_audit_log (user_id, company_id, action, ref, detail) values (auth.uid(), inb.company_id, 'entrada.fechada', p_inbound::text, n || ' séries');
  return n;
end $$;
