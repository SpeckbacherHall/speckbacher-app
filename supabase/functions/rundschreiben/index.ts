// Edge Function "rundschreiben": Rundschreiben per E-Mail über Microsoft 365 (Microsoft Graph, sendMail).
// Jede Mail hat eine persönliche Anrede, den Brief als Mailtext und das PDF (in der App erzeugt, Speicher
// "rundschreiben") im Anhang. Versand über eine Warteschlange (newsletter_mails), höchstens 25 Mails je Minute.
// - POST {mode:"mail", id}  (Admin): alle Mitglieder mit „Rundschreiben per E-Mail“ in die Warteschlange
// - POST {mode:"test", id, to?} (Admin): sofort eine Test-Mail (an die eigene oder die angegebene Adresse)
// - POST {mode:"check"}     (Admin): prüft die Microsoft-365-Anmeldung
// - POST {mode:"poll"}      (Zeitplan, x-cron-secret): arbeitet die Warteschlange ab
// Geheimnisse: MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET (App-Registrierung mit Mail.Send),
//              MAIL_FROM (Absender-Postfach, z. B. schriftfuehrer@speckbacher-schuetzen.at), optional APP_URL.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const db = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const TENANT = Deno.env.get("MS_TENANT_ID") ?? "";
const CLIENT = Deno.env.get("MS_CLIENT_ID") ?? "";
const SECRET = Deno.env.get("MS_CLIENT_SECRET") ?? "";
const FROM = Deno.env.get("MAIL_FROM") ?? "";
const APP_URL = (Deno.env.get("APP_URL") ?? "https://app.speckbacher-schuetzen.at").replace(/\/$/, "");
const PER_RUN = 25;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const secret = async (name: string) => (await db.rpc("app_secret", { secret_name: name })).data as string;

// ---------- Brief (wie in der App, rundschreiben.js) ----------
const LETTER = {
  place: "Hall in Tirol",
  footer: [
    ["<b>SPECKBACHER - SCHÜTZENKOMPANIE HALL IN TIROL</b>", "Vereinslokal: Bei der Säule 17 | 6060 Hall in Tirol", "Zustelladresse: Speckbacher Hall | Felix Kranebitter |", "Schlangglfeld 20 | 6060 Hall in Tirol"],
    ["schriftführer@speckbacher-schuetzen.at", "+43 664 54 122 04", "speckbacher-schuetzen.at"],
    ["ZVR: 951247832", "Raiffeisen Regionalbank Hall", "IBAN: AT19 3636 2000 0010 2673", "BIC: RZTIAT22362"],
  ],
};
const PARTICIPATION: Record<string, string> = { kompanie: "Teilnahmepflicht", sonstig: "Teilnahme erwünscht", fahne: "Fahnenabordnung" };
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const hm = (t: string | null) => (t ?? "").slice(0, 5);
const dmy = (iso: string) => iso.split("-").reverse().join(".");
const day = (iso: string) => new Date(`${iso}T12:00:00Z`);
const fullDate = (iso: string) => day(iso).toLocaleDateString("de-AT", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const monthName = (iso: string) => day(iso).toLocaleDateString("de-AT", { month: "long", timeZone: "UTC" });
const monthTitle = (iso: string) => day(iso).toLocaleDateString("de-AT", { month: "long", year: "numeric", timeZone: "UTC" });
const nextMonth = (iso: string) => { const [y, m] = iso.split("-").map(Number); return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10); };
const isMk = (role: string | null) => /marketenderin/i.test(role ?? "");
const paras = (t: string | null) => (t ?? "").split(/\n{2,}/).map((x) => x.trim()).filter(Boolean)
  .map((x) => `<p style="margin:0 0 10px">${esc(x).replace(/\n/g, "<br>")}</p>`).join("");

