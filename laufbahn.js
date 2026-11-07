/* Speckbacher-App – Laufbahn & Auszeichnungen aus dem BTSK-Stammdatenblatt
   Tabelle member_history: Mitglieder sehen ihre eigene, Admins alle (in der Mitgliederbearbeitung).
   Nutzt state, db, esc, dmy, priv, fullName … aus app.js. */

const HIST_GROUPS = [
  ["rang", "Ränge"],
  ["funktion", "Funktionen"],
  ["auszeichnung", "Auszeichnungen"],
  ["langjaehrigkeit", "Langjährigkeit"],
  ["schiessleistung", "Schießleistung"],
  ["erinnerung", "Erinnerungsmedaillen"],
  ["mitgliedschaft", "Mitgliedschaften"]
];
// Kompanie- und externe Auszeichnungen erscheinen bei den Auszeichnungen
const histGroup = k => (k === "kompanie" || k === "extern" ? "auszeichnung" : k);
state.hist = {};

async function ensureHistory(memberId) {
  if (state.hist[memberId]) return fillHistory(memberId);
  const { data, error } = await db.from("member_history").select("kind,title,organisation,date_from,date_to,detail")
    .eq("member_id", memberId).order("date_from", { ascending: false, nullsFirst: false });
  state.hist[memberId] = error ? { error: true } : data;
  fillHistory(memberId);
}
function fillHistory(memberId) {
  const box = document.querySelector(`[data-hist-box="${memberId}"]`);
  if (box) box.innerHTML = historyHtml(state.hist[memberId]);
}
function histWhen(h, isRole) {
  if (!h.date_from) return "";
  if (!isRole) return dmy(h.date_from);
  const from = h.date_from.slice(0, 4), to = h.date_to?.slice(0, 4);
  return h.date_to ? (from === to ? from : `${from}–${to}`) : `seit ${from}`;
}
function historyHtml(rows) {
  if (!rows) return `<p class="empty">Wird geladen …</p>`;
  if (rows.error) return `<p class="empty">Die Laufbahn konnte nicht geladen werden.</p>`;
  if (!rows.length) return `<p class="empty">Keine Einträge aus dem Stammdatenblatt.</p>`;
  return HIST_GROUPS.map(([k, label]) => {
    const list = rows.filter(h => histGroup(h.kind) === k);
    if (!list.length) return "";
    const isRole = ["rang", "funktion", "mitgliedschaft"].includes(k);
    // Laufende Ränge/Funktionen zuerst
    if (isRole) list.sort((a, b) => (!!a.date_to - !!b.date_to) || (b.date_from || "").localeCompare(a.date_from || ""));
    return `<div class="sec"><h4>${label} <span>${list.length}</span></h4><ul class="hist-list">
      ${list.map(h => {
        const other = h.organisation && h.organisation !== "SK Speckbacher" ? ` · ${esc(h.organisation)}` : "";
        const title = k === "mitgliedschaft" ? `${esc(h.title)}${h.organisation ? ` – ${esc(h.organisation)}` : ""}` : esc(h.title) + other;
        return `<li class="${isRole && !h.date_to ? "now" : ""}"><span>${title}</span><span class="fn">${histWhen(h, isRole)}</span></li>`;
      }).join("")}
    </ul></div>`;
  }).join("");
}
function historyPanel(memberId, heading = "Laufbahn &amp; Auszeichnungen") {
  setTimeout(() => ensureHistory(memberId), 0);
  return `<div class="panel" style="margin-top:12px"><h2>${heading}</h2>
    <div data-hist-box="${memberId}">${historyHtml(state.hist[memberId])}</div>
    <p class="rule">Stand laut Stammdatenblatt des Bundes der Tiroler Schützenkompanien.</p></div>`;
}

function renderMyHistory() {
  const m = state.me, p = priv(m);
  const facts = [
    p.joined_on && `Bei der Kompanie seit ${dmy(p.joined_on)}`,
    m.rank && `Rang: ${esc(m.rank)}`,
    m.role_title && `Funktion: ${esc(m.role_title)}`
  ].filter(Boolean);
  return `<button class="back" id="hist-close">${ico("arrow_back")}Zu den Ausrückungen</button>
  <div class="panel"><h2>${esc(fullName(m))}</h2>${facts.map(f => `<p>${f}</p>`).join("") || `<p class="empty">Keine Angaben.</p>`}</div>
  ${historyPanel(m.id)}`;
}

document.addEventListener("click", ev => {
  const t = ev.target.closest("button");
  if (!t || !state.me) return;
  if (t.id === "open-history") { state.showHistory = true; render(); scrollTo(0, 0); }
  if (t.id === "hist-close") { state.showHistory = false; render(); scrollTo(0, 0); }
});
