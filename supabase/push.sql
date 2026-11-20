-- mFinance — bildirimler için tablolar
-- Supabase panelinde: SQL Editor → New query → bu dosyanın tamamını yapıştır → Run

-- Bildirim alacak cihazlar (her kullanıcı yalnızca kendi cihazlarını görür/yönetir)
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;

drop policy if exists "Kendi cihazlarını okur"      on public.push_subscriptions;
drop policy if exists "Kendi cihazını ekler"        on public.push_subscriptions;
drop policy if exists "Kendi cihazını günceller"    on public.push_subscriptions;
drop policy if exists "Kendi cihazını siler"        on public.push_subscriptions;

create policy "Kendi cihazlarını okur" on public.push_subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Kendi cihazını ekler" on public.push_subscriptions
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Kendi cihazını günceller" on public.push_subscriptions
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Kendi cihazını siler" on public.push_subscriptions
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Gönderilen hatırlatmalar (aynısı iki kez gitmesin). Politika YOK: yalnızca sunucu (gizli anahtar) erişir.
create table if not exists public.notify_log (
  user_id uuid not null references auth.users (id) on delete cascade,
  key     text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.notify_log enable row level security;
