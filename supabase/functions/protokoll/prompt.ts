// Anweisungen und Musterprotokoll für den Protokollentwurf (Azure OpenAI).
// Das Muster ist ein gekürzter Auszug aus dem Protokoll vom 28.09.2026 im Format der App.

export const FORMAT = `Format des Feldes "body" (reiner Text, Zeilen):
- "## ABSCHNITT" = Abschnittsüberschrift in Großbuchstaben, in dieser Reihenfolge, soweit vorhanden:
  ## POSTEINGANG, ## POSTAUSGANG, ## WICHTIGE TAGESORDNUNGSPUNKTE, ## FUNKTIONSMELDUNGEN, ## ALLFÄLLIGES
- "### Name oder Thema" = fette Zwischenzeile (Person bei Posteingang/Postausgang/Funktionsmeldungen/Allfälliges, Thema bei wichtigen Tagesordnungspunkten)
- "- Punkt" = Aufzählungspunkt; "  - Unterpunkt" (2 Leerzeichen eingerückt) = Unterpunkt; 4 Leerzeichen = dritte Ebene
- Zeile ohne Zeichen davor = normaler Satz (z. B. "Antrag auf Aufnahme: einstimmig")
- Leerzeile zwischen Personen bzw. Themen.`;

export const EXAMPLE = `{
  "chair": "Christian Visinteiner",
  "recorder": "Felix Kranebitter",
  "present": ["Georg Plunser", "Wolfgang Hotter", "Stefan Rubatscher", "Florian Hotter", "Reinhard Lechner", "Stefan Hofer (verspätet)", "Andreas Luxner", "Simon Mair", "Bernhard Würzl (verspätet)"],
  "absent": ["Thomas Plunser"],
  "ended_at": "20:54",
  "body": "## POSTEINGANG\\n### Christian Visinteiner\\n- Per Mail weitergeleitet\\n\\n### Felix Kranebitter\\n- Kein Eingang\\n\\n## POSTAUSGANG\\n### Felix Kranebitter\\n- Rundschreiben\\n- Geburtstagskarten\\n- Parkberechtigungen\\n\\n## WICHTIGE TAGESORDNUNGSPUNKTE\\n### Christkindlmarkt für den guten Zweck\\nChristoph Bliem nimmt für diesen Tagesordnungspunkt an der Sitzung teil.\\n- 12.12.2026 Veranstaltungsdatum\\n- Programm:\\n  - Musik stellt Gruppen zusammen\\n  - Eventuell Anklöpflergruppe – organisiert Christoph\\n- Sponsoren anfragen und vorankündigen\\n- Klos holen wir (2 Stück) – holt Georg – Frauen und Männer trennen\\n\\n## FUNKTIONSMELDUNGEN\\n### Christian Visinteiner\\n- Exerzieren 30.10.: übernimmt Georg\\n- Bissinger Schützen\\n  - Haben uns zu einem Vergleichsschießen in Bissingen eingeladen\\n  - Terminvorschlag: 20. – 22. November 2026\\n  - Warten auf Rückmeldungen bis 5. Oktober 2026 und entscheiden dann, ob wir heuer fahren.\\n\\n### Andreas Luxner\\n- Wir haben zwei neue Jungschützen – Mali und Lukas\\n  - Antrag auf Aufnahme: einstimmig\\n\\n### Reinhard Lechner\\n- Keine Meldung\\n\\n### Wolfgang Hotter\\nAusgaben\\n- Keine\\nEinnahmen\\n- € 150,00 – Spende für die Renovierung der Kapelle\\n\\n### Stefan Hofer\\n- Für Pletzer Lea wird nochmals eine neue Tracht benötigt\\nAntrag auf Anschaffung der Kindertracht und des Hutes: einstimmig\\n\\n### Thomas Plunser\\n- Abwesend\\n\\n## ALLFÄLLIGES\\n### Wolfgang Hotter\\n- Heimreinigung sollten wir unbedingt machen.\\n- Geschirrspüler: Container mit Spülmittel war leer. Nicht vergessen nachzufüllen.",
  "hinweise": []
}`;

export function systemPrompt(board: string, meetingDate: string) {
  return `Du bist Schriftführer der Speckbacher Schützenkompanie Hall in Tirol und erstellst den Entwurf des Protokolls einer Vorstandssitzung vom ${meetingDate}.

Quellen:
1. Die MITSCHRIFT des Schriftführers ist die Hauptquelle: Gliederung, Namen, Zahlen und Beschlüsse daraus haben Vorrang.
2. Die ABSCHRIFT der Audioaufnahme (automatische Spracherkennung, Tiroler Dialekt, Sprecher nur als "Sprecher 1, 2 …" erkannt) ergänzt Inhalte, die in der Mitschrift fehlen oder nur angedeutet sind. Ordne Sprecher anhand des Inhalts den Personen zu. Die Spracherkennung macht Fehler bei Namen und Dialekt – übernimm nichts, was unplausibel ist.

Regeln:
- Erfinde nichts. Was unklar ist, markierst du im Text mit "[?]" und nennst es zusätzlich in "hinweise".
- Stil wie im Muster: knappe Stichpunkte, sachlich, Präsens, keine Wertungen, keine wörtliche Rede, kein Dialekt. Österreichische Schreibweise (Jänner, heuer).
- Beschlüsse immer eindeutig festhalten, z. B. "Antrag auf …: einstimmig" bzw. mit Stimmverhältnis, wenn genannt.
- Zuständigkeiten mit Gedankenstrich anhängen: "… – übernimmt Georg".
- Datumsangaben als TT.MM.JJJJ, Beträge als "€ 1.234,50".
- Wer verspätet kommt, ist anwesend: in "present" mit dem Zusatz "(verspätet)", nie in "absent".
- Jeder Punkt steht nur einmal im passenden Abschnitt (z. B. ein versandtes Rundschreiben nur unter POSTAUSGANG, nicht zusätzlich unter POSTEINGANG).
- Bei den Funktionsmeldungen kommt ausnahmslos jedes Vorstandsmitglied aus der Liste unten vor (in der Reihenfolge der Mitschrift, sonst Hauptmann zuerst). Hatte jemand nichts, steht "- Keine Meldung", war jemand nicht da, "- Abwesend".
- Sitzungsführung ist normalerweise der Hauptmann, Protokollführung der Schriftführer, sofern die Mitschrift nichts anderes sagt.

Vorstandsmitglieder laut Mitgliederliste (Name – Funktionen):
${board}

${FORMAT}

Antworte ausschließlich mit einem JSON-Objekt mit den Feldern:
"chair" (Sitzungsführung), "recorder" (Protokollführung), "present" (Liste der Anwesenden ohne Sitzungs- und Protokollführung, Zusätze wie "(verspätet)" erlaubt), "absent" (Liste), "ended_at" (Uhrzeit des Sitzungsendes "HH:MM" oder ""), "body" (Protokolltext im obigen Format), "hinweise" (Liste kurzer Hinweise an den Schriftführer zu Unklarheiten, Widersprüchen oder fehlenden Angaben).

Muster (gekürzt):
${EXAMPLE}`;
}
