# Speckbacher-App

Web-App der Speckbacher Schützenkompanie Hall in Tirol: Ausrückungen mit Zu- und Absage, Rückmeldungen für die Kompanieführung, Telefonliste.

Pilotversion, Stand November 2026.

## Aufbau

| Teil | Wo | Wozu |
|---|---|---|
| Web-App | dieses Repository, veröffentlicht über GitHub Pages | Oberfläche (`index.html`, `app.js`, `styles.css`) |
| Datenbank, Login | Supabase-Projekt `speckbacher-app` (Region Frankfurt) | Mitglieder, Termine, Rückmeldungen, Anmeldung mit E-Mail und Zugangscode |
| Zugangscodes | `supabase/functions/zugang` (Supabase Edge Function) | Admin erzeugt pro Mitglied einen Code |
| Datenbankschema | `supabase/migrations/` | Tabellen und Rechte, nachvollziehbar versioniert |

Es gibt keinen Build-Schritt: Die Dateien im Repository sind genau das, was online läuft.

## Rechte

- Anmelden kann sich nur, wer aktiv ist und von einem Admin einen Zugangscode bekommen hat. Es gibt keine Selbstregistrierung und keinen automatischen Mailversand.
- Mitglieder sehen alle Termine und die Namensliste, sagen für sich selbst zu oder ab und sehen nur ihre eigenen vertraulichen Daten.
- Admins sehen alle Rückmeldungen, Gewehrnummern und Telefonnummern und legen Termine an.
- Absagen sind nur bei Kompanieausrückungen möglich; bei Fahnenabordnungen und sonstigen Aktivitäten gibt es nur Zusagen.

Alle Regeln prüft die Datenbank selbst (Row-Level-Security). Der Schlüssel in `config.js` ist öffentlich und gibt ohne Anmeldung keinerlei Daten frei.

## Häufige Aufgaben

**Mitglied anlegen oder ändern:** Im Supabase-Dashboard unter *Table Editor* → `members` (Name, Rang, Funktion, aktiv, Admin) und `member_private` (E-Mail, Telefon, Gewehrnummer, Adresse). Die E-Mail-Adresse klein schreiben.

**Zugang vergeben:** In der App unter Admin → Mitglieder bei der Person auf „Zugang erzeugen“ tippen. Die fertige Nachricht mit Adresse, E-Mail und Code kopieren oder per WhatsApp schicken. „Neuer Code“ ersetzt einen verlorenen Code.

**Jemanden zum Admin machen:** In `members` das Feld `is_admin` auf `true` setzen.

**Mitglied sperren:** In `members` das Feld `active` auf `false` setzen.

**Änderung an der App veröffentlichen:** Änderung in den `main`-Branch committen; GitHub Pages aktualisiert die Seite nach ein bis zwei Minuten.

## Einmalige Einrichtung

1. GitHub: *Settings* → *Pages* → Source „Deploy from a branch“, Branch `main`, Ordner `/ (root)`.
2. Erster Admin-Zugang: Im Supabase-Dashboard unter *Authentication* → *Users* → *Add user* die Admin-E-Mail mit einem Passwort anlegen und „Auto Confirm User“ anhaken. Das Konto wird automatisch mit dem Mitglied verknüpft; alle weiteren Zugänge vergibt der Admin in der App.
3. Supabase: *Authentication* → *Sign In / Providers* → „Allow new users to sign up“ ausschalten. Zugänge entstehen dann nur noch über die App.
4. Optional eigene Adresse (z. B. app.speckbacher-schuetzen.at): CNAME-Eintrag beim Domain-Anbieter auf `speckbacherhall.github.io`, danach die Adresse unter *Settings* → *Pages* → *Custom domain* eintragen.
