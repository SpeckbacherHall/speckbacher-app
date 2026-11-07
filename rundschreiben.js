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
function letterItem(e, m) {
  const time = e.muster_time && e.start_time ? `Antreten ${hm(e.muster_time)} Uhr | Beginn ${hm(e.start_time)} Uhr`
    : e.start_time ? `${hm(e.start_time)} Uhr` : e.muster_time ? `Antreten ${hm(e.muster_time)} Uhr` : "Informationen folgen";
  return `<section class="l-item">
    <h3>${esc(e.title.toUpperCase())}</h3>
    <p>${esc(fullDate(e.event_date))} | ${esc(time)} | ${esc(e.place)}</p>
    ${e.notes && !(time === "Informationen folgen" && e.notes === "Informationen folgen") ? `<p>${esc(e.notes)}</p>` : ""}
    ${e.dress ? `<p>Adjustierung: ${esc(e.dress)}</p>` : ""}
    ${e.note_marketenderinnen && isMk(m) ? `<p>Marketenderinnen: ${esc(e.note_marketenderinnen)}</p>` : ""}
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
      ${items.map(e => letterItem(e, m)).join("")}
      ${preview.length ? `<h2 class="l-sub">VORSCHAU ${esc(nlMonthName(firstOfMonth(nl.month, 1)).toUpperCase())}</h2>${preview.map(e => letterItem(e, m)).join("")}` : ""}
      ${nl.free_text ? `<div class="l-free">${paras(nl.free_text)}</div>` : ""}
      ${(nl.attachments || []).length ? `<p class="l-free">Beilagen: ${nl.attachments.map(a => esc(a.name)).join(", ")}</p>` : ""}
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

/* ---------- PDF (Anhang für E-Mail und zum Teilen) ---------- */
// Allgemeine Fassung ohne Anschrift, Anrede an alle; Marketenderinnen-Hinweise stehen bei den Terminen dabei.
function nlEventsOf(nl) {
  const byId = id => state.events.find(e => e.id === id);
  const sort = l => l.map(byId).filter(Boolean).sort((a, b) => a.event_date.localeCompare(b.event_date));
  return { items: sort(nl.event_ids), preview: sort(nl.preview_ids) };
}
function nlPdfDoc(nl, logo) {
  const { items, preview } = nlEventsOf(nl);
  const paras = t => (t || "").split(/\n{2,}/).map(x => x.trim()).filter(Boolean).map(x => ({ text: x, margin: [0, 0, 0, 7] }));
  const item = e => {
    const time = e.muster_time && e.start_time ? `Antreten ${hm(e.muster_time)} Uhr | Beginn ${hm(e.start_time)} Uhr`
      : e.start_time ? `${hm(e.start_time)} Uhr` : e.muster_time ? `Antreten ${hm(e.muster_time)} Uhr` : "Informationen folgen";
    return { unbreakable: true, margin: [0, 0, 0, 10], stack: [
      { text: e.title.toUpperCase(), bold: true, characterSpacing: .3 },
      `${fullDate(e.event_date)} | ${time} | ${e.place}`,
      ...(e.notes && !(time === "Informationen folgen" && e.notes === "Informationen folgen") ? [e.notes] : []),
      ...(e.dress ? [`Adjustierung: ${e.dress}`] : []),
      ...(e.note_marketenderinnen ? [`Für Marketenderinnen: ${e.note_marketenderinnen}`] : []),
      PARTICIPATION[e.kind] || ""
    ] };
  };
  const strip = h => h.replace(/<[^>]+>/g, "");
  return {
    pageSize: "A4", pageMargins: [62, 40, 62, 86],
    info: { title: `Rundschreiben ${nlMonthTitle(nl.month)}`, author: "Speckbacher - Schützenkompanie Hall in Tirol" },
    defaultStyle: { font: "Karla", fontSize: 10.5, lineHeight: 1.25, color: "#1d1d1b" },
    footer: () => ({ margin: [62, 22, 62, 0], columns: LETTER.footer.map((col, i) => ({ width: i === 0 ? "*" : "auto",
      stack: col.map((l, j) => ({ text: strip(l), bold: i === 0 && j === 0, color: i === 0 && j === 0 ? "#1d1d1b" : "#4a4a48" })), fontSize: 6.8, lineHeight: 1.2 })), columnGap: 14 }),
    content: [
      ...(logo ? [{ image: logo, width: 178, alignment: "center", margin: [0, 0, 0, 22] }] : []),
      { text: `${LETTER.place}, ${dmy(nl.letter_date)}`, alignment: "right", margin: [0, 0, 0, 16] },
      { text: [{ text: "RUND", bold: true }, "SCHREIBEN"], fontSize: 18, margin: [0, 0, 0, 16] },
      { text: "Liebe Kameradinnen und Kameraden,", margin: [0, 0, 0, 7] },
      ...paras(nl.intro),
      ...items.map(item),
      ...(preview.length ? [{ text: `VORSCHAU ${nlMonthName(firstOfMonth(nl.month, 1)).toUpperCase()}`, fontSize: 13, margin: [0, 8, 0, 8] }, ...preview.map(item)] : []),
      ...(nl.free_text ? [{ stack: paras(nl.free_text), margin: [0, 8, 0, 0] }] : []),
      ...((nl.attachments || []).length ? [{ text: `Beilagen: ${nl.attachments.map(a => a.name).join(", ")}`, margin: [0, 8, 0, 0] }] : []),
      { text: "Schützen Heil", margin: [0, 12, 0, 22] },
      { text: nl.signature }
    ]
  };
}
async function fileToDataUrl(url) {
  const r = await fetch(url); if (!r.ok) return null;
  const b = await r.blob();
  return new Promise(ok => { const f = new FileReader(); f.onload = () => ok(f.result); f.readAsDataURL(b); });
}
async function nlPdfBlob(nl) {
  await loadPdfMake();
  const logo = await fileToDataUrl("logo-brief.jpg").catch(() => null);
  return new Promise(ok => pdfMake.createPdf(nlPdfDoc(nl, logo)).getBlob(ok));
}
const nlFileName = nl => `Rundschreiben_${nlMonthTitle(nl.month).replace(/\s+/g, "_")}.pdf`;
// PDF erzeugen und im Speicher ablegen (für den Mail-Anhang)
async function storeNewsletterPdf(nl) {
  const blob = await nlPdfBlob(nl);
  const path = `${nl.id}.pdf`;
  const { error } = await db.storage.from("rundschreiben").upload(path, blob, { upsert: true, contentType: "application/pdf" });
  if (error) throw error;
  if (nl.pdf_path !== path) { await db.from("newsletters").update({ pdf_path: path }).eq("id", nl.id); nl.pdf_path = path; }
  return blob;
}
const mailRecipients = () => state.members.filter(m => m.active && priv(m).newsletter_email && priv(m).email);
async function loadMailStatus(nl) {
  const { data } = await db.from("newsletter_mails").select("status,error,member_id,sent_at").eq("newsletter_id", nl.id);
  state.nlMailStatus = { id: nl.id, rows: data || [] };
  if (state.nlEdit && state.nlDraft?.id === nl.id) render();
}
function mailStatusLine(nl) {
  const st = state.nlMailStatus?.id === nl.id ? state.nlMailStatus.rows : null;
  if (!st) return `<p class="send-stat">Versandstatus wird geladen …</p>`;
  if (!st.length) return `<p class="send-stat">Noch nicht per E-Mail verschickt.</p>`;
  const n = k => st.filter(r => r.status === k).length;
  const errs = st.filter(r => r.status === "fehler");
  const name = id => { const m = state.allMembers.find(x => x.id === id); return m ? fullName(m) : "?"; };
  return `<p class="send-stat">Gesendet: <b>${n("gesendet")}</b>${n("offen") ? ` · wird verschickt: <b>${n("offen")}</b>` : ""}${errs.length ? ` · Fehler: <b>${errs.length}</b>` : ""}</p>
    ${errs.length ? `<p class="rule">${errs.slice(0, 5).map(r => `${esc(name(r.member_id))}: ${esc(r.error || "")}`).join("<br>")}</p>` : ""}`;
}
async function sendNewsletterMail(nl, test) {
  try { await storeNewsletterPdf(nl); }
  catch (e) { console.error(e); return toast("Das PDF konnte nicht erstellt werden."); }
  const to = test ? ($("#nl-test-to")?.value || "").trim() : undefined;
  if (test) state.nlTestTo = to;
  const { data, error } = await db.functions.invoke("rundschreiben", { body: { mode: test ? "test" : "mail", id: nl.id, ...(to ? { to } : {}) } });
  state.nlMailConfirm = false;
  if (error) {
    let msg = "Der E-Mail-Versand konnte nicht gestartet werden.";
    try { msg = (await error.context.json()).error || msg; } catch (e) {}
    render(); return toast(msg);
  }
  toast(test ? `Test-Mail an ${data.to} geschickt.` : `${data.queued} E-Mails werden verschickt (etwa 25 pro Minute).`);
  loadMailStatus(nl);
}
// Teilen über das Teilen-Menü des Handys (z. B. WhatsApp-Gruppe) mit PDF; sonst PDF laden und WhatsApp mit Text öffnen
function shareText(nl) {
  const url = new URL(`./#rs-${nl.id}`, location.href).href;
  return `Rundschreiben ${nlMonthTitle(nl.month)} der Speckbacher Schützenkompanie: Die Termine für ${nlMonthName(nl.month)} sind da. Bitte gib deine Rückmeldung in der App: ${url}`;
}
async function shareNewsletter(nl) {
  const blob = await nlPdfBlob(nl);
  const file = new File([blob], nlFileName(nl), { type: "application/pdf" });
  const text = shareText(nl);
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], text, title: `Rundschreiben ${nlMonthTitle(nl.month)}` }); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  downloadBlob(blob, nlFileName(nl));
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  toast("Das PDF wurde heruntergeladen. In WhatsApp kannst du es zusätzlich anhängen.");
}
function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
async function deleteNewsletter(nl) {
  const { error } = await db.from("newsletters").delete().eq("id", nl.id);
  if (error) return fail(error, "Das Rundschreiben konnte nicht gelöscht werden.");
  const files = [nl.pdf_path, ...(nl.attachments || []).map(a => a.path)].filter(Boolean);
  if (files.length) await db.storage.from("rundschreiben").remove(files);
  state.newsletters = state.newsletters.filter(n => n.id !== nl.id);
  state.nlEdit = false; state.nlDeleteConfirm = false; state.nlDraft = null;
  render(); toast("Rundschreiben gelöscht.");
}

