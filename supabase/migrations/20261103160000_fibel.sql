-- Fibel: Kapitel mit Texten zur Kompanie, ihrer Geschichte und zum Schützenwesen.
-- Mitglieder lesen veröffentlichte Kapitel, Admins schreiben und ordnen sie.

create table public.fibel_chapters (
  id          bigint generated always as identity primary key,
  title       text not null,
  body        text not null default '',
  sort        int not null default 0,
  published   boolean not null default false,
  updated_by  uuid references public.members(id) on delete set null,
  updated_at  timestamptz not null default now()
);
create index fibel_chapters_sort_idx on public.fibel_chapters (sort);
create index fibel_chapters_updated_by_idx on public.fibel_chapters (updated_by);
alter table public.fibel_chapters enable row level security;
revoke all on public.fibel_chapters from anon;

create policy "Mitglieder lesen veröffentlichte Kapitel" on public.fibel_chapters
  for select to authenticated using (
    (published and (select private.current_member_id()) is not null) or (select private.is_admin())
  );
create policy "Admins legen Kapitel an" on public.fibel_chapters
  for insert to authenticated with check ((select private.is_admin()));
create policy "Admins ändern Kapitel" on public.fibel_chapters
  for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "Admins löschen Kapitel" on public.fibel_chapters
  for delete to authenticated using ((select private.is_admin()));

create function private.stamp_fibel() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.updated_by := coalesce(private.current_member_id(), new.updated_by);
  new.updated_at := now();
  return new;
end
$$;
create trigger stamp_fibel before insert or update on public.fibel_chapters
for each row execute function private.stamp_fibel();
