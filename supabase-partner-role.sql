-- SOUZA SPORTS: adicionar perfil de SÓCIO com os mesmos acessos operacionais do administrador.
-- Execute no Supabase > SQL Editor > New query, depois que supabase-shared-workspace.sql já tiver sido executado.

begin;

alter table public.souza_sports_workspace_members
  drop constraint if exists souza_sports_workspace_members_role_check;
alter table public.souza_sports_workspace_members
  add constraint souza_sports_workspace_members_role_check
  check (role in ('owner','partner','collaborator'));

alter table public.souza_sports_workspace_invites
  drop constraint if exists souza_sports_workspace_invites_role_check;
alter table public.souza_sports_workspace_invites
  alter column role set default 'partner';
alter table public.souza_sports_workspace_invites
  add constraint souza_sports_workspace_invites_role_check
  check (role in ('partner','collaborator'));

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

  if v_role in ('owner','partner') then
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

drop function if exists public.create_souza_invite();

create or replace function public.create_souza_invite(p_role text default 'partner')
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
    raise exception 'Somente o administrador principal pode gerar convites.';
  end if;

  if p_role not in ('partner','collaborator') then
    raise exception 'Tipo de acesso inválido.';
  end if;

  v_code := replace(gen_random_uuid()::text || gen_random_uuid()::text,'-','');

  insert into public.souza_sports_workspace_invites
    (code_hash,workspace_id,created_by,role,expires_at)
  values
    (encode(sha256(convert_to(v_code,'UTF8')),'hex'),v_workspace,v_uid,p_role,now()+interval '7 days');

  return v_code;
end;
$$;

revoke all on function public.create_souza_invite(text) from PUBLIC, anon;
grant execute on function public.create_souza_invite(text) to authenticated;


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
  v_member_role text;
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

  select i.workspace_id,i.role into v_workspace,v_member_role
  from public.souza_sports_workspace_invites i
  where i.code_hash = encode(sha256(convert_to(trim(p_code),'UTF8')),'hex')
    and i.redeemed_at is null
    and i.expires_at > now()
  for update;

  if v_workspace is null then
    raise exception 'Convite inválido, expirado ou já utilizado. Peça um novo código ao administrador.';
  end if;

  insert into public.souza_sports_workspace_members(workspace_id,user_id,role)
  values (v_workspace,v_uid,v_member_role);

  update public.souza_sports_workspace_invites
  set redeemed_by = v_uid, redeemed_at = now()
  where code_hash = encode(sha256(convert_to(trim(p_code),'UTF8')),'hex');

  return v_workspace;
end;
$$;

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
      if v_moves->>'size' not in ('P','M','G','GG','XG','2XL','3XL','4XL','16','18','20','22','24','26','28') then
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
      'orders',v_old_data->'orders',
      'procurements',coalesce(v_old_data->'procurements','[]'::jsonb)
    );
  elsif v_role in ('owner','partner') then
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

revoke all on function public.get_souza_workspace_data() from PUBLIC, anon;
grant execute on function public.get_souza_workspace_data() to authenticated;

commit;