// deno-lint-ignore no-explicit-any
function itemHtml(e: any, mk: boolean) {
  const time = e.muster_time && e.start_time ? `Antreten ${hm(e.muster_time)} Uhr | Beginn ${hm(e.start_time)} Uhr`
    : e.start_time ? `${hm(e.start_time)} Uhr` : e.muster_time ? `Antreten ${hm(e.muster_time)} Uhr` : "Informationen folgen";
  const lines = [`${fullDate(e.event_date)} | ${time} | ${e.place}`];
  if (e.notes && !(time === "Informationen folgen" && e.notes === "Informationen folgen")) lines.push(e.notes);
  if (e.dress) lines.push(`Adjustierung: ${e.dress}`);
  if (mk && e.note_marketenderinnen) lines.push(`Marketenderinnen: ${e.note_marketenderinnen}`);
  if (PARTICIPATION[e.kind]) lines.push(PARTICIPATION[e.kind]);
  return `<div style="margin:0 0 14px"><div style="font-weight:700;letter-spacing:.02em">${esc(e.title.toUpperCase())}</div>${lines.map((l) => `<div>${esc(l)}</div>`).join("")}</div>`;
}
// deno-lint-ignore no-explicit-any
function mailHtml(nl: any, m: any, items: any[], preview: any[]) {
  const mk = isMk(m.role_title);
  const hello = `${m.gender === "w" ? "Liebe" : "Lieber"} ${esc(m.first_name)},`;
  const link = `${APP_URL}/#rs-${nl.id}`;
  return `<!doctype html><html lang="de"><body style="margin:0;padding:0;background:#f3f5ea">
<div style="max-width:640px;margin:0 auto;background:#ffffff;padding:24px 28px;font-family:'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;line-height:1.45;color:#1d1d1b">
  <div style="text-align:center;margin-bottom:18px"><img src="cid:logo" alt="Speckbacher Schützenkompanie Hall in Tirol" width="220" style="width:220px;height:auto"></div>
  <p style="text-align:right;margin:0 0 14px">${esc(LETTER.place)}, ${dmy(nl.letter_date)}</p>
  <h1 style="font-size:24px;font-weight:400;margin:0 0 16px"><b style="font-weight:900">RUND</b>SCHREIBEN</h1>
  <p style="margin:0 0 10px">${hello}</p>
  ${paras(nl.intro)}
  ${items.map((e) => itemHtml(e, mk)).join("")}
  ${preview.length ? `<h2 style="font-size:18px;font-weight:400;margin:18px 0 10px">VORSCHAU ${esc(monthName(nextMonth(nl.month)).toUpperCase())}</h2>${preview.map((e) => itemHtml(e, mk)).join("")}` : ""}
  ${nl.free_text ? `<div style="margin-top:16px">${paras(nl.free_text)}</div>` : ""}
  <p style="margin:18px 0 22px">Schützen Heil</p>
  <p style="margin:0 0 22px">${esc(nl.signature).replace(/\n/g, "<br>")}</p>
  <p style="margin:0 0 22px"><a href="${esc(link)}" style="display:inline-block;background:#48672f;color:#ffffff;text-decoration:none;padding:10px 22px;border-radius:20px;font-weight:600">Rückmeldung in der App geben</a></p>
  <div style="border-top:1px solid #dddddd;padding-top:12px;font-size:11px;line-height:1.4;color:#4a4a48">${LETTER.footer.map((c) => `<p style="margin:0 0 8px">${c.join("<br>")}</p>`).join("")}
  <p style="margin:0">Du bekommst diese Mail, weil du in der Speckbacher-App „Rundschreiben per E-Mail“ gewählt hast. Abbestellen: in der App unter „Meine Daten“ oder mit einer kurzen Antwort auf diese Mail.</p></div>
</div></body></html>`;
}

