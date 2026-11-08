-- RLS: a empresa nunca depende só de filtro na tela; a permissão é conferida no servidor.
-- Padrão: tabela com company_id => leitura exige est_has_company; escrita exige est_can(area, ação).
-- A chave de serviço do Supabase (que ignora RLS) só é usada em Edge Functions.

do $$
declare t record;
begin
  for t in select c.table_name from information_schema.columns c
           where c.table_schema = 'public' and c.table_name like 'est\_%' escape '\' and c.column_name = 'company_id'
            and c.table_name not in ('est_user_grants','est_user_companies','est_audit_log','est_exports','est_params',
                                     'est_customer_companies','est_imports_hcontrol','est_movements')
  loop
    execute format('alter table public.%I enable row level security', t.table_name);
    execute format('create policy %I on public.%I for select using (est_has_company(company_id))', t.table_name || '_sel', t.table_name);
    execute format('create policy %I on public.%I for insert with check (est_can(company_id, ''estoque'', ''criar'') or est_can(company_id, ''operacoes'', ''criar'') or est_can(company_id, ''fiscal'', ''criar'') or est_can(company_id, ''financeiro'', ''criar''))', t.table_name || '_ins', t.table_name);
    execute format('create policy %I on public.%I for update using (est_can(company_id, ''estoque'', ''editar'') or est_can(company_id, ''operacoes'', ''editar'') or est_can(company_id, ''fiscal'', ''editar'') or est_can(company_id, ''financeiro'', ''editar''))', t.table_name || '_upd', t.table_name);
  end loop;
end $$;

-- Dono do dado (serial): enxerga por empresa dona.
alter table public.est_serials enable row level security;
create policy est_serials_sel on public.est_serials for select using (est_has_company(owner_company_id));
create policy est_serials_ins on public.est_serials for insert with check (est_can(owner_company_id, 'estoque', 'criar'));
create policy est_serials_upd on public.est_serials for update using (est_can(owner_company_id, 'estoque', 'editar'));

-- Custos: só administradores (ou quem tem permissão de custo). Colunas de custo ficam numa view protegida.
create view public.est_serials_visible with (security_invoker = true) as
select id, serial, iccid, product_id, owner_company_id, location_id, custody, commercial, technical, inbound_id, lot_id,
       case when est_can_see_cost(owner_company_id) then purchase_price end as purchase_price,
       case when est_can_see_cost(owner_company_id) then allocated_cost end as allocated_cost,
       case when est_can_see_cost(owner_company_id) then assigned_cost end as assigned_cost,
       case when est_can_see_cost(owner_company_id) then cost end as cost,
       cost_status, reservation_id, created_at
from public.est_serials;

-- Tabelas filhas: herdam o acesso pela empresa do pai.
do $$
declare x record;
begin
  for x in select * from (values
    ('est_purchase_order_items','order_id','est_purchase_orders'),
    ('est_inbound_lots','inbound_id','est_inbounds'),
    ('est_inbound_scans','inbound_id','est_inbounds'),
    ('est_divergences','inbound_id','est_inbounds'),
    ('est_import_documents','import_id','est_imports'),
    ('est_mother_code_items','mother_code_id','est_mother_codes'),
    ('est_reservation_serials','reservation_id','est_reservations'),
    ('est_invoice_items','invoice_id','est_invoices'),
    ('est_invoice_events','invoice_id','est_invoices'),
    ('est_outbound_items','outbound_id','est_outbounds'),
    ('est_transfer_items','transfer_id','est_transfers'),
    ('est_loss_items','loss_id','est_loss_requests'),
    ('est_contract_serials','contract_id','est_contracts'),
    ('est_work_order_supplies','work_order_id','est_work_orders'),
    ('est_inventory_counts','inventory_id','est_inventories')
  ) as v(child, fk, parent)
  loop
    execute format('alter table public.%I enable row level security', x.child);
    execute format('create policy %I on public.%I for select using (exists (select 1 from public.%I p where p.id = %I.%I and est_has_company(p.company_id)))',
      x.child || '_sel', x.child, x.parent, x.child, x.fk);
    execute format('create policy %I on public.%I for all using (exists (select 1 from public.%I p where p.id = %I.%I and (est_can(p.company_id,''estoque'',''editar'') or est_can(p.company_id,''operacoes'',''editar'') or est_can(p.company_id,''fiscal'',''editar''))))',
      x.child || '_mod', x.child, x.parent, x.child, x.fk);
  end loop;
end $$;

-- Catálogos compartilhados: leitura para qualquer usuário ativo; escrita para quem tem permissão de estoque em alguma empresa.
do $$
declare t text;
begin
  foreach t in array array['est_products','est_kit_components','est_services','est_customers','est_suppliers','est_product_tax'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (exists (select 1 from est_profiles p where p.user_id = auth.uid() and p.active))', t || '_sel', t);
    execute format('create policy %I on public.%I for all using (est_is_admin() or exists (select 1 from est_user_grants g where g.user_id = auth.uid() and g.area = ''estoque'' and g.can_edit))', t || '_mod', t);
  end loop;
end $$;

alter table public.est_customer_companies enable row level security;
create policy est_customer_companies_sel on public.est_customer_companies for select using (est_has_company(company_id));
create policy est_customer_companies_mod on public.est_customer_companies for all using (est_can(company_id, 'estoque', 'editar'));

-- Razão: leitura por empresa; inserção só pelas funções (security definer) ou quem confirma; sem update/delete (trigger).
alter table public.est_movements enable row level security;
create policy est_movements_sel on public.est_movements for select using (est_has_company(company_id));
create policy est_movements_ins on public.est_movements for insert with check (est_can(company_id, 'estoque', 'confirmar') or est_can(company_id, 'operacoes', 'confirmar'));

alter table public.est_serial_history enable row level security;
create policy est_serial_history_sel on public.est_serial_history for select using (exists (select 1 from est_serials s where s.id = serial_id and est_has_company(s.owner_company_id)));
alter table public.est_cost_adjustments enable row level security;
create policy est_cost_adj_sel on public.est_cost_adjustments for select using (exists (select 1 from est_serials s where s.id = serial_id and est_can_see_cost(s.owner_company_id)));

-- Administração: só administradores.
do $$
declare t text;
begin
  foreach t in array array['est_user_grants','est_user_companies','est_profiles','est_decision_points','est_integration_events','est_imports_hcontrol'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for all using (est_is_admin())', t || '_admin', t);
  end loop;
end $$;
create policy est_profiles_self on public.est_profiles for select using (user_id = auth.uid());
create policy est_user_companies_self on public.est_user_companies for select using (user_id = auth.uid());
create policy est_user_grants_self on public.est_user_grants for select using (user_id = auth.uid());

alter table public.est_companies enable row level security;
create policy est_companies_sel on public.est_companies for select using (est_has_company(id));
create policy est_companies_admin on public.est_companies for all using (est_is_admin() and est_has_company(id));

alter table public.est_audit_log enable row level security;
create policy est_audit_sel on public.est_audit_log for select using (est_is_admin() or (company_id is not null and est_can(company_id, 'auditoria', 'ver')));
create policy est_audit_ins on public.est_audit_log for insert with check (user_id = auth.uid());

alter table public.est_exports enable row level security;
create policy est_exports_sel on public.est_exports for select using (est_is_admin());
create policy est_exports_ins on public.est_exports for insert with check (user_id = auth.uid());

alter table public.est_params enable row level security;
create policy est_params_sel on public.est_params for select using (est_has_company(company_id));
create policy est_params_mod on public.est_params for all using (est_is_admin() and est_has_company(company_id));
