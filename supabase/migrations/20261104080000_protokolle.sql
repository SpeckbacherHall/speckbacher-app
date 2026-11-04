-- Vorstandsprotokolle: Archiv (für alle Vorstandsmitglieder) und Protokollerstellung aus
-- Mitschrift und Audioaufnahme (Azure Spracherkennung + Azure OpenAI) für Admins.

create table public.protocols (
  id             bigint generated always as identity primary key,
  title          text not null default 'Vorstandssitzung',
  meeting_date   date not null,
  date_is_month  boolean not null default false,   -- importiert, nur Monat bekannt
  number         int,                               -- laufende Nummer im Jahr
  event_id       bigint references public.events(id) on delete set null,
  status         text not null default 'entwurf' check (status in ('entwurf', 'final')),
  source         text not null default 'app' check (source in ('app', 'import')),
  -- Kopf des Protokolls
  chair          text,     -- Sitzungsführung
  recorder       text,     -- Protokollführung
  present        text,     -- eine Person pro Zeile
  absent         text,
  ended_at       text,     -- Sitzungsende, z. B. 20:54
  body           text not null default '',   -- Protokolltext (## Abschnitt, ### Person, - Punkt, Einrückung = Unterpunkt)
  -- Arbeitsmaterial (wird beim Abschluss gelöscht)
  notes          text,     -- Mitschrift
  transcript     text,     -- Abschrift der Aufnahme
  audio_parts    int not null default 0,
  audio_type     text,
  audio_name     text,
  job_state      text check (job_state in ('hochgeladen', 'transkription', 'entwurf', 'schreibt', 'fertig', 'fehler')),
  job_ref        text,     -- Adresse des Azure-Transkriptionsauftrags
  job_error      text,
  job_started_at timestamptz,
  -- Archiv
  pdf_path       text,
  original_name  text,
  created_by     uuid references public.members(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  finalized_at   timestamptz
);
create index protocols_date_idx on public.protocols (meeting_date desc);
create index protocols_job_idx on public.protocols (job_state) where job_state in ('transkription', 'entwurf', 'schreibt');
create index protocols_event_idx on public.protocols (event_id);
create index protocols_created_by_idx on public.protocols (created_by);
alter table public.protocols enable row level security;
revoke all on public.protocols from anon;

create policy "Vorstand liest finale Protokolle, Admins alle" on public.protocols
  for select to authenticated
  using ((select private.is_admin()) or (status = 'final' and (select private.is_board())));
create policy "Admins legen Protokolle an" on public.protocols
  for insert to authenticated with check ((select private.is_admin()));
create policy "Admins ändern Protokolle" on public.protocols
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "Admins löschen Protokolle" on public.protocols
  for delete to authenticated using ((select private.is_admin()));

create or replace function private.stamp_protocol() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then new.created_by := coalesce(private.current_member_id(), new.created_by); end if;
  if new.status = 'final' and (tg_op = 'INSERT' or old.status <> 'final') then new.finalized_at := now(); end if;
  return new;
end
$$;
revoke execute on function private.stamp_protocol() from public, anon, authenticated;
create trigger stamp_protocol before insert or update on public.protocols
  for each row execute function private.stamp_protocol();

-- Privater Speicher: audio/<id>/part-000 … (nur Admins), pdf/<id>.pdf (Vorstand liest)
insert into storage.buckets (id, name, public, file_size_limit)
values ('vorstand', 'vorstand', false, 52428800)
on conflict (id) do nothing;

create policy "Vorstand liest Protokoll-PDFs, Admins alles" on storage.objects
  for select to authenticated
  using (bucket_id = 'vorstand' and ((select private.is_admin()) or ((storage.foldername(name))[1] = 'pdf' and (select private.is_board()))));
create policy "Admins laden in den Vorstandsspeicher" on storage.objects
  for insert to authenticated with check (bucket_id = 'vorstand' and (select private.is_admin()));
create policy "Admins ersetzen im Vorstandsspeicher" on storage.objects
  for update to authenticated using (bucket_id = 'vorstand' and (select private.is_admin())) with check (bucket_id = 'vorstand' and (select private.is_admin()));
create policy "Admins löschen im Vorstandsspeicher" on storage.objects
  for delete to authenticated using (bucket_id = 'vorstand' and (select private.is_admin()));

-- Alle zwei Minuten: laufende Transkriptionen abfragen und Entwürfe schreiben
select cron.schedule('protokoll-verarbeitung', '*/2 * * * *', $$
  select net.http_post(
    url := 'https://eaqxzkjffnxdtpxrfwtu.supabase.co/functions/v1/protokoll',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{"mode":"poll"}'::jsonb,
    timeout_milliseconds := 5000
  ) where exists (select 1 from public.protocols where job_state in ('transkription', 'entwurf', 'schreibt'))
$$);

-- Hinweise der KI an den Schriftführer (Unklarheiten, fehlende Angaben)
alter table public.protocols add column hints text;
