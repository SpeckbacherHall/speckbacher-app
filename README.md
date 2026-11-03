# Speckbacher-App

Web-App der Speckbacher Schützenkompanie Hall in Tirol: Ausrückungen mit Zu- und Absage, Rückmeldungen für die Kompanieführung, Telefonliste.

Pilotversion, Stand November 2026.

## Aufbau

| Teil | Wo | Wozu |
|---|---|---|
| Web-App | dieses Repository, veröffentlicht über GitHub Pages | Oberfläche (`index.html`, `app.js`, `styles.css`), Logo `logo.svg`, Schrift Karla in `fonts/` |
| Datenbank, Login | Supabase-Projekt `speckbacher-app` (Region Frankfurt) | Mitglieder, Termine, Rückmeldungen, Anmeldung mit E-Mail und Zugangscode |
| Zugangscodes | `supabase/functions/zugang` (Supabase Edge Function) | Admin erzeugt pro Mitglied einen Code |
| Kalender-Abo | `supabase/functions/kalender` | Persönlicher Abo-Link mit allen zugesagten Terminen |
| Erinnerungen | `supabase/functions/erinnerung`, `sw.js`, Zeitplan `erinnerung-vortag` (pg_cron) | Push am Vortag um 18 Uhr für zugesagte Termine |
| Datenbankschema | `supabase/migrations/` | Tabellen und Rechte, nachvollziehbar versioniert |

Es gibt keinen Build-Schritt: Die Dateien im Repository sind genau das, was online läuft.

## Rechte

- Anmelden kann sich nur, wer aktiv ist und von einem Admin einen Zugangscode bekommen hat. Es gibt keine Selbstregistrierung und keinen automatischen Mailversand.
- Mitglieder sehen alle Termine und die Namensliste, sagen für sich selbst zu oder ab und sehen nur ihre eigenen vertraulichen Daten.
- Admins sehen alle Rückmeldungen, Gewehrnummern und Telefonnummern und legen Termine an.
- Absagen sind bei Kompanieausrückungen und Vorstandsterminen möglich; bei Fahnenabordnungen und sonstigen Aktivitäten gibt es nur Zusagen.
- Vorstandstermine sehen nur Mitglieder mit dem Häkchen „Vorstand“ sowie Admins.
- Admins können für jedes Mitglied eine Rückmeldung eintragen oder zurücksetzen (z. B. für Mitglieder ohne App); solche Einträge sind als „vom Admin eingetragen“ markiert.

Alle Regeln prüft die Datenbank selbst (Row-Level-Security). Der Schlüssel in `config.js` ist öffentlich und gibt ohne Anmeldung keinerlei Daten frei.

## Häufige Aufgaben

**Mitglied anlegen oder ändern:** In der App unter Admin → Mitglieder auf den Namen tippen (oder „Neues Mitglied“). Dort lassen sich Name, Rang, Funktion, E-Mail, Telefon, Gewehrnummer, Adresse, Geburtstag, Postversand, Aktiv und Admin ändern. Eine geänderte E-Mail gilt sofort auch für die Anmeldung.

**Zugang vergeben:** In der App unter Admin → Mitglieder bei der Person auf „Zugang erzeugen“ tippen. Die fertige Nachricht mit Adresse, E-Mail und Code kopieren oder per WhatsApp schicken. „Neuer Code“ ersetzt einen verlorenen Code.

**Termin ändern:** Admin → Rückmeldungen → Termin öffnen → „Bearbeiten“.

**Anwesenheit erfassen:** Termin öffnen → „Anwesenheit“ (am Termintag und danach öffnet sich diese Ansicht automatisch). „Alle Zugesagten als ‚da‘“ setzen, dann einzelne Personen korrigieren und zum Schluss „Übrige als ‚nicht da‘“. Vergangene Termine der letzten zwölf Monate findest du unter Rückmeldungen → „Vergangene“. Der CSV-Export enthält die Anwesenheit.

**Erinnerungen und Kalender (Mitglieder):** Oben bei den Ausrückungen „Erinnerungen & Kalender“. Am iPhone funktionieren Erinnerungen nur, wenn die App über „Zum Home-Bildschirm“ installiert ist. Die Push-Schlüssel und das Kennwort des Zeitplans liegen im Supabase Vault (`vapid_public`, `vapid_private`, `cron_secret`).

**Rückmeldung für jemanden ohne App:** Termin öffnen, beim Namen unter „Keine Rückmeldung“ auf „Zusage“ oder „Absage“ tippen.

**Admin, Vorstand oder Sperre:** In der Mitgliederbearbeitung „Admin“, „Vorstand“ bzw. „Aktiv“ an- oder abhaken.

**Änderung an der App veröffentlichen:** Änderung in den `main`-Branch committen; GitHub Pages aktualisiert die Seite nach ein bis zwei Minuten.

## Einmalige Einrichtung

1. GitHub: *Settings* → *Pages* → Source „Deploy from a branch“, Branch `main`, Ordner `/ (root)`.
2. Erster Admin-Zugang: Im Supabase-Dashboard unter *Authentication* → *Users* → *Add user* die Admin-E-Mail mit einem Passwort anlegen und „Auto Confirm User“ anhaken. Das Konto wird automatisch mit dem Mitglied verknüpft; alle weiteren Zugänge vergibt der Admin in der App.
3. Supabase: *Authentication* → *Sign In / Providers* → „Allow new users to sign up“ ausschalten. Zugänge entstehen dann nur noch über die App.
4. Optional eigene Adresse (z. B. app.speckbacher-schuetzen.at): CNAME-Eintrag beim Domain-Anbieter auf `speckbacherhall.github.io`, danach die Adresse unter *Settings* → *Pages* → *Custom domain* eintragen.
