// Edge Function "zugang": Ein Admin erzeugt für ein Mitglied einen persönlichen Zugangscode.
// Der Code wird als Passwort des Kontos gesetzt; ein neuer Code macht den alten ungültig.
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
function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
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
  try {
    memberId = (await req.json()).member_id;
  } catch {
    return json({ error: "Ungültige Anfrage." }, 400);
  }
  if (!memberId) return json({ error: "Kein Mitglied angegeben." }, 400);

  const { data: m } = await admin.from("members")
    .select("id,user_id,first_name,active,member_private(email)")
    .eq("id", memberId).maybeSingle();
  if (!m) return json({ error: "Mitglied nicht gefunden." }, 404);
  if (!m.active) return json({ error: "Dieses Mitglied ist nicht aktiv." }, 400);
  const p = Array.isArray(m.member_private) ? m.member_private[0] : m.member_private;
  const email = p?.email;
  if (!email) return json({ error: "Für dieses Mitglied ist keine E-Mail-Adresse eingetragen." }, 400);

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
