/* Speckbacher-App – Vorstandsbereich (nur für Mitglieder mit dem Häkchen „Vorstand“)
   Reiter „Sitzungen“: kommende Vorstandssitzungen mit eigener Zu-/Absage und Überblick, wer kommt;
   vergangene Sitzungen mit Link zum Protokoll. Reiter „Protokolle“: Archiv und Protokollerstellung (protokolle.js).
   Weitere Vorstandsfunktionen kommen hier als zusätzliche Reiter dazu. Nutzt state, esc … aus app.js. */

state.boardTab = "sitzungen";

function boardResponses(e) {
  const board = state.members.filter(m => m.is_board);
  const st = id => state.responses.find(r => r.event_id === e.id && r.member_id === id)?.status;
  return { yes: board.filter(m => st(m.id) === "yes"), no: board.filter(m => st(m.id) === "no"), open: board.filter(m => !st(m.id)) };
}
const protFor = e => (state.protocols || []).find(p => p.event_id === e.id || (!p.date_is_month && p.meeting_date === e.event_date));
const names = list => list.map(m => esc(fullName(m))).join(", ");

function sessionCard(e, next) {
  const r = myResp(e.id), t = boardResponses(e);
  const act = r === "yes" ? `<span class="status yes">Zugesagt</span><button class="btn ghost" data-cal="${e.id}">In Kalender</button><button class="btn ghost" data-undo="${e.id}">Ändern</button>`
    : r === "no" ? `<span class="status no">Abgesagt</span><button class="btn ghost" data-undo="${e.id}">Ändern</button>`
    : `<button class="btn yes" data-yes="${e.id}">Zusagen</button><button class="btn no" data-no="${e.id}">Absagen</button>`;
  return `<article class="card${next ? " next-session" : ""}">
    <div class="date"><div class="d">${day(e.event_date)}</div><div class="w">${wd(e.event_date)}</div></div>
    <div class="body">
      ${next ? `<span class="type t-vorstand">Nächste Sitzung</span>` : ""}
      <h3>${esc(e.title)}</h3>
      <p class="meta"><span>${longDate(e.event_date)}</span><span>${timesLine(e)}</span><span>${esc(e.place)}</span>${e.notes ? `<span>${esc(e.notes)}</span>` : ""}</p>
      <div class="actions">${act}</div>
      <p class="rule">${t.yes.length ? `<b>Zugesagt (${t.yes.length}):</b> ${names(t.yes)}<br>` : ""}${t.no.length ? `<b>Abgesagt (${t.no.length}):</b> ${names(t.no)}<br>` : ""}${t.open.length ? `Noch offen: ${t.open.length}` : "Alle haben geantwortet."}</p>
    </div></article>`;
}

function renderSessions() {
  if (state.protocols === null) loadProtocols().then(() => state.role === "board" && render());
  const all = state.events.filter(e => e.kind === "vorstand");
  const coming = all.filter(e => !isPast(e));
  const past = all.filter(isPast).reverse();
  let html = state.me.is_admin ? `<div class="row-actions" style="margin-bottom:12px"><button class="btn" id="board-new-session">Neue Vorstandssitzung</button></div>` : "";
  html += `<div class="month">Kommende Sitzungen</div>`;
  html += coming.length ? `<div class="list">${coming.map((e, i) => sessionCard(e, i === 0)).join("")}</div>` : `<p class="empty">Keine Vorstandssitzungen eingetragen.</p>`;
  if (past.length) {
    html += `<div class="month">Vergangene Sitzungen</div><div class="panel"><table><tbody>${past.map(e => {
      const p = protFor(e);
      const label = !p ? `<span class="fn">kein Protokoll</span>` : p.status === "final" || !state.me.is_admin
        ? `<button class="btn ghost" data-board-prot="${p.id}">Protokoll</button>` : `<button class="btn ghost" data-board-prot="${p.id}">Entwurf</button>`;
      return `<tr><td><b>${esc(e.title)}</b><br><span class="fn">${esc(longDate(e.event_date))}</span></td><td style="text-align:right">${label}</td></tr>`;
    }).join("")}</tbody></table></div>`;
  }
  return html;
}

function renderBoard() {
  const tabs = `<div class="seg sm" role="group" aria-label="Vorstand">
    <button data-btab="sitzungen" aria-pressed="${state.boardTab === "sitzungen"}">Sitzungen</button>
    <button data-btab="prot" aria-pressed="${state.boardTab === "prot"}">Protokolle</button></div>`;
  return tabs + (state.boardTab === "prot" ? renderProtocols() : renderSessions());
}

document.addEventListener("click", async ev => {
  const t = ev.target.closest("button");
  if (!t || !state.me) return;
  const d = t.dataset;
  if (d.btab) { state.boardTab = d.btab; state.protOpen = null; state.protEdit = null; state.protImport = null; render(); scrollTo(0, 0); return; }
  if (d.boardProt) {
    const p = protById(+d.boardProt);
    state.boardTab = "prot";
    if (state.me.is_admin && p && p.status !== "final") state.protEdit = p.id; else state.protOpen = +d.boardProt;
    render(); scrollTo(0, 0); return;
  }
  if (t.id === "board-new-session") { state.role = "admin"; state.adminTab = "neu"; state.newKind = "vorstand"; render(); scrollTo(0, 0); }
});
