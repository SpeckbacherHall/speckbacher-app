/* Speckbacher-App – Abgleich mit dem BTSK-Export
   Admin lädt die Mitgliederliste aus dem Portal des Bundes der Tiroler Schützenkompanien (CSV, ; getrennt)
   hoch. Die App zeigt neue Mitglieder, geänderte Angaben und Mitglieder, die nur in der App stehen.
   Übernommen wird nur, was angehakt ist. Gewehrnummern, Vorstand, Admin und App-Zugänge bleiben unberührt.
   Nutzt state, db, esc … aus app.js. */

const SYNC_FIELDS = [
  ["email", "E-Mail"], ["phone", "Telefon"], ["address", "Adresse"], ["birthday", "Geburtstag"],
  ["joined_on", "Beitritt"], ["rank", "Rang"], ["role_title", "Funktion"], ["gender", "Anrede"],
  ["needs_post", "Postversand"], ["active", "Aktiv"]
];
const MEMBER_COLS = new Set(["rank", "role_title", "gender", "active"]);
const normKey = (f, l) => `${f} ${l}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");
const clean = v => (v ?? "").toString().trim().replace(/\s+/g, " ");
const isoFromDe = v => { const m = clean(v).match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null; };
const shown = (k, v) => v === null || v === undefined || v === "" ? "–"
  : k === "birthday" || k === "joined_on" ? dmy(v)
  : k === "gender" ? (v === "w" ? "Frau" : "Herr")
  : typeof v === "boolean" ? (v ? "ja" : "nein") : String(v);

function decodeCsv(buf) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); }
  catch (e) { return new TextDecoder("windows-1252").decode(buf); }
}
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ";") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some(x => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some(x => x.trim())) rows.push(row);
  const head = rows.shift().map(h => h.replace(/^﻿/, "").trim());
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}
// Eine Zeile des BTSK-Exports in die Felder der App übersetzen
function fromBtsk(r) {
  const phone = clean(r["Telefon"]);
  const addr = [clean(r["Straße"] ?? r["Strasse"]), clean(`${clean(r["PLZ"])} ${clean(r["Ort"])}`), clean(r["Land"])].filter(Boolean).join(", ");
  return {
    first_name: clean(r["Vorname"]), last_name: clean(r["Nachname"]),
    email: clean(r["E-Mail"]).toLowerCase() || null,
    phone: phone && !/E[-+]\d/.test(phone) ? phone : null,   // von Excel zerstörte Nummern ignorieren
    address: addr || null,
    birthday: isoFromDe(r["Geburtstag"]),
    joined_on: isoFromDe(r["Beitritt"]),
    rank: clean(r["Rang"]) || null,
    role_title: clean(r["Funktion"]) || null,
    gender: /^w/i.test(clean(r["Geschlecht"])) ? "w" : /^m/i.test(clean(r["Geschlecht"])) ? "m" : null,
    needs_post: /post/i.test(clean(r["Zustellung"])),
    active: /^aktiv/i.test(clean(r["Status"]))
  };
}
function currentValues(m) {
  const p = priv(m);
  return { email: p.email ?? null, phone: p.phone ?? null, address: p.address ?? null, birthday: p.birthday ?? null,
    joined_on: p.joined_on ?? null, rank: m.rank ?? null, role_title: m.role_title ?? null, gender: m.gender ?? null,
    needs_post: !!p.needs_post, active: !!m.active };
}
function analyse(rows) {
  const byKey = new Map(state.allMembers.map(m => [normKey(m.first_name, m.last_name), m]));
  const seen = new Set(), fresh = [], changed = [];
  for (const r of rows) {
    const b = fromBtsk(r);
    if (!b.first_name || !b.last_name) continue;
    const key = normKey(b.first_name, b.last_name);
    const m = byKey.get(key);
    if (!m) { fresh.push(b); continue; }
    seen.add(m.id);
    const cur = currentValues(m);
    // Leere Felder im Export überschreiben keine vorhandenen Angaben
    const diffs = SYNC_FIELDS.filter(([k]) => {
      const nv = b[k], ov = cur[k];
      if (typeof nv !== "boolean" && (nv === null || nv === "")) return false;
      return clean(nv).toLowerCase() !== clean(ov).toLowerCase();
    }).map(([k, label]) => ({ k, label, from: cur[k], to: b[k] }));
    if (diffs.length) changed.push({ m, diffs });
  }
  const onlyApp = state.allMembers.filter(m => !seen.has(m.id));
  return { fresh, changed, onlyApp, total: rows.length };
}

function renderSync() {
  const a = state.sync;
  let html = `<button class="back" id="sync-close" type="button">‹ Alle Mitglieder</button>
  <div class="panel"><h2>Abgleich mit dem BTSK-Export</h2>
    <p class="fn">Mitgliederliste im BTSK-Portal als CSV exportieren und hier hochladen. Die App zeigt, was sich unterscheidet. Übernommen wird nur, was du anhakst. Gewehrnummern, Vorstand, Admin und App-Zugänge bleiben unverändert.</p>
    <label class="btn" for="sync-file" style="align-self:flex-start">CSV-Datei wählen<input id="sync-file" type="file" accept=".csv,text/csv" hidden></label>
  </div>`;
  if (!a) return html;
  const box = (id, on = true) => `<input type="checkbox" class="sync-pick" id="${id}" ${on ? "checked" : ""}>`;
  html += `<p class="rule" style="margin:12px 0">${a.total} Zeilen gelesen · ${a.fresh.length} neu · ${a.changed.length} mit Änderungen · ${a.onlyApp.length} nur in der App</p>`;
  html += `<div class="panel"><h2>Neu im BTSK <span class="fn">(${a.fresh.length})</span></h2>
    ${a.fresh.length ? a.fresh.map((b, i) => `<label class="check sync-row" for="sync-new-${i}">${box(`sync-new-${i}`, b.active)}
      <span><b>${esc(b.first_name)} ${esc(b.last_name)}</b>${!b.active ? ` <span class="pill off">nicht aktiv</span>` : ""}<br>
      <span class="fn">${esc([b.rank, b.role_title, b.email, b.phone].filter(Boolean).join(" · ") || "–")}</span></span></label>`).join("") : `<p class="empty">Keine neuen Mitglieder.</p>`}
  </div>
  <div class="panel" style="margin-top:12px"><h2>Geänderte Angaben <span class="fn">(${a.changed.length})</span></h2>
    ${a.changed.length ? a.changed.map((c, i) => `<div class="sync-row"><b>${esc(fullName(c.m))}</b>
      ${c.diffs.map((d, j) => `<label class="check" for="sync-ch-${i}-${j}">${box(`sync-ch-${i}-${j}`, (d.k !== "active" || d.to) && !(d.k === "email" && c.m.user_id))}
        <span><span class="fn">${d.label}:</span> <s>${esc(shown(d.k, d.from))}</s> → <b>${esc(shown(d.k, d.to))}</b></span></label>`).join("")}</div>`).join("") : `<p class="empty">Keine Änderungen.</p>`}
  </div>
  <div class="panel" style="margin-top:12px"><h2>Nur in der App <span class="fn">(${a.onlyApp.length})</span></h2>
    <p class="fn">Diese Personen fehlen im Export. Bitte prüfen, ob sie ausgetreten sind (dann „Aktiv“ abhaken) oder anders geschrieben werden. Hier wird nichts automatisch geändert.</p>
    ${a.onlyApp.length ? `<ul class="sync-list">${a.onlyApp.map(m => `<li>${esc(fullName(m))}${!m.active ? ` <span class="pill off">inaktiv</span>` : ""}</li>`).join("")}</ul>` : ""}
  </div>
  <p class="rule" style="margin-top:12px">Nicht vorausgewählt sind Deaktivierungen (die Person könnte sich nicht mehr anmelden) und neue E-Mail-Adressen bei Mitgliedern mit App-Zugang (die E-Mail ist ihre Anmeldung).</p>
  <div class="row-actions" style="margin-top:8px"><button class="btn yes" id="sync-apply" ${a.fresh.length + a.changed.length ? "" : "disabled"}>Ausgewählte übernehmen</button></div>`;
  return html;
}

async function applySync() {
  const a = state.sync;
  let created = 0, updated = 0, failed = 0;
  for (const [i, b] of a.fresh.entries()) {
    if (!$(`#sync-new-${i}`)?.checked) continue;
    const r = await db.from("members").insert({ first_name: b.first_name, last_name: b.last_name, rank: b.rank, role_title: b.role_title, gender: b.gender, active: b.active }).select("id").single();
    if (r.error) { failed++; continue; }
    const r2 = await db.from("member_private").insert({ member_id: r.data.id, email: b.email, phone: b.phone, address: b.address, birthday: b.birthday, joined_on: b.joined_on, needs_post: b.needs_post });
    r2.error ? failed++ : created++;
  }
  for (const [i, c] of a.changed.entries()) {
    const picked = c.diffs.filter((d, j) => $(`#sync-ch-${i}-${j}`)?.checked);
    if (!picked.length) continue;
    const mRow = {}, pRow = {};
    picked.forEach(d => (MEMBER_COLS.has(d.k) ? mRow : pRow)[d.k] = d.to);
    let ok = true;
    if (Object.keys(mRow).length) ok = !(await db.from("members").update(mRow).eq("id", c.m.id)).error && ok;
    if (Object.keys(pRow).length) ok = !(await db.from("member_private").update(pRow).eq("member_id", c.m.id)).error && ok;
    if (ok && pRow.email && c.m.user_id) await db.functions.invoke("zugang", { body: { member_id: c.m.id, action: "email" } });
    ok ? updated++ : failed++;
  }
  await loadAll();
  state.sync = null; render(); scrollTo(0, 0);
  toast(`${created} angelegt, ${updated} aktualisiert${failed ? `, ${failed} fehlgeschlagen (z. B. doppelte E-Mail)` : ""}.`);
}

document.addEventListener("click", ev => {
  const t = ev.target.closest("button");
  if (!t || !state.me) return;
  if (t.id === "sync-open") { state.syncOpen = true; state.sync = null; render(); scrollTo(0, 0); return; }
  if (t.id === "sync-close") { state.syncOpen = false; state.sync = null; render(); return; }
  if (t.id === "sync-apply") { t.disabled = true; t.textContent = "Wird übernommen …"; applySync(); }
});
document.addEventListener("change", async ev => {
  if (ev.target.id !== "sync-file" || !ev.target.files[0]) return;
  try {
    const rows = parseCsv(decodeCsv(await ev.target.files[0].arrayBuffer()));
    if (!rows.length || !("Vorname" in rows[0]) || !("Nachname" in rows[0])) return toast("Die Datei hat keine Spalten „Vorname“ und „Nachname“. Bitte den Mitglieder-Export als CSV wählen.");
    state.sync = analyse(rows);
    render();
  } catch (e) { console.error(e); toast("Die Datei konnte nicht gelesen werden."); }
});
