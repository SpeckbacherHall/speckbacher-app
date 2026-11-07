/* Speckbacher-App – Fibel
   Mitglieder lesen die veröffentlichten Kapitel. Admins schreiben, ordnen und veröffentlichen sie
   direkt in derselben Ansicht. Text: Leerzeile = neuer Absatz, Zeile mit "## " = Zwischenüberschrift.
   Nutzt state, db, esc … aus app.js. */

const fibelSorted = () => [...(state.fibel || [])].sort((a, b) => a.sort - b.sort || a.id - b.id);
function fibelBody(text) {
  return (text || "").split(/\n{2,}/).map(x => x.trim()).filter(Boolean).map(block =>
    block.startsWith("## ") ? `<h3>${esc(block.slice(3))}</h3>` : `<p>${esc(block).replace(/\n/g, "<br>")}</p>`).join("");
}
const firstSentence = t => { const s = (t || "").replace(/^##.*$/m, "").trim().split(/(?<=[.!?])\s/)[0] || ""; return s.length > 140 ? s.slice(0, 137) + " …" : s; };

function renderFibel() {
  const admin = state.me.is_admin;
  if (state.fibelEdit) return renderFibelEditor();
  const ch = state.fibelOpen ? state.fibel.find(c => c.id === state.fibelOpen) : null;
  if (ch) {
    const list = fibelSorted().filter(c => admin || c.published);
    const i = list.findIndex(c => c.id === ch.id);
    return `<button class="back" id="fibel-back">${ico("arrow_back")}Inhalt der Fibel</button>
    <article class="panel fibel-text">
      ${!ch.published ? `<span class="pill off">Entwurf – nur für Admins sichtbar</span>` : ""}
      <h2>${esc(ch.title)}</h2>
      ${fibelBody(ch.body)}
    </article>
    <div class="row-actions" style="margin-top:12px;justify-content:space-between">
      ${i > 0 ? `<button class="btn" data-fibel="${list[i - 1].id}">‹ ${esc(list[i - 1].title)}</button>` : "<span></span>"}
      ${i < list.length - 1 ? `<button class="btn" data-fibel="${list[i + 1].id}">${esc(list[i + 1].title)} ›</button>` : ""}
    </div>
    ${admin ? `<div class="row-actions" style="margin-top:8px"><button class="btn ghost" data-fibel-edit="${ch.id}">Kapitel bearbeiten</button></div>` : ""}`;
  }
  const list = fibelSorted().filter(c => admin || c.published);
  return `<button class="back" id="fibel-close">${ico("arrow_back")}Zu den Ausrückungen</button>
  <div class="panel">
    <h2>Fibel</h2>
    <p class="fn">Wissenswertes über unsere Kompanie, ihren Namensgeber und das Schützenwesen. Die Fibel wächst laufend.</p>
    ${list.length ? `<ol class="fibel-toc">${list.map(c => `<li><button class="fibel-item" data-fibel="${c.id}">
      <b>${esc(c.title)}</b>${!c.published ? ` <span class="pill off">Entwurf</span>` : ""}<br><span class="fn">${esc(firstSentence(c.body))}</span></button></li>`).join("")}</ol>`
      : `<p class="empty">Noch keine Kapitel veröffentlicht.</p>`}
    ${admin ? `<div class="row-actions"><button class="btn yes" data-fibel-edit="new">Neues Kapitel</button></div>` : ""}
  </div>`;
}
function renderFibelEditor() {
  const isNew = state.fibelEdit === "new";
  const c = isNew ? { title: "", body: "", sort: (fibelSorted().at(-1)?.sort ?? 0) + 10, published: false } : state.fibel.find(x => x.id === state.fibelEdit);
  return `<button class="back" id="fibel-edit-cancel" type="button">${ico("arrow_back")}Zurück</button>
  <form class="panel" id="fibel-form">
    <h2>${isNew ? "Neues Kapitel" : "Kapitel bearbeiten"}</h2>
    <label for="fb-title">Überschrift<input id="fb-title" required value="${esc(c.title)}"></label>
    <label for="fb-body">Text<textarea id="fb-body" rows="14">${esc(c.body)}</textarea></label>
    <p class="rule">Leerzeile = neuer Absatz. Eine Zeile, die mit „## “ beginnt, wird zur Zwischenüberschrift.</p>
    <div class="grid2">
      <label for="fb-sort">Reihenfolge (kleiner = weiter vorne)<input id="fb-sort" type="number" step="1" value="${c.sort}"></label>
      <label class="check" for="fb-pub" style="align-self:end"><input id="fb-pub" type="checkbox" ${c.published ? "checked" : ""}> Für alle veröffentlicht</label>
    </div>
    <div class="row-actions">
      <button class="btn yes" type="submit" id="fb-save">Speichern</button>
      ${!isNew ? (state.fibelConfirmDelete
        ? `<span class="fn">Kapitel wirklich löschen?</span><button class="btn danger" type="button" id="fb-del-yes">Ja, löschen</button><button class="btn ghost" type="button" id="fb-del-no">Abbrechen</button>`
        : `<button class="btn danger" type="button" id="fb-del">Löschen</button>`) : ""}
    </div>
  </form>`;
}
async function saveFibel() {
  const row = { title: $("#fb-title").value.trim(), body: $("#fb-body").value.trim(), sort: Number($("#fb-sort").value) || 0, published: $("#fb-pub").checked };
  const isNew = state.fibelEdit === "new";
  const { data, error } = isNew ? await db.from("fibel_chapters").insert(row).select().single()
    : await db.from("fibel_chapters").update(row).eq("id", state.fibelEdit).select().single();
  if (error) { $("#fb-save").disabled = false; return fail(error, "Das Kapitel konnte nicht gespeichert werden."); }
  state.fibel = state.fibel.filter(c => c.id !== data.id).concat(data);
  state.fibelEdit = null; state.fibelOpen = data.id; render(); scrollTo(0, 0);
  toast(data.published ? "Gespeichert und für alle sichtbar." : "Als Entwurf gespeichert.");
}

document.addEventListener("click", async ev => {
  const t = ev.target.closest("button");
  if (!t || !state.me) return;
  const d = t.dataset;
  if (t.id === "open-fibel") { state.showFibel = true; state.fibelOpen = null; render(); scrollTo(0, 0); return; }
  if (t.id === "fibel-close") { state.showFibel = false; render(); return; }
  if (t.id === "fibel-back") { state.fibelOpen = null; render(); return; }
  if (d.fibel) { state.fibelOpen = +d.fibel; render(); scrollTo(0, 0); return; }
  if (d.fibelEdit) { state.fibelEdit = d.fibelEdit === "new" ? "new" : +d.fibelEdit; state.fibelConfirmDelete = false; render(); scrollTo(0, 0); return; }
  if (t.id === "fibel-edit-cancel") { state.fibelEdit = null; render(); return; }
  if (t.id === "fb-del") { state.fibelConfirmDelete = true; render(); return; }
  if (t.id === "fb-del-no") { state.fibelConfirmDelete = false; render(); return; }
  if (t.id === "fb-del-yes") {
    const id = state.fibelEdit;
    const { error } = await db.from("fibel_chapters").delete().eq("id", id);
    if (error) return fail(error, "Das Kapitel konnte nicht gelöscht werden.");
    state.fibel = state.fibel.filter(c => c.id !== id);
    state.fibelEdit = null; state.fibelOpen = null; state.fibelConfirmDelete = false; render(); toast("Kapitel gelöscht.");
  }
});
document.addEventListener("submit", ev => {
  if (ev.target.id !== "fibel-form") return;
  ev.preventDefault();
  $("#fb-save").disabled = true;
  saveFibel();
});
