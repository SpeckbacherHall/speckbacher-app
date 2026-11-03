-- Trigger-Funktionen im Schema private brauchen keine Ausführungsrechte für App-Rollen
-- (Trigger feuern unabhängig davon; direkt aufrufen soll sie niemand).
revoke execute on function private.log_member_change(), private.notify_member_change(), private.stamp_attendance(), private.stamp_fibel() from public, anon, authenticated;
-- Künftige Funktionen im Schema private standardmäßig nicht für alle ausführbar
alter default privileges in schema private revoke execute on functions from public;
