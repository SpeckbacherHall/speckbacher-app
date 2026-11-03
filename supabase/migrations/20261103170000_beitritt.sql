-- Beitrittsdatum (aus dem BTSK-Export) für Mitgliedsjubiläen und den Abgleich
alter table public.member_private add column joined_on date;
comment on column public.member_private.joined_on is 'Beitritt zur Kompanie';
