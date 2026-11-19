-- SOUZA SPORTS: estrutura de sincronização online
-- Execute este arquivo UMA VEZ no Supabase > SQL Editor > New query.
-- Uma linha JSON por conta. RLS garante que cada usuário leia/edite apenas a própria linha.

create table if not exists public.souza_sports_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{"products":[],"moves":[],"orders":[]}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.souza_sports_data enable row level security;

-- Começa sem permissões públicas. Apenas usuários autenticados recebem acesso.
revoke all on table public.souza_sports_data from anon, authenticated;
grant select, insert, update on table public.souza_sports_data to authenticated;

drop policy if exists "SOUZA SPORTS: ler apenas os próprios dados" on public.souza_sports_data;
create policy "SOUZA SPORTS: ler apenas os próprios dados"
on public.souza_sports_data
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "SOUZA SPORTS: inserir apenas os próprios dados" on public.souza_sports_data;
create policy "SOUZA SPORTS: inserir apenas os próprios dados"
on public.souza_sports_data
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "SOUZA SPORTS: atualizar apenas os próprios dados" on public.souza_sports_data;
create policy "SOUZA SPORTS: atualizar apenas os próprios dados"
on public.souza_sports_data
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- Não é concedido acesso anônimo nem permissão de apagar a linha pela aplicação.
