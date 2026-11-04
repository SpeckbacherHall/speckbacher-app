// Edge Function "protokoll": Vorstandsprotokolle aus Mitschrift und Audioaufnahme.
// - POST {mode:"start", id}   (Admin): startet die Spracherkennung (Azure Batch) bzw. direkt den Entwurf
// - POST {mode:"poll"}        (Zeitplan, x-cron-secret): fragt Transkriptionen ab und schreibt Entwürfe (Azure OpenAI)
// - POST {mode:"notify", id | ids} (Admin): Push an alle Vorstandsmitglieder, dass ein bzw. mehrere Protokolle im Archiv liegen
// - POST {mode:"check"}       (Admin): prüft die Azure-Zugänge
// - GET  ?audio=<id>&t=<sig>  (Azure): liefert die in Teilen gespeicherte Aufnahme als eine Datei aus
// Geheimnisse: AZURE_SPEECH_ENDPOINT/KEY, AZURE_OPENAI_ENDPOINT/KEY, optional AZURE_OPENAI_DEPLOYMENT (Standard "protokoll").
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import webpush from "npm:web-push@3.6.7";
import { systemPrompt } from "./prompt.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SPEECH = (Deno.env.get("AZURE_SPEECH_ENDPOINT") ?? "").replace(/\/$/, "");
const SPEECH_KEY = Deno.env.get("AZURE_SPEECH_KEY") ?? "";
const AOAI = (Deno.env.get("AZURE_OPENAI_ENDPOINT") ?? "").replace(/\/$/, "");
const AOAI_KEY = Deno.env.get("AZURE_OPENAI_KEY") ?? "";
const DEPLOYMENT = Deno.env.get("AZURE_OPENAI_DEPLOYMENT") ?? "protokoll";
const BUCKET = "vorstand";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const secret = async (name: string) => (await db.rpc("app_secret", { secret_name: name })).data as string;
const speechHeaders = () => ({ "Ocp-Apim-Subscription-Key": SPEECH_KEY, "Content-Type": "application/json" });
const dmy = (iso: string) => iso.split("-").reverse().join(".");

async function signature(id: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(await secret("cron_secret")),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`audio:${id}`));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function requireAdmin(req: Request) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: u } = await db.auth.getUser(token);
  if (!u?.user) return null;
  const { data: me } = await db.from("members").select("id,is_admin,active").eq("user_id", u.user.id).maybeSingle();
  return me?.is_admin && me.active ? me : null;
}

// ---------- Push ----------
// deno-lint-ignore no-explicit-any
async function push(memberIds: string[], payload: any) {
  if (!memberIds.length) return 0;
  webpush.setVapidDetails("mailto:schriftfuehrer@speckbacher-schuetzen.at", await secret("vapid_public"), await secret("vapid_private"));
  const { data: subs } = await db.from("push_subscriptions").select("id,member_id,endpoint,p256dh,auth").in("member_id", memberIds);
  const reached = new Set<string>();
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 24 * 3600, urgency: "high" });
      reached.add(s.member_id);
    } catch (err) {
      // deno-lint-ignore no-explicit-any
      const code = (err as any)?.statusCode;
      if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("id", s.id);
      else console.error("Push fehlgeschlagen", code);
    }
  }
  return reached.size;
}

