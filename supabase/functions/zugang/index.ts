// Edge Function "zugang": Ein Admin erzeugt für ein Mitglied einen persönlichen Zugangscode.
// Der Code wird als Passwort des Kontos gesetzt; ein neuer Code macht den alten ungültig.
// Mit action "email" wird nur die Anmelde-E-Mail an die Mitgliedsdaten angeglichen.
// Mit action "delete" wird das Mitglied samt App-Zugang und allen Rückmeldungen endgültig gelöscht.
// Kein Mailversand: der Admin schickt E-Mail-Adresse und Code selbst an das Mitglied.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Ohne leicht verwechselbare Zeichen (0/O, 1/I/L)
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
// Gleichverteilt: Zufallsbytes ab 248 (= 8 × 31) verwerfen, sonst wären einige Zeichen häufiger
function newCode(): string {
  const chars: string[] = [];
  const limit = 256 - (256 % ALPHABET.length);
  while (chars.length < 8) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < limit && chars.length < 8) chars.push(ALPHABET[b % ALPHABET.length]);
    }
  }
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Nur POST erlaubt." }, 405);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  // Aufrufer prüfen: angemeldet, aktiv, Admin
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: caller, error: callerErr } = await admin.auth.getUser(token);
  if (callerErr || !caller?.user) return json({ error: "Nicht angemeldet." }, 401);
  const { data: me } = await admin.from("members").select("id,is_admin,active")
    .eq("user_id", caller.user.id).maybeSingle();
  if (!me?.is_admin || !me.active) return json({ error: "Nur Admins können Zugänge erzeugen." }, 403);

  let memberId: string;
  let action = "code";
  try {
    const body = await req.json();
    memberId = body.member_id;
    if (body.action === "email") action = "email";
    if (body.action === "delete") action = "delete";
  } catch {
    return json({ error: "Ungültige Anfrage." }, 400);
  }
  if (!memberId) return json({ error: "Kein Mitglied angegeben." }, 400);

  const { data: m } = await admin.from("members")
    .select("id,user_id,first_name,active,member_private(email)")
    .eq("id", memberId).maybeSingle();
  if (!m) return json({ error: "Mitglied nicht gefunden." }, 404);

  // Endgültig löschen: zuerst den App-Zugang, dann das Mitglied (Rückmeldungen usw. folgen per Cascade)
  if (action === "delete") {
    if (m.id === me.id) return json({ error: "Du kannst dich nicht selbst löschen." }, 400);
    if (m.user_id) {
      const { error } = await admin.auth.admin.deleteUser(m.user_id);
      if (error) return json({ error: "Der App-Zugang konnte nicht entfernt werden." }, 500);
    }
    const { error } = await admin.from("members").delete().eq("id", m.id);
    if (error) return json({ error: "Das Mitglied konnte nicht gelöscht werden." }, 500);
    return json({ ok: true });
  }
  if (!m.active) return json({ error: "Dieses Mitglied ist nicht aktiv." }, 400);
  const p = Array.isArray(m.member_private) ? m.member_private[0] : m.member_private;
  const email = p?.email;
  if (!email) return json({ error: "Für dieses Mitglied ist keine E-Mail-Adresse eingetragen." }, 400);

  // Nur Anmelde-E-Mail angleichen, nachdem ein Admin sie in den Mitgliedsdaten geändert hat
  if (action === "email") {
    if (!m.user_id) return json({ ok: true });
    const { error } = await admin.auth.admin.updateUserById(m.user_id, { email, email_confirm: true });
    if (error) return json({ error: "Die Anmelde-E-Mail konnte nicht geändert werden." }, 500);
    return json({ ok: true });
  }

  const code = newCode();
  if (m.user_id) {
    const { error } = await admin.auth.admin.updateUserById(m.user_id, { password: code, email });
    if (error) return json({ error: "Der Zugang konnte nicht erneuert werden." }, 500);
  } else {
    // Der Datenbank-Trigger verknüpft das neue Konto über die E-Mail mit dem Mitglied.
    const { error } = await admin.auth.admin.createUser({
      email, password: code, email_confirm: true, app_metadata: { invited: true },
    });
    if (error) return json({ error: "Der Zugang konnte nicht angelegt werden." }, 500);
  }
  return json({ email, code, first_name: m.first_name });
});
