-- Anmelde-Erinnerung je Termin: zum eingestellten Zeitpunkt bekommen alle, die sich noch nicht
-- zurückgemeldet haben, eine Push-Nachricht. Rundschreiben lassen sich von der Startseite nehmen.

alter table public.events
  add column ask_at      timestamptz,   -- wann an die Anmeldung erinnert wird (leer = keine Erinnerung)
  add column ask_sent_at timestamptz;   -- wann sie verschickt wurde

-- Neuer Zeitpunkt → Erinnerung wieder offen
create or replace function private.reset_ask() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.ask_at is distinct from old.ask_at then new.ask_sent_at := null; end if;
  return new;
end
$$;
revoke execute on function private.reset_ask() from public, anon, authenticated;
create trigger reset_ask before update of ask_at on public.events
  for each row execute function private.reset_ask();

create index events_ask_idx on public.events (ask_at) where ask_sent_at is null and ask_at is not null;

-- Alle 15 Minuten prüfen, ob eine Anmelde-Erinnerung fällig ist (Aufruf nur, wenn wirklich eine ansteht)
select cron.schedule('anmelde-erinnerung', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://eaqxzkjffnxdtpxrfwtu.supabase.co/functions/v1/erinnerung',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{"mode":"ask"}'::jsonb,
    timeout_milliseconds := 10000
  ) where exists (select 1 from public.events
                  where ask_sent_at is null and ask_at <= now() and event_date >= (now() at time zone 'Europe/Vienna')::date)
$$);

-- Rundschreiben: Anzeige auf der Startseite für alle zurücksetzen
alter table public.newsletters add column hidden boolean not null default false;
