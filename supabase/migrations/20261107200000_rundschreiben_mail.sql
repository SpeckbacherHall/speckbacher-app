-- Hinweis für Marketenderinnen je Termin; Rundschreiben per E-Mail (mit PDF im Anhang) über Microsoft 365.

alter table public.events add column note_marketenderinnen text;

-- Auswahl je Mitglied: Rundschreiben per E-Mail (an die E-Mail-Adresse in member_private)
alter table public.member_private add column newsletter_email boolean not null default false;

-- PDF des Rundschreibens (für Mail-Anhang) und Versandprotokoll
alter table public.newsletters add column pdf_path text;

create table public.newsletter_mails (
  id            bigint generated always as identity primary key,
  newsletter_id bigint not null references public.newsletters(id) on delete cascade,
  member_id     uuid not null references public.members(id) on delete cascade,
  email         text not null,
  status        text not null default 'offen' check (status in ('offen', 'gesendet', 'fehler')),
  error         text,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz
);
create index newsletter_mails_open_idx on public.newsletter_mails (id) where status = 'offen';
create index newsletter_mails_nl_idx on public.newsletter_mails (newsletter_id);
create index newsletter_mails_member_idx on public.newsletter_mails (member_id);
alter table public.newsletter_mails enable row level security;
revoke all on public.newsletter_mails from anon;
create policy "Admins sehen den Mailversand" on public.newsletter_mails
  for select to authenticated using ((select private.is_admin()));
-- Schreiben nur über die Edge Function (Service-Rolle)

-- Privater Speicher für die PDFs der Rundschreiben (nur Admins; der Versand liest mit der Service-Rolle)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rundschreiben', 'rundschreiben', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;
create policy "Admins lesen Rundschreiben-PDFs" on storage.objects
  for select to authenticated using (bucket_id = 'rundschreiben' and (select private.is_admin()));
create policy "Admins laden Rundschreiben-PDFs hoch" on storage.objects
  for insert to authenticated with check (bucket_id = 'rundschreiben' and (select private.is_admin()));
create policy "Admins ersetzen Rundschreiben-PDFs" on storage.objects
  for update to authenticated using (bucket_id = 'rundschreiben' and (select private.is_admin())) with check (bucket_id = 'rundschreiben' and (select private.is_admin()));
create policy "Admins löschen Rundschreiben-PDFs" on storage.objects
  for delete to authenticated using (bucket_id = 'rundschreiben' and (select private.is_admin()));

-- Jede Minute höchstens 25 Mails (Grenze von Exchange Online: 30 Nachrichten pro Minute)
select cron.schedule('rundschreiben-mail', '* * * * *', $$
  select net.http_post(
    url := 'https://eaqxzkjffnxdtpxrfwtu.supabase.co/functions/v1/rundschreiben',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{"mode":"poll"}'::jsonb,
    timeout_milliseconds := 5000
  ) where exists (select 1 from public.newsletter_mails where status = 'offen')
$$);
