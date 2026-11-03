/* Speckbacher-App – Meine Daten & Änderungsmeldungen
   Mitglieder ändern Telefon, Adresse und Geburtstag selbst und können dem Schriftführer eine Nachricht
   schicken (z. B. neue E-Mail-Adresse). Die Datenbank protokolliert jede Änderung in member_changes und
   schickt den Admins eine Push-Nachricht. Admins sehen offene Meldungen unter Admin → Mitglieder.
   Nutzt state, db, esc, dmy, priv, fullName, field, toast, loadAll … aus app.js. */

const CHANGE_LABELS = { phone: "Telefon (mobil)", phone_private: "Telefon privat", phone_work: "Telefon beruflich", address: "Adresse", birthday: "Geburtstag" };
const changeValue = (k, v) => (v === null || v === undefined || v === "" ? "–" : k === "birthday" ? dmy(v) : String(v));

function renderMyData() {
  const p = priv(state.me);
  return `<button class="back" id="mydata-close">‹ Zu den Ausrückungen</button>
  <form class="panel" id="mydata-form">
    <h2>Meine Daten</h2>
    <p class="fn">Was du hier änderst, gilt sofort. Der Schriftführer wird automatisch verständigt und trägt es auch beim Bund der Tiroler Schützenkompanien nach.</p>
    ${field("md-phone", "Telefon (mobil)", p.phone, "tel", 'autocomplete="tel"')}
    <div class="grid2">${field("md-phone-private", "Telefon privat", p.phone_private, "tel")}${field("md-phone-work", "Telefon beruflich", p.phone_work, "tel")}</div>
    ${field("md-address", "Adresse (Straße, PLZ Ort)", p.address, "text", 'autocomplete="street-address"')}
    ${field("md-birthday", "Geburtstag", p.birthday, "date")}
    <label for="md-email">E-Mail (Anmeldung)<input id="md-email" type="email" value="${esc(p.email ?? "")}" disabled></label>
    <label for="md-note">Nachricht an den Schriftführer <span class="fn">(optional, z. B. neue E-Mail-Adresse oder Namensänderung)</span><textarea id="md-note" rows="3"></textarea></label>
    <div class="row-actions"><button class="btn yes" type="submit" id="md-submit">Speichern</button><button class="btn ghost" type="button" id="mydata-close2">Abbrechen</button></div>
  </form>`;
}

async function saveMyData() {
  const p = priv(state.me);
  const val = id => $(id).value.trim() || null;
  const next = { phone: val("#md-phone"), phone_private: val("#md-phone-private"), phone_work: val("#md-phone-work"), address: val("#md-address"), birthday: val("#md-birthday") };
  const diff = Object.fromEntries(Object.entries(next).filter(([k, v]) => (p[k] ?? null) !== v));
  const note = val("#md-note");
  if (!Object.keys(diff).length && !note) { toast("Es wurde nichts geändert."); $("#md-submit").disabled = false; return; }
  if (Object.keys(diff).length) {
    const { error } = await db.from("member_private").update(diff).eq("member_id", state.me.id);
    if (error) { console.error(error); $("#md-submit").disabled = false; return toast("Speichern hat nicht geklappt. Bitte versuch es noch einmal."); }
  }
  if (note) {
    const { error } = await db.from("member_changes").insert({ member_id: state.me.id, note });
    if (error) { console.error(error); toast("Die Nachricht konnte nicht gesendet werden."); }
  }
  await loadAll();
  state.showMyData = false; render(); scrollTo(0, 0);
  toast("Gespeichert. Der Schriftführer wurde verständigt.");
}

/* Admin: offene Änderungsmeldungen */
function changesPanel() {
  const open = (state.changes || []).filter(c => !c.seen_at);
  if (!open.length) return "";
  const name = id => { const m = state.allMembers.find(x => x.id === id); return m ? fullName(m) : "Unbekannt"; };
  const when = iso => new Date(iso).toLocaleString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return `<div class="panel changes" id="aenderungen" style="margin-bottom:12px"><h2>Änderungen von Mitgliedern <span class="pill">${open.length} neu</span></h2>
    <p class="fn">Bitte bei Bedarf auch im BTSK-Portal nachtragen und dann abhaken.</p>
    ${open.map(c => `<div class="change-row">
      <p><b><button class="linkish" type="button" data-edit="${c.member_id}">${esc(name(c.member_id))}</button></b> <span class="fn">${when(c.changed_at)}</span></p>
      ${Object.entries(c.changes || {}).map(([k, d]) => `<p class="fn">${CHANGE_LABELS[k] || esc(k)}: <s>${esc(changeValue(k, d.from))}</s> → <b>${esc(changeValue(k, d.to))}</b></p>`).join("")}
      ${c.note ? `<p class="change-note">„${esc(c.note)}“</p>` : ""}
      <div class="row-actions"><button class="btn ghost" type="button" data-change-done="${c.id}">Erledigt</button></div>
    </div>`).join("")}
  </div>`;
}
async function markChangeDone(id) {
  const { error } = await db.from("member_changes").update({ seen_at: new Date().toISOString(), seen_by: state.me.id }).eq("id", id);
  if (error) return toast("Konnte nicht abgehakt werden.");
  const c = state.changes.find(x => x.id === id);
  if (c) c.seen_at = new Date().toISOString();
  render();
}
// Link aus der Push-Nachricht: #aenderungen öffnet die Mitgliederverwaltung
function openChangesFromHash() {
  if (location.hash !== "#aenderungen" || !state.me?.is_admin) return;
  state.role = "admin"; state.adminTab = "tel"; state.edit = null; state.syncOpen = false;
  render();
  setTimeout(() => document.getElementById("aenderungen")?.scrollIntoView({ behavior: "smooth" }), 50);
}
window.addEventListener("hashchange", openChangesFromHash);

document.addEventListener("click", ev => {
  const t = ev.target.closest("button");
  if (!t || !state.me) return;
  if (t.id === "open-mydata") { state.showMyData = true; render(); scrollTo(0, 0); return; }
  if (t.id === "mydata-close" || t.id === "mydata-close2") { state.showMyData = false; render(); scrollTo(0, 0); return; }
  if (t.dataset.changeDone) markChangeDone(+t.dataset.changeDone);
});
document.addEventListener("submit", ev => {
  if (ev.target.id !== "mydata-form") return;
  ev.preventDefault();
  $("#md-submit").disabled = true;
  saveMyData();
});
