-- Die Prüfung auf app_metadata.invited blockierte auch Konten, die ein Admin im
-- Supabase-Dashboard anlegt. Schutz vor fremden Registrierungen bietet die
-- ausgeschaltete Selbstregistrierung (Authentication → "Allow new users to sign up": aus).
-- Konten werden weiterhin nur verknüpft, wenn die E-Mail einem aktiven Mitglied gehört.
create or replace function private.link_member_on_signup() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  mid uuid;
begin
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
