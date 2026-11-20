-- mFinance — Supabase şeması
-- Supabase panelinde: SQL Editor → New query → bu dosyanın tamamını yapıştır → Run

-- Her kullanıcının tüm defteri tek satırda (jsonb) durur.
create table if not exists public.user_state (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb       not null default '{}'::jsonb,
  version    bigint      not null default 0,      -- eşzamanlı yazmalara karşı iyimser kilit
  updated_at timestamptz not null default now()
);

-- Satır düzeyi güvenlik: herkes yalnızca KENDİ satırını görebilir ve değiştirebilir.
alter table public.user_state enable row level security;

drop policy if exists "Kendi verisini okur"      on public.user_state;
drop policy if exists "Kendi verisini ekler"     on public.user_state;
drop policy if exists "Kendi verisini günceller" on public.user_state;

create policy "Kendi verisini okur" on public.user_state
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "Kendi verisini ekler" on public.user_state
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "Kendi verisini günceller" on public.user_state
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Bir cihazdaki değişiklik diğerine anında düşsün (Realtime)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_state'
  ) then
    alter publication supabase_realtime add table public.user_state;
  end if;
end $$;
