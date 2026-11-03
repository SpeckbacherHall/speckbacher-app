/* Speckbacher-App – Rundschreiben
   Admins stellen das monatliche Rundschreiben aus den Terminen zusammen (mit Vorschau und freiem Text),
   veröffentlichen es mit Push an alle und drucken den Serienbrief für Mitglieder mit Postversand.
   Briefgestaltung nach der Briefvorlage ab 2027. Nutzt state, db, esc … aus app.js. */

// Angaben aus der Briefvorlage – hier ändern, wenn sich Absender oder Bankverbindung ändern
const LETTER = {
  place: "Hall in Tirol",
  sender: "Felix Kranebitter | Schlangglfeld 20 | 6060 Hall in Tirol",
  footer: [
    ["<b>SPECKBACHER - SCHÜTZENKOMPANIE HALL IN TIROL</b>", "Vereinslokal: Bei der Säule 17 | 6060 Hall in Tirol", "Zustelladresse: Speckbacher Hall | Felix Kranebitter |", "Schlangglfeld 20 | 6060 Hall in Tirol"],
    ["schriftführer@speckbacher-schuetzen.at", "+43 664 54 122 04", "speckbacher-schuetzen.at"],
    ["ZVR: 951247832", "Raiffeisen Regionalbank Hall", "IBAN: AT19 3636 2000 0010 2673", "BIC: RZTIAT22362"]
  ],
  intro: "folgende Termine stehen demnächst an. Bitte melde dich frühzeitig beim dienstführenden Oberjäger Simon Mair an oder ab – am einfachsten direkt in der Speckbacher-App:",
  signature: "i.A. Felix Kranebitter\nSchriftführer\nSpeckbacher - Schützenkompanie Hall in Tirol"
};
const PARTICIPATION = { kompanie: "Teilnahmepflicht", sonstig: "Teilnahme erwünscht", fahne: "Fahnenabordnung" };