// ---------- Microsoft Graph ----------
let token: { value: string; until: number } | null = null;
async function graphToken() {
  if (!TENANT || !CLIENT || !SECRET || !FROM) throw new Error("E-Mail-Versand ist noch nicht eingerichtet (MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MAIL_FROM fehlen).");
  if (token && token.until > Date.now() + 60_000) return token.value;
  const r = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(TENANT)}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT, client_secret: SECRET, scope: "https://graph.microsoft.com/.default", grant_type: "client_credentials" }),
  });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Anmeldung bei Microsoft 365 fehlgeschlagen: ${b.error_description?.split("\r\n")[0] ?? r.status}`);
  token = { value: b.access_token, until: Date.now() + (b.expires_in ?? 3600) * 1000 };
  return token.value;
}
// deno-lint-ignore no-explicit-any
async function sendMail(to: string, subject: string, html: string, attachments: any[]) {
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(FROM)}/sendMail`, {
    method: "POST", headers: { Authorization: `Bearer ${await graphToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: { subject, body: { contentType: "HTML", content: html }, toRecipients: [{ emailAddress: { address: to } }], attachments }, saveToSentItems: false }),
  });
  if (!r.ok) {
    const b = await r.json().catch(() => ({}));
    throw new Error(`${r.status} ${b.error?.code ?? ""}: ${b.error?.message ?? ""}`.trim());
  }
}

// Alles, was für die Mails eines Rundschreibens gebraucht wird (einmal je Lauf geladen)
// deno-lint-ignore no-explicit-any
const cache = new Map<number, any>();
async function prepare(id: number, needPdf = true) {
  if (cache.has(id)) return cache.get(id);
  const { data: nl } = await db.from("newsletters").select("*").eq("id", id).maybeSingle();
  if (!nl) throw new Error("Rundschreiben nicht gefunden.");
  if (!nl.pdf_path && needPdf) throw new Error("Zum Rundschreiben gibt es noch kein PDF.");
  const ids = [...nl.event_ids, ...nl.preview_ids];
  const { data: evs } = ids.length ? await db.from("events").select("*").in("id", ids) : { data: [] };
  // deno-lint-ignore no-explicit-any
  const pick = (l: number[]) => l.map((x) => (evs ?? []).find((e: any) => e.id === x)).filter(Boolean).sort((a: any, b: any) => a.event_date.localeCompare(b.event_date));
  const { data: pdf, error } = nl.pdf_path ? await db.storage.from("rundschreiben").download(nl.pdf_path) : { data: null, error: null };
  if (nl.pdf_path && (error || !pdf)) throw new Error("Das PDF konnte nicht geladen werden.");
  const logo = await fetch(`${APP_URL}/logo-brief.jpg`).then((r) => r.ok ? r.arrayBuffer() : null).catch(() => null);
  const attachments = [
    ...(pdf ? [{ "@odata.type": "#microsoft.graph.fileAttachment", name: `Rundschreiben_${monthTitle(nl.month).replace(/\s+/g, "_")}.pdf`, contentType: "application/pdf", contentBytes: encodeBase64(new Uint8Array(await pdf.arrayBuffer())) }] : []),
    ...(logo ? [{ "@odata.type": "#microsoft.graph.fileAttachment", name: "logo.jpg", contentType: "image/jpeg", contentBytes: encodeBase64(new Uint8Array(logo)), isInline: true, contentId: "logo" }] : []),
  ];
  const ctx = { nl, items: pick(nl.event_ids), preview: pick(nl.preview_ids), attachments, subject: `Rundschreiben ${monthTitle(nl.month)} – Speckbacher Schützenkompanie Hall in Tirol` };
  cache.set(id, ctx);
  return ctx;
}
// deno-lint-ignore no-explicit-any
async function mailTo(ctx: any, m: any, to: string) {
  await sendMail(to, ctx.subject, mailHtml(ctx.nl, m, ctx.items, ctx.preview), ctx.attachments);
}

async function poll() {
  const { data: rows } = await db.from("newsletter_mails").select("id,newsletter_id,member_id,email").eq("status", "offen").order("id").limit(PER_RUN);
  let sent = 0;
  for (const row of rows ?? []) {
    try {
      const ctx = await prepare(row.newsletter_id);
      const { data: m } = await db.from("members").select("first_name,gender,role_title").eq("id", row.member_id).maybeSingle();
      await mailTo(ctx, m ?? { first_name: "", gender: null, role_title: null }, row.email);
      await db.from("newsletter_mails").update({ status: "gesendet", sent_at: new Date().toISOString(), error: null }).eq("id", row.id);
      sent++;
    } catch (e) {
      await db.from("newsletter_mails").update({ status: "fehler", error: String((e as Error).message).slice(0, 300) }).eq("id", row.id);
    }
  }
  return sent;
}

async function requireAdmin(req: Request) {
  const t = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u } = await db.auth.getUser(t);
  if (!u?.user) return null;
  const { data: me } = await db.from("members").select("id,is_admin,active,first_name,gender,role_title,member_private(email)").eq("user_id", u.user.id).maybeSingle();
  return me?.is_admin && me.active ? me : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Nur POST erlaubt." }, 405);
  cache.clear();   // je Aufruf frisch laden (Rundschreiben oder PDF können sich geändert haben)
  let body: { mode?: string; id?: number; to?: string } = {};
  try { body = await req.json(); } catch { /* leer */ }

  if (body.mode === "poll") {
    if (req.headers.get("x-cron-secret") !== await secret("cron_secret")) return json({ error: "Nicht erlaubt." }, 401);
    return json({ sent: await poll() });
  }
  const viaCron = req.headers.get("x-cron-secret") === await secret("cron_secret");
  const validTo = (t?: string) => !!t && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
  // Wartungszugang (Zeitplan-Geheimnis): Test-Mail an eine angegebene Adresse, auch ohne PDF
  if (body.mode === "test" && viaCron && body.id && validTo(body.to)) {
    try { await mailTo(await prepare(body.id, false), { first_name: "Test", gender: "m", role_title: null }, body.to!); return json({ to: body.to }); }
    catch (e) { return json({ error: (e as Error).message }, 502); }
  }
  if (body.mode === "check" && viaCron) {
    try { await graphToken(); return json({ mail: `ok (Absender ${FROM})` }); } catch (e) { return json({ mail: (e as Error).message }); }
  }
  const me = await requireAdmin(req);
  if (!me) return json({ error: "Nur Admins." }, 403);

  if (body.mode === "check") {
    try { await graphToken(); return json({ mail: `ok (Absender ${FROM})` }); } catch (e) { return json({ mail: (e as Error).message }); }
  }
  if (!body.id) return json({ error: "Rundschreiben fehlt." }, 400);

  if (body.mode === "test") {
    // deno-lint-ignore no-explicit-any
    const own = ((me as any).member_private?.email ?? (me as any).member_private?.[0]?.email) as string | undefined;
    if (body.to && !validTo(body.to)) return json({ error: "Die Test-Adresse ist ungültig." }, 400);
    const to = body.to || own;
    if (!to) return json({ error: "Für dich ist keine E-Mail-Adresse hinterlegt." }, 400);
    try { await mailTo(await prepare(body.id), me, to); return json({ to }); }
    catch (e) { return json({ error: (e as Error).message }, 502); }
  }

  if (body.mode === "mail") {
    const { data: nl } = await db.from("newsletters").select("id,published_at,pdf_path").eq("id", body.id).maybeSingle();
    if (!nl?.published_at) return json({ error: "Bitte das Rundschreiben zuerst in der App veröffentlichen." }, 400);
    if (!nl.pdf_path) return json({ error: "Zum Rundschreiben gibt es noch kein PDF." }, 400);
    try { await graphToken(); } catch (e) { return json({ error: (e as Error).message }, 502); }
    const { data: list } = await db.from("members").select("id,member_private!inner(email,newsletter_email)")
      .eq("active", true).eq("member_private.newsletter_email", true).not("member_private.email", "is", null);
    const { data: done } = await db.from("newsletter_mails").select("member_id,status").eq("newsletter_id", nl.id).in("status", ["offen", "gesendet"]);
    const skip = new Set((done ?? []).map((d) => d.member_id));
    // deno-lint-ignore no-explicit-any
    const rows = (list ?? []).filter((m) => !skip.has(m.id)).map((m: any) => ({ newsletter_id: nl.id, member_id: m.id, email: (m.member_private?.email ?? m.member_private?.[0]?.email) }))
      .filter((r) => r.email);
    // frühere Fehlversuche ersetzen
    if (rows.length) {
      await db.from("newsletter_mails").delete().eq("newsletter_id", nl.id).eq("status", "fehler").in("member_id", rows.map((r) => r.member_id));
      const { error } = await db.from("newsletter_mails").insert(rows);
      if (error) return json({ error: "Die Warteschlange konnte nicht angelegt werden." }, 500);
    }
    return json({ queued: rows.length, already: skip.size });
  }
  return json({ error: "Unbekannte Aktion." }, 400);
});
