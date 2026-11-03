-- pg_net gehört nicht ins public-Schema
drop extension if exists pg_net;
create extension pg_net with schema extensions;

-- Täglicher Zeitplan für die Erinnerung am Vortag.
-- Läuft um 16 und 17 Uhr UTC; die Funktion verschickt nur, wenn es in Wien 18 Uhr ist
-- (so passt es im Sommer und im Winter). Das Kennwort liest der Job aus dem Vault.
select cron.schedule(
  'erinnerung-vortag',
  '0 16,17 * * *',
  $$select net.http_post(
      url := 'https://eaqxzkjffnxdtpxrfwtu.supabase.co/functions/v1/erinnerung',
      headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
      body := '{}'::jsonb
  )$$
);

-- Einmalig im Vault anzulegen (Werte nicht ins Repository!):
--   select vault.create_secret('<öffentlicher VAPID-Schlüssel>', 'vapid_public');
--   select vault.create_secret('<privater VAPID-Schlüssel>',     'vapid_private');
--   select vault.create_secret('<zufälliges Kennwort>',          'cron_secret');
