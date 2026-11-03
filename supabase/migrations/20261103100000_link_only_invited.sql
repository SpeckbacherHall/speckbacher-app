-- Konten werden nur noch verknüpft, wenn ein Admin sie angelegt hat
-- (Edge Function "zugang" setzt app_metadata.invited) oder sie im Supabase-Dashboard
-- bestätigt angelegt wurden. Eine öffentliche Registrierung mit fremder E-Mail greift damit nicht.
create or replace function private.link_member_on_signup() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  mid uuid;
begin
  if coalesce(new.raw_app_meta_data->>'invited', 'false') <> 'true' and new.email_confirmed_at is null then
    raise exception 'Konten werden nur von der Kompanieführung angelegt.';
  end if;

  select mp.member_id into mid
  from public.member_private mp
  join public.members m on m.id = mp.member_id
  where mp.email = lower(new.email) and m.active and m.user_id is null;

  if mid is null then
    raise exception 'Diese E-Mail-Adresse ist nicht freigeschaltet.';
  end if;

  update public.members set user_id = new.id where id = mid;
  return new;
end
$$;
