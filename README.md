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
| Rundschreiben | `rundschreiben.js`, `letter.css`, Tabelle `newsletters` | Monatsbrief nach Briefvorlage, Veröffentlichung mit Push, Serienbrief |
| Fibel | `fibel.js`, Tabelle `fibel_chapters` | Kapitel zum Lesen, Bearbeitung durch Admins |
| Meine Daten | `meinedaten.js`, Tabelle `member_changes`, Trigger `log_member_change`/`notify_member_change` | Mitglieder ändern Telefon, Adresse, Geburtstag selbst; Admins bekommen eine Push-Nachricht |
| Vorstandsprotokolle | `protokolle.js`, Tabelle `protocols`, Speicher `vorstand`, `supabase/functions/protokoll`, Zeitplan `protokoll-verarbeitung` | Archiv (PDF) für den Vorstand; Entwurf aus Mitschrift und Aufnahme über Azure Speech + Azure OpenAI |
| Laufbahn | `laufbahn.js`, Tabelle `member_history` | Ränge, Funktionen, Auszeichnungen, Langjährigkeit und Schießleistung aus dem BTSK-Stammdatenblatt |
| Erinnerungen | `supabase/functions/erinnerung`, `sw.js`, Zeitplan `erinnerung-vortag` (pg_cron) | Push am Vortag um 18 Uhr für zugesagte Termine |
| Datenbankschema | `supabase/migrations/` | Tabellen und Rechte, nachvollziehbar versioniert |

Es gibt keinen Build-Schritt: Die Dateien im Repository sind genau das, was online läuft. Die Supabase-Bibliothek liegt fest im Ordner `vendor/` (kein Nachladen von fremden Servern); eine Content-Security-Policy in `index.html` erlaubt Skripte nur von der eigenen Adresse.

## Rechte

- Anmelden kann sich nur, wer aktiv ist und von einem Admin einen Zugangscode bekommen hat. Es gibt keine Selbstregistrierung und keinen automatischen Mailversand.
- Mitglieder sehen alle Termine und die Namensliste, sagen für sich selbst zu oder ab und sehen nur ihre eigenen vertraulichen Daten.
- Admins sehen alle Rückmeldungen, Gewehrnummern und Telefonnummern und legen Termine an.
- Absagen sind bei Kompanieausrückungen und Vorstandsterminen möglich; bei Fahnenabordnungen und sonstigen Aktivitäten gibt es nur Zusagen.
- Vorstandstermine sehen nur Mitglieder mit dem Häkchen „Vorstand“ sowie Admins.
- Admins können für jedes Mitglied eine Rückmeldung eintragen oder zurücksetzen (z. B. für Mitglieder ohne App); solche Einträge sind als „vom Admin eingetragen“ markiert.

Alle Regeln prüft die Datenbank selbst (Row-Level-Security). Der Schlüssel in `config.js` ist öffentlich und gibt ohne Anmeldung keinerlei Daten frei.

## Häufige Aufgaben

**Mitglied anlegen oder ändern:** In der App unter Admin → Mitglieder auf den Namen tippen (oder „Neues Mitglied“). Dort lassen sich Name, Rang, Funktion, E-Mail, Telefonnummern (mobil, privat, beruflich), Gewehrnummer, Adresse, Geburtstag, Beitritt, Mitgliedschaftsstatus, Kommentar, Beitragspflicht, Langjährigkeit, Postversand, Aktiv, Vorstand und Admin ändern. Darunter steht die Laufbahn aus dem BTSK-Stammdatenblatt. Eine geänderte E-Mail gilt sofort auch für die Anmeldung.

**Zugang vergeben:** In der App unter Admin → Mitglieder bei der Person auf „Zugang erzeugen“ tippen. Die fertige Nachricht mit Adresse, E-Mail und Code kopieren oder per WhatsApp schicken. „Neuer Code“ ersetzt einen verlorenen Code.

**Termin ändern:** Admin → Rückmeldungen → Termin öffnen → „Bearbeiten“.

**Anwesenheit erfassen:** Termin öffnen → „Anwesenheit“ (am Termintag und danach öffnet sich diese Ansicht automatisch). „Alle Zugesagten als ‚da‘“ setzen, dann einzelne Personen korrigieren und zum Schluss „Übrige als ‚nicht da‘“. Vergangene Termine der letzten zwölf Monate findest du unter Rückmeldungen → „Vergangene“. Der CSV-Export enthält die Anwesenheit.

