# Speckbacher-App

Web-App der Speckbacher Schützenkompanie Hall in Tirol: Ausrückungen mit Zu- und Absage, Rückmeldungen für die Kompanieführung, Telefonliste.

Pilotversion, Stand November 2026.

## Aufbau

| Teil | Wo | Wozu |
|---|---|---|
| Web-App | dieses Repository, veröffentlicht über GitHub Pages | Oberfläche (`index.html`, `app.js`, `styles.css`) |
| Datenbank, Login | Supabase-Projekt `speckbacher-app` (Region Frankfurt) | Mitglieder, Termine, Rückmeldungen, Anmeldung per E-Mail-Link |
| Datenbankschema | `supabase/migrations/` | Tabellen und Rechte, nachvollziehbar versioniert |

Es gibt keinen Build-Schritt: Die Dateien im Repository sind genau das, was online läuft.

## Rechte

- Anmelden kann sich nur, wessen E-Mail-Adresse in der Mitgliederverwaltung eingetragen ist und wer aktiv ist.
- Mitglieder sehen alle Termine und die Namensliste, sagen für sich selbst zu oder ab und sehen nur ihre eigenen vertraulichen Daten.
- Admins sehen alle Rückmeldungen, Gewehrnummern und Telefonnummern und legen Termine an.
- Absagen sind nur bei Kompanieausrückungen möglich; bei Fahnenabordnungen und sonstigen Aktivitäten gibt es nur Zusagen.

Alle Regeln prüft die Datenbank selbst (Row-Level-Security). Der Schlüssel in `config.js` ist öffentlich und gibt ohne Anmeldung keinerlei Daten frei.

## Häufige Aufgaben

**Mitglied anlegen oder ändern:** Im Supabase-Dashboard unter *Table Editor* → `members` (Name, Rang, Funktion, aktiv, Admin) und `member_private` (E-Mail, Telefon, Gewehrnummer, Adresse). Die E-Mail-Adresse klein schreiben.

**Jemanden zum Admin machen:** In `members` das Feld `is_admin` auf `true` setzen.

**Mitglied sperren:** In `members` das Feld `active` auf `false` setzen.

**Änderung an der App veröffentlichen:** Änderung in den `main`-Branch committen; GitHub Pages aktualisiert die Seite nach ein bis zwei Minuten.

## Einmalige Einrichtung

1. GitHub: *Settings* → *Pages* → Source „Deploy from a branch“, Branch `main`, Ordner `/ (root)`.
2. Supabase: *Authentication* → *URL Configuration*: „Site URL“ und „Redirect URLs“ auf die GitHub-Pages-Adresse setzen.
3. Supabase: *Authentication* → *Emails* → *SMTP Settings*: eigenen Mailserver eintragen. Ohne eigenen Mailserver verschickt Supabase Anmelde-Links nur an Mitglieder des Supabase-Teams.
