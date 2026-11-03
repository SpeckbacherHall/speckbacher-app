-- Anwesenheit vor Ort: Admins haken ab, wer tatsächlich da war (unabhängig von der Rückmeldung).
-- Außerdem dürfen Termine ohne Uhrzeit angelegt werden ("Informationen folgen", "laut Einteilung").

alter table public.events alter column start_time drop not null;

create table public.attendance (
  event_id    bigint not null references public.events(id) on delete cascade,
  member_id   uuid not null references public.members(id) on delete cascade,
  present     boolean not null,
  checked_by  uuid references public.members(id) on delete set null,
  checked_at  timestamptz not null default now(),
  primary key (event_id, member_id)
);
create index attendance_member_id_idx on public.attendance (member_id);
create index attendance_checked_by_idx on public.attendance (checked_by);

alter table public.attendance enable row level security;
revoke all on public.attendance from anon;

create policy "Eigene Anwesenheit oder Admin lesen" on public.attendance
  for select to authenticated
  using (member_id = (select private.current_member_id()) or (select private.is_admin()));
create policy "Admins erfassen Anwesenheit" on public.attendance
  for insert to authenticated with check ((select private.is_admin()));
create policy "Admins ändern Anwesenheit" on public.attendance
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "Admins löschen Anwesenheit" on public.attendance
  for delete to authenticated using ((select private.is_admin()));

create function private.stamp_attendance() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.checked_by := private.current_member_id();
  new.checked_at := now();
  return new;
end
$$;
create trigger stamp_attendance
before insert or update on public.attendance
for each row execute function private.stamp_attendance();