**Erinnerungen und Kalender (Mitglieder):** Oben bei den Ausrückungen „Erinnerungen & Kalender“. Am iPhone funktionieren Erinnerungen nur, wenn die App über „Zum Home-Bildschirm“ installiert ist. Die Push-Schlüssel und das Kennwort des Zeitplans liegen im Supabase Vault (`vapid_public`, `vapid_private`, `cron_secret`).

**Rundschreiben:** Admin → Rundschreiben → „Neues Rundschreiben“. Monat wählen (die Termine des Monats sind vorausgewählt), optional Vorschau-Termine des Folgemonats anhaken, freien Text unten ergänzen, speichern. „In der App veröffentlichen“ zeigt es allen Mitgliedern und schickt eine Push-Nachricht. Mit „Erneut per Push schicken“ geht später eine Erinnerung an alle raus. Der Serienbrief für die Post („Postversand“ bzw. „Alle ohne App“) öffnet den Druckdialog, dort „Als PDF sichern“ oder drucken – am besten am Computer mit Chrome oder Edge. Absender, Fußzeile und Standardtexte stehen oben in `rundschreiben.js` (`LETTER`).

**Fibel:** Die Kapitel (z. B. die Statuten 2006) stehen als Text in der Datenbank (Tabelle `fibel_chapters`). Originaldokumente wie PDFs werden von der App derzeit nicht gespeichert. Mitglieder öffnen sie über „Fibel“ bei den Ausrückungen. Admins sehen dort zusätzlich „Neues Kapitel“ und „Kapitel bearbeiten“: Überschrift, Text (Leerzeile = Absatz, „## “ = Zwischenüberschrift), Reihenfolge und „Für alle veröffentlicht“. Entwürfe sehen nur Admins.

**Geburtstagsliste:** Mitglieder öffnen sie über „Geburtstage“ bei den Ausrückungen (heute, nächste 30 Tage, ganzes Jahr). Sichtbar sind nur Name, Tag und Monat; das Alter und runde Geburtstage sehen nur Admins. Jedes Mitglied kann sich unter „Erinnerungen & Kalender“ ausblenden. Im Rundschreiben-Editor schlägt die App die runden Geburtstage des Monats als Glückwunsch für den freien Text vor.

**Rückmeldung für jemanden ohne App:** Termin öffnen, beim Namen unter „Keine Rückmeldung“ auf „Zusage“ oder „Absage“ tippen.

**Meine Daten / Änderungsmeldungen:** Mitglieder ändern unter „Meine Daten“ Telefonnummern, Adresse und Geburtstag selbst und können dem Schriftführer eine Nachricht schicken (z. B. neue E-Mail-Adresse – die E-Mail ist die Anmeldung und wird nur vom Admin geändert). Jede Änderung landet in der Tabelle `member_changes`; alle Admins mit aktivierten Benachrichtigungen bekommen sofort eine Push-Nachricht. Offene Meldungen stehen oben unter Admin → Mitglieder und werden mit „Erledigt“ abgehakt (am besten nachdem sie im BTSK-Portal nachgetragen sind). Änderungen durch Admins werden nicht gemeldet.

**Vorstandsbereich:** Eigene Ansicht „Vorstand“ neben „Mitglied“ und „Admin“, nur für Mitglieder mit dem Häkchen „Vorstand“. Reiter *Sitzungen*: kommende Vorstandssitzungen mit Zu-/Absage und Übersicht, wer kommt (Vorstandsmitglieder sehen die Rückmeldungen der anderen zu Vorstandsterminen); vergangene Sitzungen mit Link zum Protokoll. Reiter *Protokolle*: siehe unten.

**Vorstandsprotokolle:** Im Vorstandsbereich unter „Protokolle“. Vorstandsmitglieder sehen die finalen Protokolle als PDF.
- *Neues Protokoll (Admin):* Datum, Nummer, Mitschrift (Word-Datei oder Text) und optional die Audioaufnahme angeben. Die Aufnahme wird in Teilen zu je 45 MB gespeichert, Azure holt sie über einen signierten Link ab (Batch-Spracherkennung, Tarif S0, de-AT, Sprechertrennung). Ein Zeitplan prüft alle zwei Minuten, dann schreibt Azure OpenAI (Bereitstellung `protokoll`, änderbar über das Secret `AZURE_OPENAI_DEPLOYMENT`; klassische Chat-Modelle und neuere Reasoning-Modelle werden beide unterstützt) den Entwurf im Aufbau der Protokollvorlage. Wenn er fertig ist, kommt eine Push-Nachricht.
- *Bearbeiten:* Kopf (Sitzungs-/Protokollführung, Anwesende, Abwesende), Text mit „## Abschnitt“, „### Person“, „- Punkt“; Vorschau, „Entwurf als PDF“ und „Als Word“ zum Verschicken an den Hauptmann.
- *Abschließen:* erzeugt das PDF (Karla, Seitenzahlen), legt es im privaten Speicher ab, löscht Mitschrift, Abschrift und Aufnahme und informiert auf Wunsch den Vorstand per Push.
- *Alte Protokolle hochladen:* mehrere PDFs auf einmal; Nummer und Datum werden aus dem Dateinamen gelesen.
- *Azure prüfen:* zeigt, ob Spracherkennung und KI-Modell erreichbar sind.

**Laufbahn & Auszeichnungen:** Jedes Mitglied sieht seine eigene Laufbahn unter „Meine Laufbahn“, Admins sehen sie in der Mitgliederbearbeitung. Die Daten stammen aus dem Stammdatenblatt-Export des BTSK (Stand 3.11.2026) und wurden einmalig eingespielt; Jungschützen und Jungmarketenderinnen sind nicht enthalten.

**Abgleich mit dem Dachverband (BTSK):** Im BTSK-Portal die Mitgliederliste als CSV exportieren, dann Admin → Mitglieder → „Abgleich mit BTSK-Export“ und Datei wählen. Die App zeigt neue Mitglieder, geänderte Angaben (E-Mail, Telefon, Adresse, Geburtstag, Beitritt, Rang, Funktion, Anrede, Postversand, Aktiv) und wer nur in der App steht. Übernommen wird nur Angehaktes; Gewehrnummern, Vorstand, Admin und App-Zugänge bleiben unberührt. Ein automatischer Abruf aus dem Portal ist nicht möglich (keine Schnittstelle, automatische Zugriffe gesperrt).

**Mitglied löschen:** In der Mitgliederbearbeitung „Mitglied löschen“ und die Rückfrage bestätigen. Entfernt auch den App-Zugang sowie alle Rückmeldungen und Anwesenheiten. Für Ausgetretene ist „Aktiv“ abhaken meist besser, dann bleibt die Geschichte erhalten.

**Admin, Vorstand oder Sperre:** In der Mitgliederbearbeitung „Admin“, „Vorstand“ bzw. „Aktiv“ an- oder abhaken.

**Änderung an der App veröffentlichen:** In `index.html` die Versionsnummer hinter `?v=` bei allen CSS- und JS-Dateien erhöhen (damit Handys nicht alte und neue Dateien mischen), dann in den `main`-Branch committen; GitHub Pages aktualisiert die Seite nach ein bis zwei Minuten.

## Einmalige Einrichtung

1. GitHub: *Settings* → *Pages* → Source „Deploy from a branch“, Branch `main`, Ordner `/ (root)`.
2. Erster Admin-Zugang: Im Supabase-Dashboard unter *Authentication* → *Users* → *Add user* die Admin-E-Mail mit einem Passwort anlegen und „Auto Confirm User“ anhaken. Das Konto wird automatisch mit dem Mitglied verknüpft; alle weiteren Zugänge vergibt der Admin in der App.
3. Supabase: *Authentication* → *Sign In / Providers* → „Allow new users to sign up“ ausschalten. Zugänge entstehen dann nur noch über die App.
4. Optional eigene Adresse (z. B. app.speckbacher-schuetzen.at): CNAME-Eintrag beim Domain-Anbieter auf `speckbacherhall.github.io`, danach die Adresse unter *Settings* → *Pages* → *Custom domain* eintragen.

## Anmelde-Erinnerung und Rundschreiben-Anzeige

- Beim Termin (Anlegen/Bearbeiten) lässt sich ein Zeitpunkt für die **Anmelde-Erinnerung** setzen. Dann bekommen alle ohne Rückmeldung (bei Vorstandsterminen nur der Vorstand) eine Push-Nachricht. Der Zeitplan `anmelde-erinnerung` prüft alle 15 Minuten. In der Termin-Ansicht kann ein Admin zusätzlich „Jetzt an Rückmeldung erinnern“.
- Die Erinnerung an alle mit Zusage am Vortag um 18 Uhr bleibt unverändert.
- Admin → Rundschreiben → „Anzeige auf der Startseite zurücksetzen“ nimmt das aktuelle Rundschreiben bei allen von der Startseite; im Rundschreiben selbst lässt es sich wieder einblenden.

## Design: Material Design 3

- `styles.css` folgt Material 3 (m3.material.io): Farbrollen, Typografie, Formen, Höhen und Zustandsebenen als CSS-Variablen (`--md-sys-…`).
- Die Farben sind aus der Kompaniefarbe Lodengrün `#4f6c37` mit Googles `@material/material-color-utilities` erzeugt (Schema „Tonal Spot“, wie Material Theme Builder und Flutter `ColorScheme.fromSeed`). Rot (Fahnenabordnung) und Blau (sonstige Aktivität) aus dem Logo sind eigene Farben (`--md-ext-…`). Hell und dunkel folgen der Geräteeinstellung.
- Schrift Roboto (selbst gehostet in `fonts/`, Lizenz `fonts/Roboto-LICENSE`); Karla bleibt für Rundschreiben-Druck und PDFs.
- Bewusst ohne `@material/web`: die Bibliothek ist im Wartungsmodus, die App braucht so keinen Build-Schritt und kein zusätzliches JavaScript. Eine spätere Flutter-App bekommt mit derselben Grundfarbe dieselben Farben.

## Rundschreiben per E-Mail, Teilen, Marketenderinnen

- **E-Mail:** Mitglieder mit „Rundschreiben per E-Mail“ (Admin → Mitglied bearbeiten, oder selbst unter „Meine Daten“) bekommen das Rundschreiben als Mailtext mit persönlicher Anrede und als PDF im Anhang. Das PDF erzeugt die App (pdfmake) und legt es im privaten Speicher `rundschreiben` ab; die Edge Function `rundschreiben` verschickt über Microsoft 365 (Microsoft Graph `sendMail`), höchstens 25 Mails je Minute (Zeitplan `rundschreiben-mail`, Warteschlange `newsletter_mails`).
  Geheimnisse der Edge Functions: `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET` (App-Registrierung in Microsoft Entra mit Anwendungsberechtigung `Mail.Send`, auf das Absenderpostfach beschränkt), `MAIL_FROM`.
- **Teilen:** „Teilen“ öffnet am Handy das Teilen-Menü mit dem PDF (z. B. WhatsApp-Gruppe); am Computer wird das PDF geladen und WhatsApp mit Text und App-Link geöffnet.
- **Löschen:** Rundschreiben lassen sich im Editor über das Papierkorb-Symbol löschen (samt PDF).
- **Marketenderinnen:** Je Termin ein eigener Hinweis; sichtbar für Mitglieder mit der Funktion „Marketenderin“, in ihren Briefen/Mails und im allgemeinen PDF.
- **Oberfläche:** Textfelder mit schwebender Beschriftung (`felder.js`, nach material-web „Outlined text field“), Symbolschaltflächen mit Material Symbols (`icons.js`).

## Statistik, Schusszahl, öffentlicher Kalender

- **Statistik:** Admin → Termine → „Statistik“: je Jahr Termine mit Anwesenheit, Schützen und Marketenderinnen (gesamt und Ø je Termin) und abgegebene Schuss; Liste je Termin, als CSV exportierbar (`statistik.js`). Marketenderinnen = Funktion „Marketenderin“ laut heutigem Mitgliederstand.
- **Schusszahl:** beim Termin unter „Anwesenheit“ (`events.shots`).
- **Öffentlicher Kalender:** Häkchen „Öffentlich“ beim Termin (`events.is_public`, nicht für Vorstandstermine). Abo-Adresse für das ICS-Plugin der Homepage: `https://eaqxzkjffnxdtpxrfwtu.supabase.co/functions/v1/kalender?oeffentlich=1` (nur Bezeichnung, Zeit, Ort, Adjustierung; Termine ab 90 Tagen zurück). Der Link lässt sich unter Admin → Termine kopieren.

## Begrüßung und Beilagen

- Oben rechts steht „Servus <Vorname>“.
- **Beilagen zum Rundschreiben** (z. B. Protokoll der JHV, Jahresplan): im Editor unter „Beilagen“ hochladen (PDF, Word, Excel, Bild; je ≤ 10 MB), gespeichert unter `rundschreiben/<id>/anhang/` und in `newsletters.attachments`. Mitglieder laden sie in der App beim Rundschreiben (Leserecht nur bei veröffentlichten Rundschreiben). Im Mail gehen sie bis zusammen 2,5 MB als Anhang mit, darüber als Download-Link (60 Tage gültig). Brief und PDF nennen sie unter „Beilagen“.
