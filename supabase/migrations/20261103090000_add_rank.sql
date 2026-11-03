-- Rang (z. B. Hauptmann, Patrouillenführer) getrennt von der Funktion (z. B. Vorstand, Marketenderin)
alter table public.members add column rank text;
comment on column public.members.role_title is 'Funktion, z. B. Vorstand, Marketenderin, Mitglied';
comment on column public.members.rank is 'Rang, z. B. Hauptmann, Leutnant, Patrouillenführer';
