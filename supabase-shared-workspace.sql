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
grant select,insert,update on public.souza_sports_workspace_data to authenticated;

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
set search_path = public, auth, pg_temp
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
set search_path = public, auth, pg_temp
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
set search_path = public, auth, pg_temp
as $$
  select m.role
  from public.souza_sports_workspace_members m
  where m.user_id = (select auth.uid())
  limit 1;
$$;

create or replace function public.ensure_souza_workspace()
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
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
set search_path = public, auth, pg_temp
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
set search_path = public, auth, pg_temp
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

create policy "SOUZA members can read shared data"
on public.souza_sports_workspace_data
for select to authenticated
using (public.souza_is_workspace_member(workspace_id));

create policy "SOUZA members can create shared data"
on public.souza_sports_workspace_data
for insert to authenticated
with check (public.souza_is_workspace_member(workspace_id));

create policy "SOUZA members can update shared data"
on public.souza_sports_workspace_data
for update to authenticated
using (public.souza_is_workspace_member(workspace_id))
with check (public.souza_is_workspace_member(workspace_id));

revoke all on function public.souza_is_workspace_member(uuid) from public, anon;
revoke all on function public.get_souza_workspace_id() from public, anon;
revoke all on function public.get_souza_user_role() from public, anon;
revoke all on function public.ensure_souza_workspace() from public, anon;
revoke all on function public.create_souza_invite() from public, anon;
revoke all on function public.join_souza_workspace(text) from public, anon;

grant execute on function public.souza_is_workspace_member(uuid) to authenticated;
grant execute on function public.get_souza_workspace_id() to authenticated;
grant execute on function public.get_souza_user_role() to authenticated;
grant execute on function public.ensure_souza_workspace() to authenticated;
grant execute on function public.create_souza_invite() to authenticated;
grant execute on function public.join_souza_workspace(text) to authenticated;

commit;