const nlMonthName = d => dt(d).toLocaleDateString("de-AT", { month: "long" });
const nlMonthTitle = d => dt(d).toLocaleDateString("de-AT", { month: "long", year: "numeric" });
const firstOfMonth = (iso, add = 0) => { const [y, m] = iso.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + add, 1)); return d.toISOString().slice(0, 10); };
const inMonth = (e, month) => e.event_date.slice(0, 7) === month.slice(0, 7);
const nlEvents = month => state.events.filter(e => e.kind !== "vorstand" && inMonth(e, month));
const dmy = iso => { const [y, m, d] = iso.split("-"); return `${d}.${m}.${y}`; };
const fullDate = iso => dt(iso).toLocaleDateString("de-AT", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

/* ---------- Brief (Bildschirm und Druck) ---------- */
function letterItem(e) {
  const time = e.muster_time && e.start_time ? `Antreten ${hm(e.muster_time)} Uhr | Beginn ${hm(e.start_time)} Uhr`
    : e.start_time ? `${hm(e.start_time)} Uhr` : e.muster_time ? `Antreten ${hm(e.muster_time)} Uhr` : "Informationen folgen";
  return `<section class="l-item">
    <h3>${esc(e.title.toUpperCase())}</h3>
    <p>${esc(fullDate(e.event_date))} | ${esc(time)} | ${esc(e.place)}</p>
    ${e.notes && !(time === "Informationen folgen" && e.notes === "Informationen folgen") ? `<p>${esc(e.notes)}</p>` : ""}
    ${e.dress ? `<p>Adjustierung: ${esc(e.dress)}</p>` : ""}
    <p>${PARTICIPATION[e.kind] || ""}</p>
  </section>`;
}
function letterHtml(nl, m, withAddress = true, forPrint = false) {
  const p = priv(m);
  const female = m.gender === "w";
  const addr = (p.address || "").split(",").map(x => x.trim()).filter(Boolean);
  const byId = id => state.events.find(e => e.id === id);
  const items = nl.event_ids.map(byId).filter(Boolean).sort((a, b) => a.event_date.localeCompare(b.event_date));
  const preview = nl.preview_ids.map(byId).filter(Boolean).sort((a, b) => a.event_date.localeCompare(b.event_date));
  const paras = t => (t || "").split(/\n{2,}/).map(x => x.trim()).filter(Boolean).map(x => `<p>${esc(x).replace(/\n/g, "<br>")}</p>`).join("");
  const head = `<header class="l-head"><img src="logo.svg" alt="Speckbacher Schützenkompanie Hall in Tirol"></header>`;
  const body = `<div class="l-body">
      ${withAddress ? `<p class="l-sender">${esc(LETTER.sender)}</p>
      <p class="l-addr">${female ? "Frau" : "Herrn"}<br>${esc(fullName(m))}${addr.map(a => "<br>" + esc(a)).join("")}</p>` : ""}
      <p class="l-date">${esc(LETTER.place)}, ${dmy(nl.letter_date)}</p>
      <h1 class="l-title"><b>RUND</b>SCHREIBEN</h1>
      <p>${female ? "Liebe" : "Lieber"} ${esc(m.first_name)},</p>
      ${paras(nl.intro)}
      ${items.map(letterItem).join("")}
      ${preview.length ? `<h2 class="l-sub">VORSCHAU ${esc(nlMonthName(firstOfMonth(nl.month, 1)).toUpperCase())}</h2>${preview.map(letterItem).join("")}` : ""}
      ${nl.free_text ? `<div class="l-free">${paras(nl.free_text)}</div>` : ""}
      <p class="l-greet">Schützen Heil</p>
      <p class="l-sign">${esc(nl.signature).replace(/\n/g, "<br>")}</p>
    </div>`;
  const foot = `<footer class="l-foot">${LETTER.footer.map(col => `<div>${col.join("<br>")}</div>`).join("")}</footer>`;
  if (!forPrint) return `<article class="letter">${head}${body}${foot}</article>`;
  // Druck: Tabelle mit Kopf-/Fußabstand, der sich auf jeder Seite wiederholt; die Fußzeile selbst steht fest unten
  return `<article class="letter"><table class="l-table">
    <thead><tr><td><div class="l-space-top"></div></td></tr></thead>
    <tfoot><tr><td><div class="l-space-bottom"></div></td></tr></tfoot>
    <tbody><tr><td>${head}${body}</td></tr></tbody></table></article>`;
}
function printLetters(nl, members) {
  if (!members.length) return toast("Keine Empfänger für den Serienbrief.");
  let root = document.getElementById("print-root");
  if (!root) { root = document.createElement("div"); root.id = "print-root"; document.body.append(root); }
  const foot = `<footer class="l-foot l-foot-print">${LETTER.footer.map(col => `<div>${col.join("<br>")}</div>`).join("")}</footer>`;
  root.innerHTML = foot + members.map(m => letterHtml(nl, m, true, true)).join("");
  document.body.classList.add("print-mode");
  const done = () => { document.body.classList.remove("print-mode"); root.innerHTML = ""; window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  // Logo laden lassen, dann drucken
  setTimeout(() => window.print(), 300);
}
const postRecipients = () => state.members.filter(m => priv(m).needs_post);
const noAppRecipients = () => state.members.filter(m => !m.user_id);

/* ---------- Mitglieder ---------- */
function latestNewsletter() {
  const cutoff = firstOfMonth(todayIso(), -1);
  return (state.newsletters || []).filter(n => n.published_at && n.month >= cutoff).sort((a, b) => b.month.localeCompare(a.month))[0];
}
function newsletterCard() {
  const nl = latestNewsletter();
  if (!nl) return "";
  return `<button class="card nl-card" data-letter="${nl.id}">
    <div class="date"><div class="d">✉</div></div>
    <div class="body"><span class="type t-kompanie">Rundschreiben</span><h3>${esc(nlMonthTitle(nl.month))}</h3><p class="meta"><span>Antippen zum Lesen</span></p></div></button>`;
}
function renderLetterView() {
  const nl = (state.newsletters || []).find(n => n.id === state.letterId);
  if (!nl) { state.letterId = null; return renderMember(); }
  return `<button class="back" id="letter-close">‹ Zurück</button>
    <div class="letter-screen">${letterHtml(nl, state.me, false)}</div>
    <div class="row-actions" style="margin-top:12px"><button class="btn" id="letter-print">Drucken / als PDF</button></div>`;
}

/* ---------- Admin ---------- */
function defaultMonth() {
  const t = todayIso();
  return firstOfMonth(t, Number(t.slice(8, 10)) > 20 ? 1 : 0);
}
function lastNewsletter() {
  return [...(state.newsletters || [])].sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}
function renderNewsletters() {
  if (state.nlEdit) return renderNewsletterEditor();
  const list = [...(state.newsletters || [])].sort((a, b) => b.month.localeCompare(a.month));
  return `<div class="row-actions" style="margin-bottom:12px"><button class="btn yes" id="nl-new">Neues Rundschreiben</button></div>
  ${list.length ? `<div class="list">${list.map(n => `<button class="card ev" data-nl="${n.id}">
      <div class="date"><div class="d">✉</div></div>
      <div class="body"><h3>${esc(nlMonthTitle(n.month))}</h3>
      <p class="meta"><span>${n.published_at ? `Veröffentlicht am ${dmy(n.published_at.slice(0, 10))}` : "Entwurf"} · ${n.event_ids.length} Termine${n.preview_ids.length ? ` + ${n.preview_ids.length} Vorschau` : ""}</span></p></div></button>`).join("")}</div>`
    : `<p class="empty">Noch kein Rundschreiben. Lege mit „Neues Rundschreiben“ das erste an.</p>`}`;
}
function eventChecks(list, selected, name) {
  if (!list.length) return `<p class="empty">Keine Termine in diesem Monat.</p>`;
  return list.map(e => `<label class="check nl-ev" for="${name}-${e.id}"><input type="checkbox" id="${name}-${e.id}" name="${name}" value="${e.id}" ${selected.includes(e.id) ? "checked" : ""}>
    <span><b>${esc(e.title)}</b><br><span class="fn">${esc(fullDate(e.event_date))} · ${esc(TYPES[e.kind])}</span></span></label>`).join("");
}
function renderNewsletterEditor() {
  const d = state.nlDraft;
  const thisMonth = nlEvents(d.month), nextMonth = nlEvents(firstOfMonth(d.month, 1));
  const saved = d.id ? state.newsletters.find(n => n.id === d.id) : null;
  return `<button class="back" id="nl-back" type="button">‹ Alle Rundschreiben</button>
  <form class="panel" id="nl-form">
    <h2>Rundschreiben ${esc(nlMonthTitle(d.month))}${saved?.published_at ? ` <span class="pill">veröffentlicht</span>` : ` <span class="pill off">Entwurf</span>`}</h2>
    <div class="grid2">
      <label for="nl-month">Monat<input id="nl-month" type="month" value="${d.month.slice(0, 7)}" required></label>
      <label for="nl-date">Briefdatum<input id="nl-date" type="date" value="${d.letter_date}" required></label>
    </div>
    <label for="nl-intro">Einleitung (nach „Lieber …,“)<textarea id="nl-intro" rows="3">${esc(d.intro)}</textarea></label>
    <div class="sec"><h4>Termine im ${esc(nlMonthName(d.month))} <span>${thisMonth.length}</span></h4>${eventChecks(thisMonth, d.event_ids, "nl-ev")}</div>
    <div class="sec"><h4>Vorschau ${esc(nlMonthName(firstOfMonth(d.month, 1)))} <span>${nextMonth.length}</span></h4>
      <p class="rule">Optional: Termine des Folgemonats, die schon angekündigt werden sollen.</p>${eventChecks(nextMonth, d.preview_ids, "nl-pv")}</div>
    ${roundBirthdayHelper(d.month)}
    <label for="nl-free">Freier Text unter den Terminen<textarea id="nl-free" rows="5" placeholder="z. B. Danke für die zahlreiche Teilnahme beim … / Hinweis zur Uniform / Glückwünsche …">${esc(d.free_text || "")}</textarea></label>
    <label for="nl-sign">Unterschrift<textarea id="nl-sign" rows="3">${esc(d.signature)}</textarea></label>
    <div class="row-actions">
      <button class="btn yes" type="submit" id="nl-save">Speichern</button>
      <button class="btn" type="button" id="nl-preview">Vorschau</button>
    </div>
  </form>
  ${saved ? `<div class="panel" style="margin-top:12px">
    <h2>Verschicken</h2>
    ${saved.published_at
      ? `<p class="fn">Veröffentlicht am ${dmy(saved.published_at.slice(0, 10))}. Mitglieder sehen es in der App; Änderungen nach dem Speichern sind sofort sichtbar.</p>
        ${state.nlResendConfirm
          ? `<p><b>Rundschreiben nochmals per Push an alle schicken?</b></p><div class="row-actions"><button class="btn yes" id="nl-resend-yes">Ja, erneut schicken</button><button class="btn ghost" id="nl-resend-no">Abbrechen</button></div>`
          : `<div class="row-actions"><button class="btn" id="nl-resend">Erneut per Push schicken</button></div>`}`
      : state.nlConfirm
        ? `<p><b>Jetzt veröffentlichen und alle mit Erinnerungen per Push benachrichtigen?</b></p><div class="row-actions"><button class="btn yes" id="nl-publish-yes">Ja, veröffentlichen</button><button class="btn ghost" id="nl-publish-no">Abbrechen</button></div>`
        : `<p class="fn">Erst speichern, dann veröffentlichen. Alle Mitglieder sehen es danach in der App und bekommen eine Push-Nachricht.</p><div class="row-actions"><button class="btn yes" id="nl-publish">In der App veröffentlichen</button></div>`}
    <h4 class="sec-title">Serienbrief für die Post</h4>
    <p class="fn">Ein persönlicher Brief je Person, im Druckdialog „Als PDF sichern“ oder direkt drucken. Am besten am Computer.</p>
    <div class="row-actions">
      <button class="btn" id="nl-print-post">Postversand (${postRecipients().length})</button>
      <button class="btn" id="nl-print-noapp">Alle ohne App (${noAppRecipients().length})</button>
      <button class="btn ghost" id="nl-print-me">Nur meiner (Test)</button>
    </div>
  </div>` : ""}
  ${state.nlShowPreview ? `<div class="letter-screen" style="margin-top:12px">${letterHtml({ ...d, letter_date: d.letter_date }, state.me, true)}</div>` : ""}`;
}
function readNewsletterForm() {
  const d = state.nlDraft;
  const month = ($("#nl-month").value || d.month.slice(0, 7)) + "-01";
  const checked = name => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(i => +i.value);
  Object.assign(d, {
    letter_date: $("#nl-date").value || todayIso(),
    intro: $("#nl-intro").value.trim(),
    free_text: $("#nl-free").value.trim() || null,
    signature: $("#nl-sign").value.trim(),
    event_ids: month === d.month ? checked("nl-ev") : d.event_ids,
    preview_ids: month === d.month ? checked("nl-pv") : d.preview_ids
  });
  if (month !== d.month) setDraftMonth(month);
}
function setDraftMonth(month) {
  const d = state.nlDraft;
  d.month = month;
  d.event_ids = nlEvents(month).map(e => e.id);   // Termine des Monats vorausgewählt
  d.preview_ids = [];
}
function newDraft() {
  const last = lastNewsletter();
  state.nlDraft = { id: null, month: defaultMonth(), letter_date: todayIso(), intro: last?.intro || LETTER.intro,
    event_ids: [], preview_ids: [], free_text: null, signature: last?.signature || LETTER.signature };
  setDraftMonth(state.nlDraft.month);
}
async function saveNewsletter() {
  readNewsletterForm();
  const d = state.nlDraft;
  const row = { month: d.month, letter_date: d.letter_date, intro: d.intro, event_ids: d.event_ids, preview_ids: d.preview_ids,
    free_text: d.free_text, signature: d.signature, updated_at: new Date().toISOString() };
  if (!d.id) row.created_by = state.me.id;
  const q = d.id ? db.from("newsletters").update(row).eq("id", d.id).select().single() : db.from("newsletters").insert(row).select().single();
  const { data, error } = await q;
  if (error) { $("#nl-save").disabled = false; return fail(error, "Das Rundschreiben konnte nicht gespeichert werden."); }
  state.newsletters = (state.newsletters || []).filter(n => n.id !== data.id).concat(data);
  d.id = data.id;
  render(); toast("Gespeichert.");
}
async function publishNewsletter() {
  const nl = state.newsletters.find(n => n.id === state.nlDraft.id);
  const { data, error } = await db.from("newsletters").update({ published_at: new Date().toISOString() }).eq("id", nl.id).select().single();
  if (error) return fail(error, "Veröffentlichen hat nicht geklappt.");
  state.newsletters = state.newsletters.filter(n => n.id !== nl.id).concat(data);
  state.nlConfirm = false; render();
  const sent = await sendNewsletterPush(nl, false);
  toast(sent === null ? "Veröffentlicht. Die Push-Nachricht konnte nicht verschickt werden." : `Veröffentlicht und an ${sent} Mitglieder mit Erinnerungen geschickt.`);
}
// Push an alle aktiven Mitglieder; again = erneutes Verschicken (Erinnerung)
async function sendNewsletterPush(nl, again) {
  const r = await db.functions.invoke("erinnerung", { body: {
    mode: "broadcast",
    title: again ? `Erinnerung: Rundschreiben ${nlMonthTitle(nl.month)}` : `Rundschreiben ${nlMonthTitle(nl.month)}`,
    body: again ? `Bitte gib in der App deine Rückmeldung für die Termine im ${nlMonthName(nl.month)}.`
                : `Die Termine für ${nlMonthName(nl.month)} sind da. Bitte gib in der App deine Rückmeldung.`,
    url: `./#rs-${nl.id}` } });
  return r.error ? null : (r.data?.sent ?? 0);
}

/* ---------- Steuerung ---------- */
document.addEventListener("click", async ev => {
  const t = ev.target.closest("button");
  if (!t || !state.me) return;
  const d = t.dataset;
  if (d.letter) { state.letterId = +d.letter; render(); scrollTo(0, 0); return; }
  if (t.id === "letter-close") { state.letterId = null; if (location.hash.startsWith("#rs-")) history.replaceState(null, "", location.pathname); render(); return; }
  if (t.id === "letter-print") { const nl = state.newsletters.find(n => n.id === state.letterId); return printLetters(nl, [state.me]); }
  if (t.id === "nl-new") { newDraft(); state.nlEdit = true; state.nlShowPreview = false; state.nlConfirm = false; render(); scrollTo(0, 0); return; }
  if (d.nl) {
    const n = state.newsletters.find(x => x.id === +d.nl);
    state.nlDraft = { ...n, event_ids: [...n.event_ids], preview_ids: [...n.preview_ids] };
    state.nlEdit = true; state.nlShowPreview = false; state.nlConfirm = false; state.nlResendConfirm = false; render(); scrollTo(0, 0); return;
  }
  if (t.id === "nl-back") { state.nlEdit = false; render(); return; }
  if (t.id === "nl-preview") { readNewsletterForm(); state.nlShowPreview = true; render(); document.querySelector(".letter-screen")?.scrollIntoView({ behavior: "smooth" }); return; }
  if (t.id === "nl-publish") { state.nlConfirm = true; render(); return; }
  if (t.id === "nl-publish-no") { state.nlConfirm = false; render(); return; }
  if (t.id === "nl-publish-yes") { t.disabled = true; return publishNewsletter(); }
  if (t.id === "nl-resend") { state.nlResendConfirm = true; render(); return; }
  if (t.id === "nl-resend-no") { state.nlResendConfirm = false; render(); return; }
  if (t.id === "nl-resend-yes") {
    t.disabled = true;
    const sent = await sendNewsletterPush(state.newsletters.find(n => n.id === state.nlDraft.id), true);
    state.nlResendConfirm = false; render();
    return toast(sent === null ? "Die Push-Nachricht konnte nicht verschickt werden." : `Erneut an ${sent} Mitglieder mit Erinnerungen geschickt.`);
  }
  const saved = () => state.newsletters.find(n => n.id === state.nlDraft?.id);
  if (t.id === "nl-print-post") return printLetters(saved(), postRecipients());
  if (t.id === "nl-print-noapp") return printLetters(saved(), noAppRecipients());
  if (t.id === "nl-print-me") return printLetters(saved(), [state.me]);
});
document.addEventListener("change", ev => {
  if (ev.target.id === "nl-month" && state.nlDraft) { readNewsletterForm(); render(); }
});
document.addEventListener("submit", ev => {
  if (ev.target.id !== "nl-form") return;
  ev.preventDefault();
  $("#nl-save").disabled = true;
  saveNewsletter();
});
// Link aus der Push-Nachricht: #rs-<id> öffnet das Rundschreiben
function openFromHash() {
  const m = location.hash.match(/^#rs-(\d+)$/);
  if (m && state.me) { state.role = "member"; state.settings = false; state.letterId = +m[1]; render(); }
}
window.addEventListener("hashchange", openFromHash);
