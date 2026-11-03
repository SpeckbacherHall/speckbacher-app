-- Geburtstagsliste: alle Mitglieder sehen Name, Tag und Monat; das Alter nur Admins.
-- Jedes Mitglied kann seinen Geburtstag aus der Liste ausblenden.

alter table public.member_private add column hide_birthday boolean not null default false;
comment on column public.member_private.hide_birthday is 'Geburtstag nicht in der Geburtstagsliste zeigen';

create function public.birthday_list()
returns table (member_id uuid, first_name text, last_name text, birth_month int, birth_day int, birth_year int)
language sql stable security definer set search_path = ''
as $$
  select m.id, m.first_name, m.last_name,
         extract(month from p.birthday)::int,
         extract(day from p.birthday)::int,
         case when private.is_admin() then extract(year from p.birthday)::int end
  from public.members m
  join public.member_private p on p.member_id = m.id
  where private.current_member_id() is not null
    and m.active
    and p.birthday is not null
    and not p.hide_birthday
  order by 4, 5, m.last_name
$$;
revoke all on function public.birthday_list() from public, anon;
grant execute on function public.birthday_list() to authenticated;
