-- Phase 2: persönliches Kalender-Abo und Push-Erinnerung am Vortag
-- Geheime Werte (Push-Schlüssel, Zeitplan-Kennwort) liegen im Supabase Vault, nicht im Repository.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Persönlicher, geheimer Schlüssel für den Kalender-Abo-Link
alter table public.member_private
  add column calendar_token uuid not null default gen_random_uuid() unique;

create or replace function private.guard_member_private() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and not private.is_admin() then
    if new.member_id      is distinct from old.member_id
    or new.rifle_number   is distinct from old.rifle_number
    or new.email          is distinct from old.email
    or new.needs_post     is distinct from old.needs_post
    or new.calendar_token is distinct from old.calendar_token then
      raise exception 'Diese Angaben kann nur ein Admin ändern.';
    end if;
  end if;
  return new;
end
$$;

-- Push-Anmeldungen je Gerät
create table public.push_subscriptions (
  id          bigint generated always as identity primary key,
  member_id   uuid not null references public.members(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index push_subscriptions_member_id_idx on public.push_subscriptions (member_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon;

create policy "Eigene Geräte oder Admin lesen" on public.push_subscriptions
  for select to authenticated
  using (member_id = (select private.current_member_id()) or (select private.is_admin()));
create policy "Eigenes Gerät anmelden" on public.push_subscriptions
  for insert to authenticated with check (member_id = (select private.current_member_id()));
create policy "Eigenes Gerät aktualisieren" on public.push_subscriptions
  for update to authenticated
  using (member_id = (select private.current_member_id()))
  with check (member_id = (select private.current_member_id()));
create policy "Eigenes Gerät abmelden" on public.push_subscriptions
  for delete to authenticated using (member_id = (select private.current_member_id()));

-- Protokoll, damit jede Erinnerung nur einmal verschickt wird
create table public.reminder_log (
  event_id   bigint not null references public.events(id) on delete cascade,
  member_id  uuid not null references public.members(id) on delete cascade,
  sent_at    timestamptz not null default now(),
  primary key (event_id, member_id)
);
create index reminder_log_member_id_idx on public.reminder_log (member_id);
alter table public.reminder_log enable row level security;
revoke all on public.reminder_log from anon, authenticated;

-- Geheime Werte aus dem Vault, nur für die Edge Functions (service_role)
create function public.app_secret(secret_name text) returns text
language sql stable security definer set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = secret_name
$$;
revoke all on function public.app_secret(text) from public, anon, authenticated;
grant execute on function public.app_secret(text) to service_role;
