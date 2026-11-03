-- Mitglieder ändern ihre Daten selbst; jede Änderung wird protokolliert und die Admins bekommen eine Push-Nachricht.

create table public.member_changes (
  id          bigint generated always as identity primary key,
  member_id   uuid not null references public.members(id) on delete cascade,
  changed_at  timestamptz not null default now(),
  changes     jsonb not null default '{}'::jsonb,   -- {"phone": {"from": "…", "to": "…"}, …}
  note        text,                                 -- Nachricht an den Schriftführer (z. B. neue E-Mail)
  seen_at     timestamptz,
  seen_by     uuid references public.members(id) on delete set null
);
create index member_changes_open_idx on public.member_changes (changed_at desc) where seen_at is null;
create index member_changes_member_idx on public.member_changes (member_id);
create index member_changes_seen_by_idx on public.member_changes (seen_by);
alter table public.member_changes enable row level security;
revoke all on public.member_changes from anon;

create policy "Admins lesen Änderungen" on public.member_changes
  for select to authenticated using ((select private.is_admin()));
create policy "Admins haken Änderungen ab" on public.member_changes
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "Mitglieder schicken eine Nachricht" on public.member_changes
  for insert to authenticated
  with check (member_id = (select private.current_member_id()) and changes = '{}'::jsonb and note is not null and seen_at is null);

-- Protokoll: Änderungen, die ein Mitglied an den eigenen Daten macht (nicht Admins)
create or replace function private.log_member_change() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  diff jsonb := '{}'::jsonb;
  k text;
begin
  if (select auth.uid()) is null or private.is_admin() then return new; end if;
  foreach k in array array['phone','phone_private','phone_work','address','birthday'] loop
    if (to_jsonb(old) -> k) is distinct from (to_jsonb(new) -> k) then
      diff := diff || jsonb_build_object(k, jsonb_build_object('from', to_jsonb(old) -> k, 'to', to_jsonb(new) -> k));
    end if;
  end loop;
  if diff <> '{}'::jsonb then
    insert into public.member_changes (member_id, changes) values (new.member_id, diff);
  end if;
  return new;
end
$$;
create trigger log_member_change after update on public.member_private
  for each row execute function private.log_member_change();

-- Push an die Admins über die Edge Function "erinnerung"
create or replace function private.notify_member_change() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform net.http_post(
    url := 'https://eaqxzkjffnxdtpxrfwtu.supabase.co/functions/v1/erinnerung',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := jsonb_build_object('mode', 'change', 'id', new.id)
  );
  return new;
end
$$;
create trigger notify_member_change after insert on public.member_changes
  for each row execute function private.notify_member_change();
