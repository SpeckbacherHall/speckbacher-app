-- Speckbacher-App: Grundschema für den Pilot
-- Mitglieder, Termine (Ausrückungen), Rückmeldungen, Rechte über Row-Level-Security

create schema if not exists private;

-- ---------- Tabellen ----------

-- Für alle Mitglieder sichtbare Angaben
create table public.members (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid unique references auth.users(id) on delete set null,
  first_name  text not null,
  last_name   text not null,
  role_title  text,                       -- Funktion, z. B. Hauptmann, Schütze, Marketenderin
  is_admin    boolean not null default false,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Vertrauliche Angaben: nur das Mitglied selbst und Admins
create table public.member_private (
  member_id     uuid primary key references public.members(id) on delete cascade,
  email         text unique check (email = lower(email)),
  phone         text,
  rifle_number  text,                     -- Gewehrnummer, nur Admins ändern
  address       text,
  birthday      date,
  needs_post    boolean not null default false  -- Rundschreiben per Post
);

create table public.events (
  id           bigint generated always as identity primary key,
  kind         text not null check (kind in ('kompanie', 'fahne', 'sonstig')),
  title        text not null,
  event_date   date not null,
  start_time   time not null,
  muster_time  time,                      -- Antreten
  place        text not null,
  dress        text,                      -- Adjustierung
  notes        text,
  created_by   uuid references public.members(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index events_event_date_idx on public.events (event_date);
create index events_created_by_idx on public.events (created_by);

create table public.responses (
  event_id    bigint not null references public.events(id) on delete cascade,
  member_id   uuid not null references public.members(id) on delete cascade,
  status      text not null check (status in ('yes', 'no')),
  updated_at  timestamptz not null default now(),
  primary key (event_id, member_id)
);
create index responses_member_id_idx on public.responses (member_id);

-- ---------- Hilfsfunktionen (nicht über die API erreichbar) ----------

create function private.current_member_id() returns uuid
language sql stable security definer set search_path = ''
as $$
  select id from public.members
  where user_id = (select auth.uid()) and active
$$;

create function private.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select is_admin from public.members where user_id = (select auth.uid()) and active),
    false)
$$;

-- Nur von Admins angelegte Mitglieder können sich anmelden:
-- beim ersten Login wird das Konto über die E-Mail mit dem Mitglied verknüpft.
create function private.link_member_on_signup() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  mid uuid;
begin
  select mp.member_id into mid
  from public.member_private mp
  join public.members m on m.id = mp.member_id
  where mp.email = lower(new.email) and m.active and m.user_id is null;

  if mid is null then
    raise exception 'Diese E-Mail-Adresse ist nicht freigeschaltet.';
  end if;

  update public.members set user_id = new.id where id = mid;
  return new;
end
$$;

create trigger link_member_on_signup
after insert on auth.users
for each row execute function private.link_member_on_signup();

-- Mitglieder dürfen Gewehrnummer, E-Mail und Postversand nicht selbst ändern
create function private.guard_member_private() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and not private.is_admin() then
    if new.member_id   is distinct from old.member_id
    or new.rifle_number is distinct from old.rifle_number
    or new.email        is distinct from old.email
    or new.needs_post   is distinct from old.needs_post then
      raise exception 'Diese Angaben kann nur ein Admin ändern.';
    end if;
  end if;
  return new;
end
$$;

create trigger guard_member_private
before update on public.member_private
for each row execute function private.guard_member_private();

-- Rückmeldelogik: Absagen nur bei Kompanieausrückungen
create function private.check_response() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  k text;
begin
  select kind into k from public.events where id = new.event_id;
  if new.status = 'no' and k <> 'kompanie' then
    raise exception 'Bei diesem Termin ist nur eine Zusage möglich.';
  end if;
  new.updated_at := now();
  return new;
end
$$;

create trigger check_response
before insert or update on public.responses
for each row execute function private.check_response();

revoke all on all functions in schema private from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.current_member_id(), private.is_admin() to authenticated;

-- ---------- Row-Level-Security ----------

alter table public.members        enable row level security;
alter table public.member_private enable row level security;
alter table public.events         enable row level security;
alter table public.responses      enable row level security;

revoke all on public.members, public.member_private, public.events, public.responses from anon;

-- members
create policy "Mitglieder sehen Mitgliederliste" on public.members
  for select to authenticated using ((select private.current_member_id()) is not null);
create policy "Admins legen Mitglieder an" on public.members
  for insert to authenticated with check ((select private.is_admin()));
create policy "Admins ändern Mitglieder" on public.members
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "Admins löschen Mitglieder" on public.members
  for delete to authenticated using ((select private.is_admin()));

-- member_private
create policy "Eigene Daten oder Admin lesen" on public.member_private
  for select to authenticated
  using (member_id = (select private.current_member_id()) or (select private.is_admin()));
create policy "Eigene Daten oder Admin ändern" on public.member_private
  for update to authenticated
  using (member_id = (select private.current_member_id()) or (select private.is_admin()))
  with check (member_id = (select private.current_member_id()) or (select private.is_admin()));
create policy "Admins legen Daten an" on public.member_private
  for insert to authenticated with check ((select private.is_admin()));
create policy "Admins löschen Daten" on public.member_private
  for delete to authenticated using ((select private.is_admin()));

-- events
create policy "Mitglieder sehen Termine" on public.events
  for select to authenticated using ((select private.current_member_id()) is not null);
create policy "Admins legen Termine an" on public.events
  for insert to authenticated with check ((select private.is_admin()));
create policy "Admins ändern Termine" on public.events
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "Admins löschen Termine" on public.events
  for delete to authenticated using ((select private.is_admin()));

-- responses
create policy "Eigene Rückmeldungen oder Admin lesen" on public.responses
  for select to authenticated
  using (member_id = (select private.current_member_id()) or (select private.is_admin()));
create policy "Eigene Rückmeldung abgeben" on public.responses
  for insert to authenticated
  with check (member_id = (select private.current_member_id()) or (select private.is_admin()));
create policy "Eigene Rückmeldung ändern" on public.responses
  for update to authenticated
  using (member_id = (select private.current_member_id()) or (select private.is_admin()))
  with check (member_id = (select private.current_member_id()) or (select private.is_admin()));
create policy "Eigene Rückmeldung zurückziehen" on public.responses
  for delete to authenticated
  using (member_id = (select private.current_member_id()) or (select private.is_admin()));
