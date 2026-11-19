-- SOUZA SPORTS — estoque compartilhado com convites
-- Execute DEPOIS de supabase-setup.sql, uma única vez.
-- O estoque antigo por usuário é preservado e migrado quando o proprietário cria
-- o primeiro espaço compartilhado. Cada usuário entra por um convite de uso único.

begin;

create table if not exists public.souza_sports_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'SOUZA SPORTS',
  owner_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.souza_sports_workspace_members (
  workspace_id uuid not null references public.souza_sports_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','collaborator')),
  added_at timestamptz not null default now(),
  primary key (workspace_id,user_id),
  unique (user_id)
);

create table if not exists public.souza_sports_workspace_invites (
  code_hash text primary key,
  workspace_id uuid not null references public.souza_sports_workspaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  role text not null default 'collaborator' check (role='collaborator'),
  expires_at timestamptz not null default (now() + interval '7 days'),
  redeemed_by uuid references auth.users(id) on delete set null,
  redeemed_at timestamptz
);

create table if not exists public.souza_sports_workspace_data (
  workspace_id uuid primary key references public.souza_sports_workspaces(id) on delete cascade,
  data jsonb not null default '{"products":[],"moves":[],"orders":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.souza_sports_workspaces enable row level security;
alter table public.souza_sports_workspace_members enable row level security;
alter table public.souza_sports_workspace_invites enable row level security;
alter table public.souza_sports_workspace_data enable row level security;

revoke all on public.souza_sports_workspaces from anon, authenticated;
revoke all on public.souza_sports_workspace_members from anon, authenticated;
revoke all on public.souza_sports_workspace_invites from anon, authenticated;
revoke all on public.souza_sports_workspace_data from anon, authenticated;
grant select on public.souza_sports_workspaces to authenticated;
grant select on public.souza_sports_workspace_members to authenticated;


drop policy if exists "SOUZA workspace members can view workspace" on public.souza_sports_workspaces;
drop policy if exists "SOUZA members can view workspace membership" on public.souza_sports_workspace_members;
drop policy if exists "SOUZA members can read shared data" on public.souza_sports_workspace_data;
drop policy if exists "SOUZA members can create shared data" on public.souza_sports_workspace_data;
drop policy if exists "SOUZA members can update shared data" on public.souza_sports_workspace_data;

create or replace function public.souza_is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.souza_sports_workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.get_souza_workspace_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.workspace_id
  from public.souza_sports_workspace_members m
  where m.user_id = (select auth.uid())
  limit 1;
$$;

create or replace function public.get_souza_user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.souza_sports_workspace_members m
  where m.user_id = (select auth.uid())
  limit 1;
$$;

create or replace function public.get_souza_workspace_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $getdata$
declare
  v_uid uuid := auth.uid();
  v_workspace uuid;
  v_role text;
  v_full_data jsonb;
  v_updated_at timestamptz;
  v_visible_data jsonb;
begin
  if v_uid is null then
    raise exception 'É necessário entrar na sua conta.';
  end if;

  select m.workspace_id,m.role into v_workspace,v_role
  from public.souza_sports_workspace_members m
  where m.user_id = v_uid
  limit 1;

  if v_workspace is null then
    raise exception 'Sua conta ainda não está vinculada ao estoque compartilhado.';
  end if;

  select d.data,d.updated_at into v_full_data,v_updated_at
  from public.souza_sports_workspace_data d
  where d.workspace_id = v_workspace;

  if not found then
    raise exception 'O estoque compartilhado ainda não foi inicializado.';
  end if;

  if v_role = 'owner' then
    v_visible_data := v_full_data;
  elsif v_role = 'collaborator' then
    v_visible_data := jsonb_build_object(
      'products',
      coalesce((
        select jsonb_agg(p.item - 'cost' order by p.ord)
        from jsonb_array_elements(v_full_data->'products') with ordinality as p(item,ord)
      ),'[]'::jsonb),
      'moves',
      coalesce((
        select jsonb_agg(m.item - 'cost' - 'supplier' - 'note' order by m.ord)
        from jsonb_array_elements(v_full_data->'moves') with ordinality as m(item,ord)
      ),'[]'::jsonb),
      'orders','[]'::jsonb
    );
  else
    raise exception 'Papel de usuário inválido.';
  end if;

  return jsonb_build_object('data',v_visible_data,'updated_at',v_updated_at);
end;
$getdata$;

revoke all on function public.get_souza_workspace_data() from PUBLIC, anon;
grant execute on function public.get_souza_workspace_data() to authenticated;

create or replace function public.ensure_souza_workspace()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_workspace uuid;
  v_legacy jsonb;
begin
  if v_uid is null then
    raise exception 'É necessário entrar na sua conta.';
  end if;

  select m.workspace_id into v_workspace
  from public.souza_sports_workspace_members m
  where m.user_id = v_uid
  limit 1;

  if v_workspace is not null then
    return v_workspace;
  end if;

  insert into public.souza_sports_workspaces(owner_id)
  values (v_uid)
  returning id into v_workspace;

  insert into public.souza_sports_workspace_members(workspace_id,user_id,role)
  values (v_workspace,v_uid,'owner');

  -- Preserva a cópia que já existia no aplicativo individual.
  select d.data into v_legacy
  from public.souza_sports_data d
  where d.user_id = v_uid;

  insert into public.souza_sports_workspace_data(workspace_id,data,updated_at)
  values (
    v_workspace,
    coalesce(v_legacy,'{"products":[],"moves":[],"orders":[]}'::jsonb),
    now()
  );

  return v_workspace;
end;
$$;

create or replace function public.create_souza_invite()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_workspace uuid;
  v_role text;
  v_code text;
begin
  if v_uid is null then
    raise exception 'É necessário entrar na sua conta.';
  end if;

  select m.workspace_id,m.role into v_workspace,v_role
  from public.souza_sports_workspace_members m
  where m.user_id = v_uid
  limit 1;

  if v_workspace is null or v_role <> 'owner' then
    raise exception 'Somente o administrador pode gerar convites.';
  end if;

  v_code := replace(gen_random_uuid()::text || gen_random_uuid()::text,'-','');

  insert into public.souza_sports_workspace_invites
    (code_hash,workspace_id,created_by,role,expires_at)
  values
    (encode(sha256(convert_to(v_code,'UTF8')),'hex'),v_workspace,v_uid,'collaborator',now()+interval '7 days');

  return v_code;
end;
$$;

create or replace function public.join_souza_workspace(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_workspace uuid;
  v_existing uuid;
begin
  if v_uid is null then
    raise exception 'É necessário entrar na sua conta antes de usar um convite.';
  end if;

  select m.workspace_id into v_existing
  from public.souza_sports_workspace_members m
  where m.user_id = v_uid
  limit 1;

  if v_existing is not null then
    raise exception 'Esta conta já está vinculada a um estoque.';
  end if;

  if p_code is null or length(trim(p_code)) < 32 then
    raise exception 'Código de convite inválido.';
  end if;

  select i.workspace_id into v_workspace
  from public.souza_sports_workspace_invites i
  where i.code_hash = encode(sha256(convert_to(trim(p_code),'UTF8')),'hex')
    and i.redeemed_at is null
    and i.expires_at > now()
  for update;

  if v_workspace is null then
    raise exception 'Convite inválido, expirado ou já utilizado. Peça um novo código ao administrador.';
  end if;

  insert into public.souza_sports_workspace_members(workspace_id,user_id,role)
  values (v_workspace,v_uid,'collaborator');

  update public.souza_sports_workspace_invites
  set redeemed_by = v_uid, redeemed_at = now()
  where code_hash = encode(sha256(convert_to(trim(p_code),'UTF8')),'hex');

  return v_workspace;
end;
$$;

create policy "SOUZA workspace members can view workspace"
on public.souza_sports_workspaces
for select to authenticated
using (public.souza_is_workspace_member(id));

create policy "SOUZA members can view workspace membership"
on public.souza_sports_workspace_members
for select to authenticated
using (public.souza_is_workspace_member(workspace_id));

revoke all on function public.souza_is_workspace_member(uuid) from PUBLIC, anon;
revoke all on function public.get_souza_workspace_id() from PUBLIC, anon;
revoke all on function public.get_souza_user_role() from PUBLIC, anon;
revoke all on function public.ensure_souza_workspace() from PUBLIC, anon;
revoke all on function public.create_souza_invite() from PUBLIC, anon;
revoke all on function public.join_souza_workspace(text) from PUBLIC, anon;

grant execute on function public.souza_is_workspace_member(uuid) to authenticated;
grant execute on function public.get_souza_workspace_id() to authenticated;
grant execute on function public.get_souza_user_role() to authenticated;
grant execute on function public.ensure_souza_workspace() to authenticated;
grant execute on function public.create_souza_invite() to authenticated;
grant execute on function public.join_souza_workspace(text) to authenticated;


-- Único caminho de escrita do estoque compartilhado. O servidor valida o papel
-- e impede que colaboradores alterem cadastro de produtos ou encomendas.
create or replace function public.save_souza_workspace_data(
  p_data jsonb,
  p_expected_updated_at timestamptz
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $savefn$
declare
  v_uid uuid := auth.uid();
  v_workspace uuid;
  v_role text;
  v_old_data jsonb;
  v_old_updated timestamptz;
  v_old_products jsonb;
  v_new_products jsonb;
  v_product jsonb;
  v_old_product jsonb;
  v_size text;
  v_old_qty integer;
  v_new_qty integer;
  v_delta integer;
  v_new_updated timestamptz;
  v_moves jsonb;
  v_old_moves_redacted jsonb;
  v_saved_products jsonb;
  v_new_moves jsonb;
  v_saved_moves jsonb;
  v_saved_data jsonb;
begin
  if v_uid is null then
    raise exception 'É necessário entrar na sua conta.';
  end if;

  select m.workspace_id,m.role into v_workspace,v_role
  from public.souza_sports_workspace_members m
  where m.user_id = v_uid
  limit 1;

  if v_workspace is null then
    raise exception 'Sua conta ainda não está vinculada ao estoque compartilhado.';
  end if;

  if jsonb_typeof(p_data) is distinct from 'object'
     or jsonb_typeof(p_data->'products') is distinct from 'array'
     or jsonb_typeof(p_data->'moves') is distinct from 'array'
     or jsonb_typeof(p_data->'orders') is distinct from 'array' then
    raise exception 'Formato de dados inválido.';
  end if;

  select d.data,d.updated_at into v_old_data,v_old_updated
  from public.souza_sports_workspace_data d
  where d.workspace_id = v_workspace
  for update;

  if not found then
    raise exception 'O estoque compartilhado ainda não foi inicializado.';
  end if;

  if p_expected_updated_at is not null and v_old_updated <> p_expected_updated_at then
    raise exception 'CONFLICT: o estoque foi alterado em outro aparelho. Atualize antes de salvar.';
  end if;

  if v_role = 'collaborator' then
    -- Colaboradores podem registrar vendas e entradas, que alteram quantidades.
    -- Não podem criar/remover produtos, alterar preços/cadastros, nem editar encomendas.
    select coalesce(jsonb_agg(t.p - 'qty' - 'cost' order by t.p->>'id'),'[]'::jsonb)
      into v_old_products
    from jsonb_array_elements(v_old_data->'products') as t(p);

    select coalesce(jsonb_agg(t.p - 'qty' - 'cost' order by t.p->>'id'),'[]'::jsonb)
      into v_new_products
    from jsonb_array_elements(p_data->'products') as t(p);

    if v_new_products is distinct from v_old_products then
      raise exception 'Acesso restrito: colaboradores não podem alterar o cadastro dos produtos.';
    end if;

    if (p_data->'orders') is distinct from '[]'::jsonb then
      raise exception 'Acesso restrito: somente o administrador pode alterar encomendas.';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(v_old_data->'moves') as oldm(oldmove)
      where not exists (
        select 1
        from jsonb_array_elements(p_data->'moves') as newm(newmove)
        where newm.newmove->>'id' = oldm.oldmove->>'id'
          and newm.newmove = oldm.oldmove - 'cost' - 'supplier' - 'note'
      )
    ) then
      raise exception 'Acesso restrito: o histórico de movimentações não pode ser apagado ou editado.';
    end if;

    for v_moves in
      select t.mv
      from jsonb_array_elements(p_data->'moves') as t(mv)
      where not exists (
        select 1 from jsonb_array_elements(v_old_data->'moves') as oldm(oldmove)
        where oldm.oldmove->>'id' = t.mv->>'id'
      )
    loop
      if v_moves->>'id' is null or length(v_moves->>'id') < 8 then
        raise exception 'Movimentação sem identificador válido.';
      end if;
      if v_moves->>'type' not in ('sale','entry') then
        raise exception 'Acesso restrito: colaboradores podem registrar apenas vendas e entradas.';
      end if;
      if coalesce(nullif(v_moves->>'qty','')::integer,0) <= 0 then
        raise exception 'A quantidade da movimentação deve ser maior que zero.';
      end if;
      if v_moves->>'size' not in ('P','M','G','GG','XG','2XL','3XL','4XL') then
        raise exception 'Tamanho inválido na movimentação.';
      end if;
      if not exists (
        select 1
        from jsonb_array_elements(p_data->'products') as products(product)
        where products.product->>'id' = v_moves->>'productId'
      ) then
        raise exception 'A movimentação referencia um produto inexistente.';
      end if;
    end loop;

    for v_product in select t.p from jsonb_array_elements(p_data->'products') as t(p)
    loop
      select p0 into v_old_product
      from jsonb_array_elements(v_old_data->'products') as t(p0)
      where t.p0->>'id' = v_product->>'id'
      limit 1;

      if v_old_product is null then
        raise exception 'Produto não encontrado no estoque compartilhado.';
      end if;

      foreach v_size in array array['P','M','G','GG','XG','2XL','3XL','4XL','16','18','20','22','24','26','28']
      loop
        v_old_qty := coalesce(nullif(v_old_product->'qty'->>v_size,'')::integer,0);
        v_new_qty := coalesce(nullif(v_product->'qty'->>v_size,'')::integer,0);

        if v_new_qty < 0 then
          raise exception 'Quantidade em estoque não pode ser negativa.';
        end if;

        select coalesce(sum(
          case when mv->>'type'='sale'
            then -coalesce(nullif(mv->>'qty','')::integer,0)
            else coalesce(nullif(mv->>'qty','')::integer,0)
          end
        ),0)
        into v_delta
        from jsonb_array_elements(p_data->'moves') as t(mv)
        where not exists (
          select 1 from jsonb_array_elements(v_old_data->'moves') as oldm(oldmove)
          where oldm.oldmove->>'id' = t.mv->>'id'
        )
          and t.mv->>'productId' = v_product->>'id'
          and t.mv->>'size' = v_size;

        if v_new_qty - v_old_qty <> v_delta then
          raise exception 'A quantidade de estoque deve corresponder às movimentações registradas.';
        end if;
      end loop;
    end loop;

    -- Reintroduz no servidor custos e encomendas, que nunca são enviados ao colaborador.
    select coalesce(jsonb_agg(oldp.p || jsonb_build_object('qty',newp.p->'qty') order by oldp.p->>'id'),'[]'::jsonb)
      into v_saved_products
    from jsonb_array_elements(v_old_data->'products') as oldp(p)
    join jsonb_array_elements(p_data->'products') as newp(p)
      on oldp.p->>'id' = newp.p->>'id';

    select coalesce(jsonb_agg(
      case when mv.item->>'type'='sale' then
        mv.item || jsonb_build_object('cost',coalesce((
          select nullif(prod.p->>'cost','')::numeric
          from jsonb_array_elements(v_old_data->'products') as prod(p)
          where prod.p->>'id' = mv.item->>'productId'
          limit 1
        ),0))
      else mv.item end
      order by mv.ord
    ),'[]'::jsonb)
      into v_new_moves
    from jsonb_array_elements(p_data->'moves') with ordinality as mv(item,ord)
    where not exists (
      select 1 from jsonb_array_elements(v_old_data->'moves') as oldm(oldmove)
      where oldm.oldmove->>'id' = mv.item->>'id'
    );

    v_saved_moves := (v_old_data->'moves') || v_new_moves;
    v_saved_data := jsonb_build_object(
      'products',v_saved_products,
      'moves',v_saved_moves,
      'orders',v_old_data->'orders'
    );
  elsif v_role = 'owner' then
    v_saved_data := p_data;
  else
    raise exception 'Papel de usuário inválido.';
  end if;

  update public.souza_sports_workspace_data
  set data = v_saved_data, updated_at = now()
  where workspace_id = v_workspace
  returning updated_at into v_new_updated;

  return v_new_updated;
end;
$savefn$;

revoke all on function public.save_souza_workspace_data(jsonb,timestamptz) from PUBLIC, anon;
grant execute on function public.save_souza_workspace_data(jsonb,timestamptz) to authenticated;

commit;
