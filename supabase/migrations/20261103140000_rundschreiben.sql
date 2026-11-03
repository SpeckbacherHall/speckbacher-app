-- Rundschreiben: monatlicher Brief mit ausgewählten Terminen, Vorschau und freiem Text.
-- Wird in der App veröffentlicht (mit Push) und für Mitglieder mit Postversand als Serienbrief gedruckt.

-- Geschlecht für Anrede (Herrn/Frau, Lieber/Liebe)
alter table public.members add column gender text check (gender in ('m', 'w'));

-- "Teilnahmepflicht" / "Teilnahme erwünscht" ergibt sich aus der Terminart; aus den Hinweisen entfernen
update public.events
set notes = nullif(trim(both ' ·' from replace(replace(notes, 'Teilnahmepflicht', ''), 'Teilnahme erwünscht', '')), '')
where notes like '%Teilnahme%';

create table public.newsletters (
  id               bigint generated always as identity primary key,
  month            date not null,              -- erster Tag des Monats, für den das Rundschreiben gilt
  letter_date      date not null default current_date,
  intro            text not null,
  event_ids        bigint[] not null default '{}',   -- Termine des Monats
  preview_ids      bigint[] not null default '{}',   -- "Vorschau" auf den Folgemonat
  free_text        text,                       -- freier Text unter den Terminen
  signature        text not null,
  published_at     timestamptz,
  created_by       uuid references public.members(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index newsletters_month_idx on public.newsletters (month);
create index newsletters_created_by_idx on public.newsletters (created_by);
alter table public.newsletters enable row level security;
revoke all on public.newsletters from anon;

create policy "Mitglieder lesen veröffentlichte Rundschreiben" on public.newsletters
  for select to authenticated using (
    (published_at is not null and (select private.current_member_id()) is not null)
    or (select private.is_admin())
  );
create policy "Admins legen Rundschreiben an" on public.newsletters
  for insert to authenticated with check ((select private.is_admin()));
create policy "Admins ändern Rundschreiben" on public.newsletters
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "Admins löschen Rundschreiben" on public.newsletters
  for delete to authenticated using ((select private.is_admin()));
