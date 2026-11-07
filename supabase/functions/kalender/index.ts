// Edge Function "kalender": persönlicher Kalender-Abo-Link (ICS) mit allen zugesagten Terminen.
// Aufruf: GET /functions/v1/kalender?t=<calendar_token>  (ohne Anmeldung, der Token ist das Geheimnis)
// Öffentlich: GET /functions/v1/kalender?oeffentlich=1 – alle als „öffentlich“ markierten Termine für die Homepage
//   (nur Bezeichnung, Zeit, Ort, Adjustierung; keine Hinweise, keine Vorstandstermine, keine Personendaten).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const TYPES: Record<string, string> = {
  kompanie: "Kompanieausrückung", fahne: "Fahnenabordnung", sonstig: "Sonstige Aktivität", vorstand: "Vorstandstermin",
};
const VTIMEZONE = [
  "BEGIN:VTIMEZONE", "TZID:Europe/Vienna",
  "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "TZNAME:CEST", "DTSTART:19700329T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT",
  "BEGIN:STANDARD", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "TZNAME:CET", "DTSTART:19701025T030000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD",
  "END:VTIMEZONE",
];
const esc = (s: string | null) => String(s ?? "").replace(/[\\,;]/g, (c) => "\\" + c).replace(/\r?\n/g, "\\n").replace(/\r/g, "");
// Zeilen nach RFC 5545 bei 75 Bytes (UTF-8) falten, ohne ein Zeichen zu zerteilen
const enc = new TextEncoder();
const fold = (line: string) => {
  const out: string[] = [];
  let cur = "", bytes = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > (out.length ? 74 : 75)) { out.push(cur); cur = ""; bytes = 0; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
};
const hm = (t: string | null) => (t ?? "").slice(0, 5);

// deno-lint-ignore no-explicit-any
function vevent(e: any, stamp: string, withNotes: boolean) {
  const out: string[] = [];
  const d = e.event_date.replace(/-/g, "");
  const first = e.muster_time || e.start_time;
  out.push("BEGIN:VEVENT", `UID:speckbacher-${e.id}@speckbacher-schuetzen.at`, `DTSTAMP:${stamp}`);
  if (first) {
    const [h, m] = (e.start_time || first).split(":").map(Number);
    out.push(`DTSTART;TZID=Europe/Vienna:${d}T${first.slice(0, 5).replace(":", "")}00`);
    out.push(`DTEND;TZID=Europe/Vienna:${d}T${String(Math.min(h + 2, 23)).padStart(2, "0")}${String(m).padStart(2, "0")}00`);
  } else {
    const next = new Date(e.event_date + "T12:00:00Z"); next.setUTCDate(next.getUTCDate() + 1);
    out.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next.toISOString().slice(0, 10).replace(/-/g, "")}`);
  }
  const times = [e.muster_time ? `Antreten ${hm(e.muster_time)}` : "", e.start_time ? `Beginn ${hm(e.start_time)} Uhr` : "Uhrzeit folgt"].filter(Boolean).join(" · ");
  const desc = [TYPES[e.kind], times, e.dress ? `Adjustierung: ${e.dress}` : "", withNotes ? e.notes ?? "" : ""].filter(Boolean).join(" · ");
  out.push(fold(`SUMMARY:${esc(e.title)}`), fold(`LOCATION:${esc(e.place)}`), fold(`DESCRIPTION:${esc(desc)}`), "END:VEVENT");
  return out;
}
const head = (name: string) => [
  "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Speckbacher Schützenkompanie//App//DE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
  `X-WR-CALNAME:${name}`, "X-WR-TIMEZONE:Europe/Vienna",
  "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H", ...VTIMEZONE,
];

Deno.serve(async (req) => {
  const params = new URL(req.url).searchParams;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";

  if (params.has("oeffentlich")) {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const since = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
    const { data: evs } = await db.from("events").select("id,kind,title,event_date,start_time,muster_time,place,dress")
      .eq("is_public", true).neq("kind", "vorstand").gte("event_date", since).order("event_date");
    const lines = head("Speckbacher Schützenkompanie Hall in Tirol");
    for (const e of evs ?? []) lines.push(...vevent(e, stamp, false));
    lines.push("END:VCALENDAR");
    return new Response(lines.join("\r\n") + "\r\n", {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'inline; filename="speckbacher-oeffentlich.ics"',
        "Cache-Control": "public, max-age=900",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  const token = params.get("t") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(token)) return new Response("Ungültiger Link.", { status: 404 });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: p } = await db.from("member_private").select("member_id, members!inner(active)")
    .eq("calendar_token", token).maybeSingle();
  // deno-lint-ignore no-explicit-any
  if (!p || !(p as any).members?.active) return new Response("Ungültiger Link.", { status: 404 });

  const since = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
  const { data: rows } = await db.from("responses")
    .select("events!inner(id,kind,title,event_date,start_time,muster_time,place,dress,notes,created_at)")
    .eq("member_id", p.member_id).eq("status", "yes").gte("events.event_date", since);

  const lines = head("Speckbacher – meine Termine");
  // deno-lint-ignore no-explicit-any
  for (const r of (rows ?? []) as any[]) lines.push(...vevent(r.events, stamp, true));
  lines.push("END:VCALENDAR");

  return new Response(lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="speckbacher.ics"',
      "Cache-Control": "no-store",
    },
  });
});
