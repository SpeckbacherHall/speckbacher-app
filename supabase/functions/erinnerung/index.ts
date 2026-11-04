// Edge Function "erinnerung": Push-Nachrichten.
// - Zeitplan (pg_cron, Header x-cron-secret): täglich um 18 Uhr Wiener Zeit Erinnerung an alle,
//   die für einen Termin am nächsten Tag zugesagt haben. Jede Erinnerung geht nur einmal raus.
// - Test (angemeldetes Mitglied, Body {"mode":"test"}): Probe-Nachricht an die eigenen Geräte.
// - Rundschreiben (Admin, Body {"mode":"broadcast","title","body","url"}): Nachricht an alle aktiven Mitglieder.
// - Anmelde-Erinnerung (Zeitplan alle 15 Min., Body {"mode":"ask"}; oder Admin sofort, Body {"mode":"ask","id"}):
//   Push an alle, die sich zu einem Termin noch nicht zurückgemeldet haben.
// - Datenänderung (Trigger auf member_changes, Header x-cron-secret, Body {"mode":"change","id"}): Push an alle Admins.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const hm = (t: string | null) => (t ?? "").slice(0, 5);
const viennaDate = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 864e5);
  return d.toLocaleDateString("sv-SE", { timeZone: "Europe/Vienna" });
};
const viennaHour = () => Number(new Date().toLocaleString("en-GB", { timeZone: "Europe/Vienna", hour: "2-digit", hour12: false }));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Nur POST erlaubt." }, 405);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const secret = async (name: string) => (await db.rpc("app_secret", { secret_name: name })).data as string;
  webpush.setVapidDetails("mailto:schriftfuehrer@speckbacher-schuetzen.at", await secret("vapid_public"), await secret("vapid_private"));

  // deno-lint-ignore no-explicit-any
  async function sendTo(memberIds: string[], payload: any) {
    if (!memberIds.length) return new Set<string>();
    const { data: subs } = await db.from("push_subscriptions").select("id,member_id,endpoint,p256dh,auth").in("member_id", memberIds);
    const reached = new Set<string>();
    for (const s of subs ?? []) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 6 * 3600, urgency: "high" });
        reached.add(s.member_id);
      } catch (err) {
        // deno-lint-ignore no-explicit-any
        const code = (err as any)?.statusCode;
        if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("id", s.id); // Gerät abgemeldet
        else console.error("Push fehlgeschlagen", code, err);
      }
    }
    return reached;
  }

  // Anmelde-Erinnerung für einen Termin: an alle aktiven (bei Vorstandsterminen: Vorstands-)Mitglieder ohne Rückmeldung
  // deno-lint-ignore no-explicit-any
  async function askEvent(e: any) {
    let q = db.from("members").select("id").eq("active", true);
    if (e.kind === "vorstand") q = q.eq("is_board", true);
    const { data: who } = await q;
    const { data: rs } = await db.from("responses").select("member_id").eq("event_id", e.id);
    const answered = new Set((rs ?? []).map((r) => r.member_id));
    const todo = (who ?? []).map((m) => m.id).filter((id) => !answered.has(id));
    const d = new Date(`${e.event_date}T12:00:00`).toLocaleDateString("de-AT", { weekday: "short", day: "numeric", month: "numeric", timeZone: "Europe/Vienna" });
    const text = e.kind === "fahne" || e.kind === "sonstig"
      ? `${d}${e.start_time ? `, ${hm(e.start_time)} Uhr` : ""} · Bist du dabei? Dann melde dich bitte in der App an.`
      : `${d}${e.start_time ? `, ${hm(e.start_time)} Uhr` : ""} · Bitte sag in der App zu oder ab.`;
    const reached = await sendTo(todo, { title: `Rückmeldung fehlt: ${e.title}`, body: text, url: `./#t-${e.id}`, tag: `ask-${e.id}` });
    return { open: todo.length, sent: reached.size };
  }

  let body: { mode?: string; id?: number; force?: boolean; title?: string; body?: string; url?: string } = {};
  try { body = await req.json(); } catch { /* leer erlaubt */ }

  // --- Test durch ein angemeldetes Mitglied ---
  if (body.mode === "test") {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u } = await db.auth.getUser(token);
    if (!u?.user) return json({ error: "Nicht angemeldet." }, 401);
    const { data: me } = await db.from("members").select("id").eq("user_id", u.user.id).eq("active", true).maybeSingle();
    if (!me) return json({ error: "Kein aktives Mitglied." }, 403);
    const reached = await sendTo([me.id], { title: "Speckbacher", body: "So sehen die Erinnerungen aus. Alles eingerichtet!", url: "./" });
    return json({ sent: reached.size });
  }

  // --- Nachricht an alle (nur Admins) ---
  if (body.mode === "broadcast") {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u } = await db.auth.getUser(token);
    if (!u?.user) return json({ error: "Nicht angemeldet." }, 401);
    const { data: me } = await db.from("members").select("id,is_admin").eq("user_id", u.user.id).eq("active", true).maybeSingle();
    if (!me?.is_admin) return json({ error: "Nur Admins dürfen an alle senden." }, 403);
    if (!body.title) return json({ error: "Titel fehlt." }, 400);
    const { data: all } = await db.from("members").select("id").eq("active", true);
    const reached = await sendTo((all ?? []).map((m) => m.id), { title: body.title.slice(0, 80), body: (body.body ?? "").slice(0, 200), url: body.url ?? "./" });
    return json({ sent: reached.size });
  }

  // --- Anmelde-Erinnerung sofort (nur Admins) ---
  if (body.mode === "ask" && body.id) {
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u } = await db.auth.getUser(token);
    if (!u?.user) return json({ error: "Nicht angemeldet." }, 401);
    const { data: me } = await db.from("members").select("id,is_admin").eq("user_id", u.user.id).eq("active", true).maybeSingle();
    if (!me?.is_admin) return json({ error: "Nur Admins." }, 403);
    const { data: e } = await db.from("events").select("*").eq("id", body.id).maybeSingle();
    if (!e) return json({ error: "Termin nicht gefunden." }, 404);
    const res = await askEvent(e);
    await db.from("events").update({ ask_sent_at: new Date().toISOString() }).eq("id", e.id);
    return json(res);
  }

  if (req.headers.get("x-cron-secret") !== await secret("cron_secret")) return json({ error: "Nicht erlaubt." }, 401);

  // --- Fällige Anmelde-Erinnerungen (Zeitplan) ---
  if (body.mode === "ask") {
    const { data: due } = await db.from("events").select("*").is("ask_sent_at", null).lte("ask_at", new Date().toISOString()).gte("event_date", viennaDate(0));
    let sent = 0;
    for (const e of due ?? []) {
      // erst als verschickt markieren, damit ein paralleler Lauf nicht doppelt schickt
      const { data: claimed } = await db.from("events").update({ ask_sent_at: new Date().toISOString() }).eq("id", e.id).is("ask_sent_at", null).select("id");
      if (claimed?.length) sent += (await askEvent(e)).sent;
    }
    return json({ events: (due ?? []).length, sent });
  }

  // --- Datenänderung durch ein Mitglied (Datenbank-Trigger) → Push an alle Admins ---
  if (body.mode === "change") {
    const { data: c } = await db.from("member_changes").select("changes,note,members!member_changes_member_id_fkey(first_name,last_name)").eq("id", body.id).maybeSingle();
    if (!c) return json({ error: "Änderung nicht gefunden." }, 404);
    const LABELS: Record<string, string> = { phone: "Telefon", phone_private: "Telefon privat", phone_work: "Telefon beruflich", address: "Adresse", birthday: "Geburtstag" };
    const fields = Object.keys(c.changes ?? {}).map((k) => LABELS[k] ?? k);
    // deno-lint-ignore no-explicit-any
    const m = c.members as any;
    const text = fields.length ? `Geändert: ${fields.join(", ")}` : `Nachricht: ${(c.note ?? "").slice(0, 150)}`;
    const { data: admins } = await db.from("members").select("id").eq("is_admin", true).eq("active", true);
    const reached = await sendTo((admins ?? []).map((a) => a.id), { title: `Mitgliedsdaten: ${m?.first_name ?? ""} ${m?.last_name ?? ""}`.trim(), body: text, url: "./#aenderungen", tag: `change-${body.id}` });
    return json({ sent: reached.size });
  }

  // --- Täglicher Lauf über den Zeitplan ---
  if (!body.force && viennaHour() !== 18) return json({ skipped: "nicht 18 Uhr in Wien" });

  const tomorrow = viennaDate(1);
  const { data: events } = await db.from("events").select("id,title,start_time,muster_time,place").eq("event_date", tomorrow);
  let total = 0;
  for (const e of events ?? []) {
    const { data: rs } = await db.from("responses").select("member_id, members!inner(active)").eq("event_id", e.id).eq("status", "yes").eq("members.active", true);
    const { data: done } = await db.from("reminder_log").select("member_id").eq("event_id", e.id);
    const already = new Set((done ?? []).map((d) => d.member_id));
    const todo = (rs ?? []).map((r) => r.member_id).filter((id) => !already.has(id));
    const when = [e.muster_time ? `Antreten ${hm(e.muster_time)}` : "", e.start_time ? `Beginn ${hm(e.start_time)} Uhr` : ""].filter(Boolean).join(" · ");
    const reached = await sendTo(todo, { title: `Morgen: ${e.title}`, body: [when, e.place].filter(Boolean).join(" · "), url: "./" });
    if (reached.size) await db.from("reminder_log").insert([...reached].map((member_id) => ({ event_id: e.id, member_id })));
    total += reached.size;
  }
  return json({ date: tomorrow, events: (events ?? []).length, reminded: total });
});
