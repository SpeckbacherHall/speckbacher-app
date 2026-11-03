-- Stammdaten aus dem BTSK-Stammdatenblatt: Mitgliedschaftsstatus, Beitragspflicht, Langjährigkeit,
-- weitere Telefonnummern, Kommentar sowie Laufbahn (Ränge, Funktionen, Mitgliedschaften) und Auszeichnungen.

alter table public.member_private
  add column membership_status text,          -- aktiv, ruhend, außerordentlich …
  add column fee_liable        boolean,       -- beitragspflichtig
  add column seniority_counts  boolean,       -- zählt für Langjährigkeit
  add column phone_private     text,
  add column phone_work        text,
  add column comment           text;

create table public.member_history (
  id            bigint generated always as identity primary key,
  member_id     uuid not null references public.members(id) on delete cascade,
  kind          text not null check (kind in ('mitgliedschaft','rang','funktion','auszeichnung','langjaehrigkeit','extern','schiessleistung','erinnerung','kompanie')),
  title         text not null,
  organisation  text,
  date_from     date,                 -- von bzw. erhalten am
  date_to       date,                 -- bis (leer = aktuell)
  detail        text,                 -- z. B. Status/Beitragspflicht bei Mitgliedschaften
  source        text not null default 'btsk',
  created_at    timestamptz not null default now()
);
create index member_history_member_idx on public.member_history (member_id, kind);
alter table public.member_history enable row level security;
revoke all on public.member_history from anon;

create policy "Eigene Laufbahn oder Admin lesen" on public.member_history
  for select to authenticated
  using (member_id = (select private.current_member_id()) or (select private.is_admin()));
create policy "Admins legen Laufbahn an" on public.member_history
  for insert to authenticated with check ((select private.is_admin()));
create policy "Admins ändern Laufbahn" on public.member_history
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "Admins löschen Laufbahn" on public.member_history
  for delete to authenticated using ((select private.is_admin()));

-- Mitglieder dürfen Status und Beitragsangaben nicht selbst ändern
create or replace function private.guard_member_private() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and not private.is_admin() then
    if new.member_id         is distinct from old.member_id
    or new.rifle_number      is distinct from old.rifle_number
    or new.email             is distinct from old.email
    or new.needs_post        is distinct from old.needs_post
    or new.calendar_token    is distinct from old.calendar_token
    or new.membership_status is distinct from old.membership_status
    or new.fee_liable        is distinct from old.fee_liable
    or new.seniority_counts  is distinct from old.seniority_counts
    or new.joined_on         is distinct from old.joined_on
    or new.comment           is distinct from old.comment then
      raise exception 'Diese Angaben kann nur ein Admin ändern.';
    end if;
  end if;
  return new;
end
$$;
