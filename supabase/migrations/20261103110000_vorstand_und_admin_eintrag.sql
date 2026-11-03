-- 1. Vorstand: Kennzeichen bei Mitgliedern, eigene Terminart, nur für Vorstand und Admins sichtbar
-- 2. Admins tragen Rückmeldungen für Mitglieder ohne App ein (entered_by hält fest, wer eingetragen hat)

alter table public.members add column is_board boolean not null default false;
comment on column public.members.is_board is 'Gehört zum Vorstand: sieht Vorstandstermine';
update public.members set is_board = true where role_title = 'Vorstand';

alter table public.events drop constraint events_kind_check;
alter table public.events add constraint events_kind_check
  check (kind in ('kompanie', 'fahne', 'sonstig', 'vorstand'));

alter table public.responses add column entered_by uuid references public.members(id) on delete set null;
create index responses_entered_by_idx on public.responses (entered_by);

create function private.is_board() returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select is_board from public.members where user_id = (select auth.uid()) and active),
    false)
$$;
revoke all on function private.is_board() from public, anon;
grant execute on function private.is_board() to authenticated;

-- Termine: Vorstandstermine nur für Vorstand und Admins
drop policy "Mitglieder sehen Termine" on public.events;
create policy "Mitglieder sehen Termine" on public.events
  for select to authenticated using (
    (select private.current_member_id()) is not null
    and (kind <> 'vorstand' or (select private.is_board()) or (select private.is_admin()))
  );

-- Rückmeldungen: Mitglieder nur zu Terminen, die sie sehen; Admins für alle
drop policy "Eigene Rückmeldung abgeben" on public.responses;
create policy "Eigene Rückmeldung abgeben" on public.responses
  for insert to authenticated with check (
    (select private.is_admin())
    or (member_id = (select private.current_member_id())
        and exists (select 1 from public.events e where e.id = event_id))
  );
drop policy "Eigene Rückmeldung ändern" on public.responses;
create policy "Eigene Rückmeldung ändern" on public.responses
  for update to authenticated
  using (member_id = (select private.current_member_id()) or (select private.is_admin()))
  with check (
    (select private.is_admin())
    or (member_id = (select private.current_member_id())
        and exists (select 1 from public.events e where e.id = event_id))
  );

-- Absagen bei Kompanieausrückungen und Vorstandsterminen; eingetragen von = wer gespeichert hat
create or replace function private.check_response() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  k text;
  me uuid;
begin
  select kind into k from public.events where id = new.event_id;
  if new.status = 'no' and k not in ('kompanie', 'vorstand') then
    raise exception 'Bei diesem Termin ist nur eine Zusage möglich.';
  end if;
  me := private.current_member_id();
  new.entered_by := case when me is not null and me <> new.member_id then me else null end;
  new.updated_at := now();
  return new;
end
$$;