// ---------- Aufnahme ausliefern (für Azure) ----------
async function serveAudio(req: Request, url: URL) {
  const id = Number(url.searchParams.get("audio"));
  if (!id || url.searchParams.get("t") !== await signature(id)) return new Response("Nicht erlaubt.", { status: 403 });
  const { data: p } = await db.from("protocols").select("audio_type,audio_parts").eq("id", id).maybeSingle();
  const { data: files } = await db.storage.from(BUCKET).list(`audio/${id}`, { limit: 1000, sortBy: { column: "name", order: "asc" } });
  const parts = (files ?? []).filter((f) => f.name.startsWith("part-")).sort((a, b) => a.name.localeCompare(b.name));
  if (!p || !parts.length) return new Response("Keine Aufnahme.", { status: 404 });
  // deno-lint-ignore no-explicit-any
  const total = parts.reduce((s, f) => s + Number((f.metadata as any)?.size ?? 0), 0);
  const headers: Record<string, string> = { "Content-Type": p.audio_type || "application/octet-stream", "Cache-Control": "no-store" };
  if (total) headers["Content-Length"] = String(total);
  if (req.method === "HEAD") return new Response(null, { headers });
  const { readable, writable } = new TransformStream();
  (async () => {
    try {
      for (const f of parts) {
        const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/audio/${id}/${f.name}`, { headers: { Authorization: `Bearer ${SERVICE_KEY}` } });
        if (!r.ok || !r.body) throw new Error(`Teil ${f.name}: ${r.status}`);
        await r.body.pipeTo(writable, { preventClose: true });
      }
      await writable.close();
    } catch (e) { console.error(e); await writable.abort(e); }
  })();
  return new Response(readable, { headers });
}

// ---------- Spracherkennung ----------
async function startTranscription(id: number) {
  const audioUrl = `${SUPABASE_URL}/functions/v1/protokoll?audio=${id}&t=${await signature(id)}`;
  const r = await fetch(`${SPEECH}/speechtotext/v3.2/transcriptions`, {
    method: "POST", headers: speechHeaders(),
    body: JSON.stringify({
      displayName: `Speckbacher Protokoll ${id}`, locale: "de-AT", contentUrls: [audioUrl],
      properties: { diarizationEnabled: true, diarization: { speakers: { minCount: 1, maxCount: 15 } },
        punctuationMode: "DictatedAndAutomatic", profanityFilterMode: "None", timeToLiveHours: 48 },
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(r.status === 400 && /Standard/.test(body?.message ?? "")
    ? "Die Azure-Spracherkennung läuft im Gratis-Tarif F0. Für lange Aufnahmen bitte im Azure-Portal auf S0 umstellen."
    : `Spracherkennung konnte nicht starten (${r.status}): ${body?.message ?? ""}`);
  return body.self as string;
}
const clock = (ticks: number) => { const s = Math.floor(ticks / 1e7); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
// deno-lint-ignore no-explicit-any
function transcriptText(result: any) {
  const lines: string[] = [];
  let last = -1;
  // deno-lint-ignore no-explicit-any
  for (const ph of (result.recognizedPhrases ?? []) as any[]) {
    const text = ph.nBest?.[0]?.display;
    if (!text) continue;
    const sp = ph.speaker ?? 0;
    if (sp !== last || !lines.length) { lines.push(`[${clock(ph.offsetInTicks ?? 0)}] Sprecher ${sp}: ${text}`); last = sp; }
    else lines[lines.length - 1] += " " + text;
  }
  return lines.join("\n");
}
// deno-lint-ignore no-explicit-any
async function checkTranscription(p: any) {
  const r = await fetch(p.job_ref, { headers: speechHeaders() });
  const t = await r.json().catch(() => ({}));
  if (t.status === "Succeeded") {
    const files = await (await fetch(`${p.job_ref}/files`, { headers: speechHeaders() })).json();
    // deno-lint-ignore no-explicit-any
    const f = (files.values ?? []).find((v: any) => v.kind === "Transcription");
    const result = f ? await (await fetch(f.links.contentUrl)).json() : {};
    const transcript = transcriptText(result);
    await db.from("protocols").update({ transcript, job_state: "entwurf", job_error: null }).eq("id", p.id);
    await fetch(p.job_ref, { method: "DELETE", headers: speechHeaders() });
  } else if (t.status === "Failed") {
    await db.from("protocols").update({ job_state: "fehler", job_error: `Spracherkennung fehlgeschlagen: ${t.properties?.error?.message ?? "unbekannt"}` }).eq("id", p.id);
  } else if (Date.now() - Date.parse(p.job_started_at) > 12 * 3600e3) {
    await db.from("protocols").update({ job_state: "fehler", job_error: "Die Spracherkennung hat nach 12 Stunden kein Ergebnis geliefert." }).eq("id", p.id);
  }
}

// ---------- Entwurf ----------
async function boardList() {
  const { data } = await db.from("members").select("first_name,last_name,role_title").eq("is_board", true).eq("active", true).order("last_name");
  return (data ?? []).map((m) => `- ${m.first_name} ${m.last_name} – ${m.role_title ?? ""}`).join("\n");
}
// Aufruf an Azure OpenAI. Klassische Chat-Modelle (gpt-4o/4.1) nehmen temperature und max_tokens,
// neuere Modelle (Reasoning, z. B. o-Serie, gpt-5) verlangen max_completion_tokens und lehnen temperature ab –
// bei einem 400-Fehler wird daher die jeweils andere Variante probiert.
// deno-lint-ignore no-explicit-any
async function chat(messages: any[], maxTokens: number, asJson: boolean, timeoutMs: number) {
  const base = { messages, ...(asJson ? { response_format: { type: "json_object" } } : {}) };
  const attempts = [
    { v: "2024-10-21", body: { ...base, temperature: 0.2, max_tokens: maxTokens } },
    { v: "2025-04-01-preview", body: { ...base, max_completion_tokens: maxTokens, reasoning_effort: "low" } },
    { v: "2025-04-01-preview", body: { ...base, max_completion_tokens: maxTokens } },
  ];
  const deadline = Date.now() + timeoutMs;
  // deno-lint-ignore no-explicit-any
  let last: any = null;
  for (const a of attempts) {
    const r = await fetch(`${AOAI}/openai/deployments/${DEPLOYMENT}/chat/completions?api-version=${a.v}`, {
      method: "POST", headers: { "api-key": AOAI_KEY, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(Math.max(5_000, deadline - Date.now())), body: JSON.stringify(a.body),
    });
    const out = await r.json().catch(() => ({}));
    if (r.ok) return out;
    last = { status: r.status, message: out?.error?.message ?? "" };
    if (r.status !== 400) break;
  }
  if (last?.status === 404) throw new Error(`Kein KI-Modell mit dem Namen „${DEPLOYMENT}“ bereitgestellt. Bitte in Azure AI Foundry ein Modell unter diesem Namen bereitstellen.`);
  throw new Error(`KI-Anfrage fehlgeschlagen (${last?.status}): ${last?.message}`);
}
// deno-lint-ignore no-explicit-any
async function writeDraft(p: any) {
  const user = `MITSCHRIFT:\n${p.notes?.trim() || "(keine Mitschrift)"}\n\nABSCHRIFT DER AUFNAHME:\n${p.transcript?.trim() || "(keine Aufnahme)"}`;
  const out = await chat([{ role: "system", content: systemPrompt(await boardList(), dmy(p.meeting_date)) }, { role: "user", content: user }], 16000, true, 135_000);
  const d = JSON.parse(out.choices?.[0]?.message?.content ?? "{}");
  const list = (v: unknown) => Array.isArray(v) ? v.join("\n") : (v ?? "") as string;
  return {
    chair: d.chair || null, recorder: d.recorder || null, present: list(d.present) || null, absent: list(d.absent) || null,
    ended_at: d.ended_at || null, body: String(d.body ?? "").trim(), hints: list(d.hinweise) || null,
  };
}

async function poll() {
  const { data: running } = await db.from("protocols").select("id,job_ref,job_started_at").eq("job_state", "transkription");
  for (const p of running ?? []) {
    try { await checkTranscription(p); } catch (e) { console.error("Abfrage", p.id, e); }
  }
  // Höchstens einen Entwurf pro Lauf schreiben; hängengebliebene nach 10 Minuten erneut versuchen
  const stale = new Date(Date.now() - 10 * 60e3).toISOString();
  const { data: next } = await db.from("protocols").select("id")
    .or(`job_state.eq.entwurf,and(job_state.eq.schreibt,job_started_at.lt.${stale})`).order("id").limit(1);
  if (!next?.length) return;
  const { data: claimed } = await db.from("protocols").update({ job_state: "schreibt", job_started_at: new Date().toISOString() })
    .eq("id", next[0].id).in("job_state", ["entwurf", "schreibt"]).select("*").maybeSingle();
  if (!claimed) return;
  try {
    const draft = await writeDraft(claimed);
    await db.from("protocols").update({ ...draft, job_state: "fertig", job_error: null }).eq("id", claimed.id);
    if (claimed.created_by) await push([claimed.created_by], { title: "Protokollentwurf fertig", body: `${claimed.title} vom ${dmy(claimed.meeting_date)} – bitte durchsehen.`, url: `./#prot-${claimed.id}`, tag: `prot-${claimed.id}` });
  } catch (e) {
    await db.from("protocols").update({ job_state: "fehler", job_error: String((e as Error).message ?? e) }).eq("id", claimed.id);
  }
}

// ---------- Verbindungsprüfung ----------
async function check() {
  const out: Record<string, string> = {};
  try {
    const r = await fetch(`${SPEECH}/speechtotext/v3.2/transcriptions`, { method: "POST", headers: speechHeaders(),
      body: JSON.stringify({ displayName: "Verbindungstest", locale: "de-AT", contentUrls: [`${SUPABASE_URL}/functions/v1/protokoll?test=1`], properties: { timeToLiveHours: 6 } }) });
    const b = await r.json().catch(() => ({}));
    if (b.self) await fetch(b.self, { method: "DELETE", headers: speechHeaders() });
    out.speech = r.ok ? "ok" : /Standard/.test(b?.message ?? "") ? "Gratis-Tarif F0 – bitte auf S0 umstellen" : `Fehler ${r.status}: ${b?.message ?? ""}`;
  } catch (e) { out.speech = `Fehler: ${(e as Error).message}`; }
  try {
    const b = await chat([{ role: "user", content: "Antworte nur mit OK." }], 200, false, 40_000);
    out.ki = `ok (${b.model ?? DEPLOYMENT})`;
  } catch (e) {
    out.ki = (e as Error).message;
    // Hilfe bei der Fehlersuche: welche Ressource ist eingetragen, welche Bereitstellungen gibt es dort?
    try { out.ki_ressource = new URL(AOAI).host; } catch { out.ki_ressource = AOAI ? "ungültige Adresse" : "nicht eingetragen"; }
    try {
      const r = await fetch(`${AOAI}/openai/deployments?api-version=2022-12-01`, { headers: { "api-key": AOAI_KEY }, signal: AbortSignal.timeout(15_000) });
      const b = await r.json().catch(() => ({}));
      // deno-lint-ignore no-explicit-any
      out.ki_bereitstellungen = r.ok ? ((b.data ?? []) as any[]).map((d) => `${d.id} (${d.model})`).join(", ") || "keine" : `Abfrage nicht möglich (${r.status})`;
    } catch (err) { out.ki_bereitstellungen = `Abfrage nicht möglich: ${(err as Error).message}`; }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const url = new URL(req.url);
  if ((req.method === "GET" || req.method === "HEAD") && url.searchParams.has("audio")) return serveAudio(req, url);
  if (req.method !== "POST") return json({ error: "Nicht erlaubt." }, 405);
  let body: { mode?: string; id?: number; ids?: number[] } = {};
  try { body = await req.json(); } catch { /* leer */ }

  if (body.mode === "poll") {
    if (req.headers.get("x-cron-secret") !== await secret("cron_secret")) return json({ error: "Nicht erlaubt." }, 401);
    EdgeRuntime.waitUntil(poll());
    return json({ ok: true });
  }

  if (body.mode === "check" && req.headers.get("x-cron-secret") === await secret("cron_secret")) return json(await check());
  const me = await requireAdmin(req);
  if (!me) return json({ error: "Nur Admins." }, 403);

  if (body.mode === "check") return json(await check());

  // Mehrere hochgeladene Protokolle: eine einzige Push-Nachricht an den Vorstand
  if (body.mode === "notify" && Array.isArray(body.ids) && body.ids.length > 1) {
    const { data: list } = await db.from("protocols").select("id,title,meeting_date,status").in("id", body.ids).eq("status", "final").order("meeting_date", { ascending: false });
    if (!list?.length) return json({ error: "Keine finalen Protokolle." }, 400);
    const { data: board } = await db.from("members").select("id").eq("is_board", true).eq("active", true);
    const sent = await push((board ?? []).map((m) => m.id), { title: "Neue Vorstandsprotokolle", body: `${list.length} Protokolle wurden ins Archiv gestellt (zuletzt: ${list[0].title} vom ${dmy(list[0].meeting_date)}).`, url: `./#prot-${list[0].id}`, tag: "prot-import" });
    return json({ sent });
  }

  const { data: p } = await db.from("protocols").select("*").eq("id", body.id ?? body.ids?.[0] ?? 0).maybeSingle();
  if (!p) return json({ error: "Protokoll nicht gefunden." }, 404);

  if (body.mode === "start") {
    try {
      // Liegt schon eine Abschrift vor (z. B. „Entwurf neu erstellen“), wird nicht erneut transkribiert
      if (p.audio_parts > 0 && !p.transcript?.trim()) {
        const ref = await startTranscription(p.id);
        await db.from("protocols").update({ job_state: "transkription", job_ref: ref, job_error: null, job_started_at: new Date().toISOString() }).eq("id", p.id);
      } else if (p.notes?.trim() || p.transcript?.trim()) {
        await db.from("protocols").update({ job_state: "entwurf", job_error: null, job_started_at: new Date().toISOString() }).eq("id", p.id);
        EdgeRuntime.waitUntil(poll());
      } else {
        return json({ error: "Weder Mitschrift noch Aufnahme vorhanden." }, 400);
      }
      return json({ ok: true });
    } catch (e) {
      await db.from("protocols").update({ job_state: "fehler", job_error: String((e as Error).message) }).eq("id", p.id);
      return json({ error: String((e as Error).message) }, 502);
    }
  }

  if (body.mode === "notify") {
    if (p.status !== "final") return json({ error: "Protokoll ist noch nicht final." }, 400);
    const { data: board } = await db.from("members").select("id").eq("is_board", true).eq("active", true);
    const sent = await push((board ?? []).map((m) => m.id), { title: "Neues Vorstandsprotokoll", body: `${p.title} vom ${dmy(p.meeting_date)} steht in der App bereit.`, url: `./#prot-${p.id}`, tag: `prot-${p.id}` });
    return json({ sent });
  }

  return json({ error: "Unbekannte Aktion." }, 400);
});
