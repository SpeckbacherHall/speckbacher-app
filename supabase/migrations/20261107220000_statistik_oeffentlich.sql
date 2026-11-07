-- Abgegebene Schuss je Termin (z. B. Salven), für die Jahresstatistik
alter table public.events add column shots integer check (shots is null or shots >= 0);
-- Öffentliche Termine erscheinen im öffentlichen Kalender (ICS) für die Homepage
alter table public.events add column is_public boolean not null default false;
create index events_public_idx on public.events (event_date) where is_public;