/* ---------- Beilagen ---------- */
const ATT_TYPES = /\.(pdf|docx?|xlsx?|pptx|jpe?g|png)$/i;
const fmtSize = b => b >= 1048576 ? `${(b / 1048576).toLocaleString("de-AT", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
function attachmentRows(nl, admin) {
  return (nl.attachments || []).map((a, i) => `<div class="att-row">
    <button class="att-name" type="button" data-nl-att-open="${i}" data-nl-id="${nl.id}">${ico("description")}<span>${esc(a.name)}<span class="fn"> · ${fmtSize(a.size)}</span></span></button>
    ${admin ? iconBtn("delete", `Beilage ${esc(a.name)} entfernen`, `data-nl-att-del="${i}"`, "danger") : iconBtn("download", `${esc(a.name)} laden`, `data-nl-att-open="${i}" data-nl-id="${nl.id}"`)}</div>`).join("");
}
function attachmentsBox(d) {
  const saved = d.id ? state.newsletters.find(n => n.id === d.id) : null;
  const list = saved?.attachments || [];
  const total = list.reduce((s, a) => s + a.size, 0);
  return `<div class="sec"><h4>Beilagen <span>${list.length}</span></h4>
    <p class="rule">Zusätzliche Dokumente, z. B. Protokoll der Jahreshauptversammlung, Jahresplan oder Sonderinformationen (PDF, Word, Excel oder Bild, je höchstens 10 MB). Bis zusammen 2,5 MB gehen sie im Mail als Anhang mit, größere als Download-Link. Mitglieder finden sie auch in der App beim Rundschreiben.</p>
    ${attachmentRows(saved || d, true)}
    ${list.length ? `<p class="rule">Zusammen ${fmtSize(total)}${total > 2.5 * 1048576 ? " – im Mail als Download-Links" : ""}</p>` : ""}
    ${saved ? `<div class="row-actions"><label class="btn" for="nl-att-file">${ico("upload")}Dokument hinzufügen</label><input type="file" id="nl-att-file" accept=".pdf,.doc,.docx,.xls,.xlsx,.pptx,.jpg,.jpeg,.png" multiple hidden></div>`
      : `<p class="fn">Erst speichern, dann lassen sich Dokumente anhängen.</p>`}
  </div>`;
}
async function addAttachments(files) {
  readNewsletterForm();
  const nl = state.newsletters.find(n => n.id === state.nlDraft.id);
  const list = [...(nl.attachments || [])];
  for (const f of files) {
    if (!ATT_TYPES.test(f.name)) { toast(`${f.name}: Dateiart wird nicht unterstützt.`); continue; }
    if (f.size > 10 * 1048576) { toast(`${f.name} ist größer als 10 MB.`); continue; }
    const safe = f.name.normalize("NFKD").replace(/[^\w.-]+/g, "_").slice(-80);
    const path = `${nl.id}/anhang/${Date.now()}-${safe}`;
    toast(`${f.name} wird hochgeladen …`);
    const { error } = await db.storage.from("rundschreiben").upload(path, f, { contentType: f.type || "application/octet-stream" });
    if (error) { console.error(error); toast(`${f.name} konnte nicht hochgeladen werden.`); continue; }
    list.push({ path, name: f.name, size: f.size, type: f.type || "" });
  }
  await saveAttachments(nl, list);
}
async function saveAttachments(nl, list) {
  const { error } = await db.from("newsletters").update({ attachments: list }).eq("id", nl.id);
  if (error) return fail(error, "Die Beilagen konnten nicht gespeichert werden.");
  nl.attachments = list; state.nlDraft.attachments = list;
  render(); toast("Beilagen gespeichert.");
}
async function removeAttachment(i) {
  readNewsletterForm();
  const nl = state.newsletters.find(n => n.id === state.nlDraft.id);
  const a = nl.attachments[i];
  await db.storage.from("rundschreiben").remove([a.path]);
  await saveAttachments(nl, nl.attachments.filter((_, j) => j !== i));
}
async function openAttachment(nlId, i) {
  const nl = state.newsletters.find(n => n.id === nlId);
  const a = nl?.attachments?.[i];
  if (!a) return;
  const { data, error } = await db.storage.from("rundschreiben").createSignedUrl(a.path, 600, { download: a.name });
  if (error) return toast("Die Datei konnte nicht geladen werden.");
  location.href = data.signedUrl;
}

/* ---------- Mitglieder ---------- */
function latestNewsletter() {
  const cutoff = firstOfMonth(todayIso(), -1);
  return (state.newsletters || []).filter(n => n.published_at && !n.hidden && n.month >= cutoff).sort((a, b) => b.month.localeCompare(a.month))[0];
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
  return `<button class="back" id="letter-close">${ico("arrow_back")}Zurück</button>
    <div class="letter-screen">${letterHtml(nl, state.me, false)}</div>
    ${(nl.attachments || []).length ? `<div class="panel" style="margin-top:12px"><h2>Beilagen</h2>${attachmentRows(nl, false)}</div>` : ""}
    <div class="row-actions" style="margin-top:12px"><button class="btn" id="letter-print">Drucken / als PDF</button></div>`;
}

/* ---------- Admin ---------- */
async function setNewsletterHidden(ids, hidden) {
  state.nlHideConfirm = false;
  if (!ids.length) return render();
  const { error } = await db.from("newsletters").update({ hidden }).in("id", ids);
  if (error) { render(); return fail(error, "Das hat nicht geklappt."); }
  state.newsletters = state.newsletters.map(n => ids.includes(n.id) ? { ...n, hidden } : n);
  render();
  toast(hidden ? "Das Rundschreiben wird bei niemandem mehr auf der Startseite angezeigt." : "Das Rundschreiben steht wieder auf der Startseite.");
}
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
  const shown = latestNewsletter();
  return `<div class="row-actions" style="margin-bottom:12px"><button class="btn yes" id="nl-new">Neues Rundschreiben</button>
    ${shown ? (state.nlHideConfirm
      ? `<span class="fn">„${esc(nlMonthTitle(shown.month))}“ bei allen von der Startseite nehmen?</span><button class="btn danger" id="nl-hide-yes">Ja, zurücksetzen</button><button class="btn ghost" id="nl-hide-no">Abbrechen</button>`
      : `<button class="btn" id="nl-hide">Anzeige auf der Startseite zurücksetzen</button>`) : ""}</div>
  ${shown ? `<p class="rule">Auf der Startseite aller Mitglieder steht derzeit: <b>${esc(nlMonthTitle(shown.month))}</b>.</p>` : `<p class="rule">Auf der Startseite wird derzeit kein Rundschreiben angezeigt.</p>`}
  ${list.length ? `<div class="list">${list.map(n => `<button class="card ev" data-nl="${n.id}">
      <div class="date"><div class="d">✉</div></div>
      <div class="body"><h3>${esc(nlMonthTitle(n.month))}</h3>
      <p class="meta"><span>${n.published_at ? `Veröffentlicht am ${dmy(n.published_at.slice(0, 10))}${n.hidden ? " · nicht mehr auf der Startseite" : ""}` : "Entwurf"} · ${n.event_ids.length} Termine${n.preview_ids.length ? ` + ${n.preview_ids.length} Vorschau` : ""}</span></p></div></button>`).join("")}</div>`
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
  return `<div class="row-actions" style="justify-content:space-between;margin-bottom:8px"><button class="back" id="nl-back" type="button" style="margin-bottom:0">${ico("arrow_back")}Alle Rundschreiben</button>
    ${saved ? iconBtn("delete", "Rundschreiben löschen", 'id="nl-delete"', "danger") : ""}</div>
  ${saved && state.nlDeleteConfirm ? `<div class="danger-box" style="margin-bottom:12px"><p><b>Rundschreiben ${esc(nlMonthTitle(saved.month))} wirklich löschen?</b></p>
    <p class="fn">${saved.published_at ? "Es verschwindet auch aus der App der Mitglieder. " : ""}Das lässt sich nicht rückgängig machen.</p>
    <div class="row-actions"><button class="btn danger" id="nl-delete-yes">Ja, löschen</button><button class="btn ghost" id="nl-delete-no">Abbrechen</button></div></div>` : ""}
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
    ${attachmentsBox(d)}
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
          : `<div class="row-actions"><button class="btn" id="nl-resend">Erneut per Push schicken</button>${saved.hidden ? `<button class="btn" id="nl-unhide">Wieder auf der Startseite anzeigen</button>` : ""}</div>`}`
      : state.nlConfirm
        ? `<p><b>Jetzt veröffentlichen und alle mit Erinnerungen per Push benachrichtigen?</b></p><div class="row-actions"><button class="btn yes" id="nl-publish-yes">Ja, veröffentlichen</button><button class="btn ghost" id="nl-publish-no">Abbrechen</button></div>`
        : `<p class="fn">Erst speichern, dann veröffentlichen. Alle Mitglieder sehen es danach in der App und bekommen eine Push-Nachricht.</p><div class="row-actions"><button class="btn yes" id="nl-publish">In der App veröffentlichen</button></div>`}
    ${saved.published_at ? `<div class="send-box">
      <h3 class="ico-title">${ico("mail")}Per E-Mail</h3>
      <p class="fn">Als Mailtext mit persönlicher Anrede und dem Rundschreiben als PDF im Anhang, an alle mit „Rundschreiben per E-Mail“ (${mailRecipients().length}).</p>
      ${mailStatusLine(saved)}
      ${state.nlMailConfirm
        ? `<p><b>Jetzt an ${mailRecipients().length} Mitglieder per E-Mail schicken?</b></p><div class="row-actions"><button class="btn yes" id="nl-mail-yes">Ja, verschicken</button><button class="btn ghost" id="nl-mail-no">Abbrechen</button></div>`
        : `<div class="row-actions"><button class="btn yes" id="nl-mail" ${mailRecipients().length ? "" : "disabled"}>${ico("send")}Per E-Mail senden</button></div>
          <div class="shots-form"><label for="nl-test-to">Test-Mail an<input id="nl-test-to" type="email" value="${esc(state.nlTestTo || priv(state.me).email || "")}"></label><button class="btn" id="nl-mail-test">Test senden</button></div>`}
    </div>
    <div class="send-box">
      <h3 class="ico-title">${ico("share")}Teilen, z. B. in WhatsApp</h3>
      <p class="fn">Am Handy öffnet sich das Teilen-Menü mit dem PDF – dort die WhatsApp-Gruppe auswählen. Am Computer wird das PDF geladen und WhatsApp mit einem Text geöffnet.</p>
      <div class="row-actions"><button class="btn" id="nl-share">${ico("share")}Teilen</button><button class="btn" id="nl-pdf">${ico("download")}PDF herunterladen</button></div>
    </div>` : ""}
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
    state.nlEdit = true; state.nlShowPreview = false; state.nlConfirm = false; state.nlResendConfirm = false; state.nlDeleteConfirm = false; state.nlMailConfirm = false; state.nlMailStatus = null; render(); scrollTo(0, 0);
    if (n.published_at) loadMailStatus(n);
    return;
  }
  if (t.id === "nl-back") { state.nlEdit = false; render(); return; }
  if (t.id === "nl-preview") { readNewsletterForm(); state.nlShowPreview = true; render(); document.querySelector(".letter-screen")?.scrollIntoView({ behavior: "smooth" }); return; }
  if (t.id === "nl-publish") { state.nlConfirm = true; render(); return; }
  if (t.id === "nl-hide") { state.nlHideConfirm = true; render(); return; }
  if (t.id === "nl-hide-no") { state.nlHideConfirm = false; render(); return; }
  if (t.id === "nl-hide-yes") { t.disabled = true; return setNewsletterHidden(state.newsletters.filter(n => n.published_at && !n.hidden).map(n => n.id), true); }
  if (t.id === "nl-unhide") { t.disabled = true; return setNewsletterHidden([state.nlDraft.id], false); }
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
  if (d.nlAttOpen !== undefined) { t.disabled = true; await openAttachment(+(d.nlId || state.nlDraft?.id), +d.nlAttOpen); t.disabled = false; return; }
  if (d.nlAttDel !== undefined) { t.disabled = true; return removeAttachment(+d.nlAttDel); }
  if (t.id === "nl-delete") { state.nlDeleteConfirm = true; render(); scrollTo(0, 0); return; }
  if (t.id === "nl-delete-no") { state.nlDeleteConfirm = false; render(); return; }
  if (t.id === "nl-delete-yes") { t.disabled = true; return deleteNewsletter(saved()); }
  if (t.id === "nl-mail") { state.nlMailConfirm = true; render(); return; }
  if (t.id === "nl-mail-no") { state.nlMailConfirm = false; render(); return; }
  if (t.id === "nl-mail-yes" || t.id === "nl-mail-test") { t.disabled = true; t.setAttribute("aria-busy", "true"); return sendNewsletterMail(saved(), t.id === "nl-mail-test"); }
  if (t.id === "nl-share") { t.disabled = true; try { await shareNewsletter(saved()); } finally { t.disabled = false; } return; }
  if (t.id === "nl-pdf") { t.disabled = true; const nl = saved(); try { downloadBlob(await nlPdfBlob(nl), nlFileName(nl)); } finally { t.disabled = false; } return; }
  if (t.id === "nl-print-post") return printLetters(saved(), postRecipients());
  if (t.id === "nl-print-noapp") return printLetters(saved(), noAppRecipients());
  if (t.id === "nl-print-me") return printLetters(saved(), [state.me]);
});
document.addEventListener("change", ev => {
  if (ev.target.id === "nl-month" && state.nlDraft) { readNewsletterForm(); render(); }
  if (ev.target.id === "nl-att-file" && ev.target.files.length) addAttachments([...ev.target.files]);
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
