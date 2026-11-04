/* Speckbacher-App – Vorstandsprotokolle
   Archiv für alle Vorstandsmitglieder (PDF), Protokollerstellung für Admins:
   Mitschrift (Word) + Audioaufnahme → Azure-Spracherkennung → KI-Entwurf → Bearbeitung → finales PDF.
   Protokolltext: "## ABSCHNITT", "### Person/Thema", "- Punkt", eingerückt "  - Unterpunkt", sonst Satz.
   Nutzt state, db, esc, dmy, toast, fail, download, render … aus app.js. */

const PROT_PART = 45 * 1024 * 1024;   // Supabase erlaubt im Gratis-Paket höchstens 50 MB pro Datei
const PROT_STATE = {
  hochgeladen: "Aufnahme hochgeladen", transkription: "Spracherkennung läuft (Azure) …", entwurf: "Entwurf wird vorbereitet …",
  schreibt: "KI schreibt den Entwurf …", fertig: "Entwurf fertig", fehler: "Fehler"
};
const isBusy = p => ["hochgeladen", "transkription", "entwurf", "schreibt"].includes(p?.job_state);
state.protocols = null;

/* ---------- Laden ---------- */
async function loadProtocols() {
  const { data, error } = await db.from("protocols")
    .select("id,title,meeting_date,date_is_month,number,status,source,chair,recorder,present,absent,ended_at,body,notes,transcript,hints,audio_parts,audio_name,job_state,job_error,pdf_path,original_name,finalized_at,updated_at,event_id")
    .order("meeting_date", { ascending: false }).order("number", { ascending: false, nullsFirst: false });
  if (error) { console.error(error); toast("Die Protokolle konnten nicht geladen werden."); state.protocols = []; return; }
  state.protocols = data;
}
const protById = id => (state.protocols || []).find(p => p.id === id);
function protDateLabel(p) {
  return p.date_is_month ? dt(p.meeting_date).toLocaleDateString("de-AT", { month: "long", year: "numeric" }) : dmy(p.meeting_date);
}
const protLongDate = p => (p.date_is_month ? dt(p.meeting_date).toLocaleDateString("de-AT", { month: "long", year: "numeric" })
  : dt(p.meeting_date).toLocaleDateString("de-AT", { day: "numeric", month: "long", year: "numeric" })).toUpperCase();
const protFileName = p => `${String(p.number || 0).padStart(2, "0")}_Protokoll_${(p.title || "Vorstandssitzung").replace(/[^\wäöüÄÖÜß-]+/g, "_")}_${dmy(p.meeting_date)}`;
const lines = t => (t || "").split("\n").map(x => x.trim()).filter(Boolean);

/* ---------- Protokolltext zerlegen ---------- */
function protBlocks(body) {
  return (body || "").split("\n").map(raw => {
    if (!raw.trim()) return { type: "gap" };
    const h = raw.match(/^\s*(#{2,3})\s+(.*)$/);
    if (h) return { type: h[1].length === 2 ? "h2" : "h3", text: h[2].trim() };
    const li = raw.match(/^(\s*)[-•*o]\s+(.*)$/);
    if (li) return { type: "li", level: Math.min(2, Math.floor(li[1].replace(/\t/g, "  ").length / 2)), text: li[2].trim() };
    return { type: "p", text: raw.trim() };
  });
}
// Aufzählungen in verschachtelte Listen umbauen: [{text, children:[…]}]
function nestItems(items) {
  const root = [], stack = [{ level: -1, children: root }];
  for (const it of items) {
    while (stack.length > 1 && stack.at(-1).level >= it.level) stack.pop();
    const node = { text: it.text, children: [], level: it.level };
    stack.at(-1).children.push(node);
    stack.push(node);
  }
  return root;
}
function groupBlocks(body) {
  const out = [];
  for (const b of protBlocks(body)) {
    if (b.type === "li") { const last = out.at(-1); last?.type === "list" ? last.items.push(b) : out.push({ type: "list", items: [b] }); }
    else if (b.type !== "gap") out.push(b);
    else if (out.at(-1)?.type !== "gap") out.push(b);
  }
  return out.map(b => b.type === "list" ? { type: "list", tree: nestItems(b.items) } : b);
}

/* ---------- Ansicht (HTML) ---------- */
function protHeadRows(p) {
  const row = (k, v) => v ? `<tr><th>${k}</th><td>${v}</td></tr>` : "";
  return `<table class="prot-head">${row("Sitzungsführung:", esc(p.chair))}${row("Protokollführung:", esc(p.recorder))}
    ${row("Anwesend:", lines(p.present).map(esc).join("<br>"))}${row("Abwesend:", lines(p.absent).map(esc).join("<br>"))}</table>`;
}
function protHtml(p) {
  const list = nodes => `<ul>${nodes.map(n => `<li>${esc(n.text)}${n.children.length ? list(n.children) : ""}</li>`).join("")}</ul>`;
  const body = groupBlocks(p.body).map(b => b.type === "h2" ? `<h3 class="prot-h2">${esc(b.text)}</h3>`
    : b.type === "h3" ? `<h4 class="prot-h3">${esc(b.text)}</h4>` : b.type === "p" ? `<p>${esc(b.text)}</p>`
    : b.type === "list" ? list(b.tree) : "").join("");
  return `<article class="prot-doc">
    <h2 class="prot-title">PROTOKOLL</h2>
    <p class="prot-sub">${esc((p.title || "Vorstandssitzung").toUpperCase())} | ${esc(protLongDate(p))}</p>
    ${protHeadRows(p)}${body}
    ${p.ended_at ? `<p class="prot-end">Sitzungsende: ${esc(p.ended_at)} Uhr</p>` : ""}
  </article>`;
}

/* ---------- PDF (pdfmake, nur bei Bedarf geladen) ---------- */
let pdfLoader = null;
function loadPdfMake() {
  if (window.pdfMake && window.KARLA_VFS) return Promise.resolve();
  if (pdfLoader) return pdfLoader;
  const v = document.querySelector('script[src^="app.js"]')?.src.split("?v=")[1] || "1";
  const add = src => new Promise((ok, no) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => no(new Error(src)); document.head.append(s); });
  pdfLoader = add(`vendor/pdfmake-0.2.15.min.js?v=${v}`).then(() => add(`vendor/karla-vfs.js?v=${v}`)).then(() => {
    pdfMake.vfs = window.KARLA_VFS;
    pdfMake.fonts = { Karla: { normal: "Karla-Regular.ttf", bold: "Karla-Bold.ttf", italics: "Karla-Regular.ttf", bolditalics: "Karla-Bold.ttf" } };
  }).catch(e => { pdfLoader = null; throw e; });
  return pdfLoader;
}
function protPdfDoc(p, draft) {
  const head = [["Sitzungsführung:", p.chair], ["Protokollführung:", p.recorder], ["Anwesend:", lines(p.present).join("\n")], ["Abwesend:", lines(p.absent).join("\n")]]
    .filter(([, v]) => v).map(([k, v]) => [{ text: k, color: "#333" }, { text: v }]);
  const MARKERS = ["disc", "circle", "square"];
  const ul = (nodes, level = 0) => ({ ul: nodes.flatMap(n => n.children.length ? [n.text, ul(n.children, level + 1)] : [n.text]), markerColor: "#1d1d1b", type: MARKERS[level], margin: [level ? 0 : 6, 1, 0, 2] });
  const content = [
    { text: "PROTOKOLL", fontSize: 24, bold: true, margin: [0, 0, 0, 2] },
    { text: `${(p.title || "Vorstandssitzung").toUpperCase()} | ${protLongDate(p)}`, fontSize: 13, margin: [0, 0, 0, 14] },
    head.length ? { table: { widths: [95, "*"], body: head }, layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 0, paddingTop: () => 2, paddingBottom: () => 3 }, margin: [0, 0, 0, 12] } : ""
  ];
  for (const b of groupBlocks(p.body)) {
    if (b.type === "h2") content.push({ text: b.text.toUpperCase(), bold: true, fontSize: 13, margin: [0, 12, 0, 1] });
    else if (b.type === "h3") content.push({ text: b.text, bold: true, margin: [0, 5, 0, 1] });
    else if (b.type === "p") content.push({ text: b.text, margin: [0, 1, 0, 1] });
    else if (b.type === "list") content.push(ul(b.tree));
  }
  if (p.ended_at) content.push({ text: `Sitzungsende: ${p.ended_at} Uhr`, margin: [0, 22, 0, 0] });
  return {
    pageSize: "A4", pageMargins: [62, 56, 62, 60],
    defaultStyle: { font: "Karla", fontSize: 10.5, lineHeight: 1.12, color: "#1d1d1b" },
    info: { title: `Protokoll ${p.title} ${dmy(p.meeting_date)}`, author: "Speckbacher Schützenkompanie Hall in Tirol" },
    watermark: draft ? { text: "ENTWURF", opacity: 0.08, bold: true, fontSize: 90 } : undefined,
    footer: (page, pages) => ({ margin: [62, 22, 62, 0], fontSize: 8, text: ["Seite ", { text: String(page), bold: true }, " von ", { text: String(pages), bold: true }] }),
    content
  };
}
async function protPdfBlob(p, draft) {
  await loadPdfMake();
  return new Promise(ok => pdfMake.createPdf(protPdfDoc(p, draft)).getBlob(ok));
}

/* ---------- Word (.docx) ohne Bibliothek: ZIP ohne Kompression ---------- */
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = bytes => { let c = 0xFFFFFFFF; for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zipStore(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  for (const [name, text] of files) {
    const nameB = enc.encode(name), data = enc.encode(text), crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, 0, 2], [12, 0x21, 2], [14, crc, 4], [18, data.length, 4], [22, data.length, 4], [26, nameB.length, 2], [28, 0, 2]]
      .forEach(([o, v, s]) => s === 4 ? local.setUint32(o, v, true) : local.setUint16(o, v, true));
    parts.push(new Uint8Array(local.buffer), nameB, data);
    const cen = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, 0, 2], [14, 0x21, 2], [16, crc, 4], [20, data.length, 4], [24, data.length, 4], [28, nameB.length, 2], [42, offset, 4]]
      .forEach(([o, v, s]) => s === 4 ? cen.setUint32(o, v, true) : cen.setUint16(o, v, true));
    central.push(new Uint8Array(cen.buffer), nameB);
    offset += 30 + nameB.length + data.length;
  }
  const size = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  [[0, 0x06054b50, 4], [8, files.length, 2], [10, files.length, 2], [12, size, 4], [16, offset, 4]].forEach(([o, v, s]) => s === 4 ? end.setUint32(o, v, true) : end.setUint16(o, v, true));
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}
function protDocx(p) {
  const x = s => esc(s);
  const para = (text, { bold = false, size = 21, before = 0, after = 40, ind = null, caps = false } = {}) =>
    `<w:p><w:pPr><w:spacing w:before="${before}" w:after="${after}"/>${ind ? `<w:ind w:left="${ind[0]}" w:hanging="${ind[1]}"/>` : ""}</w:pPr><w:r><w:rPr>${bold ? "<w:b/>" : ""}${caps ? "<w:caps/>" : ""}<w:sz w:val="${size}"/></w:rPr><w:t xml:space="preserve">${x(text)}</w:t></w:r></w:p>`;
  const BUL = ["•", "o", "▪"];
  const body = [para("PROTOKOLL", { bold: true, size: 48, after: 0 }), para(`${(p.title || "Vorstandssitzung").toUpperCase()} | ${protLongDate(p)}`, { size: 26, after: 240 })];
  for (const [k, v] of [["Sitzungsführung:", p.chair], ["Protokollführung:", p.recorder], ["Anwesend:", lines(p.present).join(", ")], ["Abwesend:", lines(p.absent).join(", ")]])
    if (v) body.push(para(`${k}\t${v}`, { after: 60 }));
  for (const b of protBlocks(p.body)) {
    if (b.type === "h2") body.push(para(b.text, { bold: true, size: 26, before: 240, caps: true }));
    else if (b.type === "h3") body.push(para(b.text, { bold: true, before: 120 }));
    else if (b.type === "p") body.push(para(b.text));
    else if (b.type === "li") body.push(para(`${BUL[b.level]}\t${b.text}`, { ind: [360 * (b.level + 1), 360] }));
  }
  if (p.ended_at) body.push(para(`Sitzungsende: ${p.ended_at} Uhr`, { before: 360 }));
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1247" w:bottom="1134" w:left="1247" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="21"/><w:lang w:val="de-AT"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`;
  return zipStore([
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`],
    ["word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["word/document.xml", doc], ["word/styles.xml", styles]
  ]);
}

/* ---------- Mitschrift aus Word lesen (.docx = ZIP) ---------- */
async function unzipEntry(buf, wanted) {
  const v = new DataView(buf);
  let eocd = buf.byteLength - 22;
  while (eocd >= 0 && v.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("Keine gültige Word-Datei.");
  let p = v.getUint32(eocd + 16, true);
  const count = v.getUint16(eocd + 10, true), dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true);
    const nlen = v.getUint16(p + 28, true), elen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true), off = v.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(buf, p + 46, nlen));
    if (name === wanted) {
      const start = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true);
      const data = new Uint8Array(buf, start, csize);
      if (method === 0) return dec.decode(data);
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return await new Response(stream).text();
    }
    p += 46 + nlen + elen + clen;
  }
  throw new Error("In der Datei fehlt der Text (word/document.xml).");
}
async function docxToText(file) {
  const xml = await unzipEntry(await file.arrayBuffer(), "word/document.xml");
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return [...doc.getElementsByTagNameNS(W, "p")].map(pEl => {
    const text = [...pEl.getElementsByTagNameNS(W, "t")].map(t => t.textContent).join("");
    // Aufzählung: direkte Nummerierung (numPr) oder Listen-Formatvorlage („Listenabsatz“, „List Bullet 2“ …)
    const style = pEl.getElementsByTagNameNS(W, "pStyle")[0]?.getAttributeNS(W, "val") || "";
    const ilvl = pEl.getElementsByTagNameNS(W, "ilvl")[0]?.getAttributeNS(W, "val");
    const isList = pEl.getElementsByTagNameNS(W, "numPr").length > 0 || /list|liste|aufz/i.test(style);
    const lvl = ilvl != null ? Number(ilvl) : Math.max(0, Number(style.match(/(\d)$/)?.[1] || 1) - 1);
    return isList && text.trim() ? `${"  ".repeat(Math.min(lvl, 2))}- ${text.trim()}` : text;
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/* ---------- Archiv ---------- */
function renderProtocols() {
  if (state.protocols === null) { loadProtocols().then(render); return `<p class="empty">Protokolle werden geladen …</p>`; }
  if (state.protImport) return renderProtImport();
  if (state.protEdit) return renderProtEditor();
  if (state.protOpen) return renderProtView();
  const admin = state.me.is_admin;
  const q = (state.protQuery || "").toLowerCase();
  const list = state.protocols.filter(p => !q || `${p.title} ${protDateLabel(p)} ${p.body} ${p.original_name || ""}`.toLowerCase().includes(q));
  const years = [...new Set(list.map(p => p.meeting_date.slice(0, 4)))];
  return `<div class="panel"><h2>Vorstandsprotokolle</h2>
    <p class="fn">Alle Protokolle der Vorstandssitzungen.</p>
    ${admin ? `<div class="row-actions"><button class="btn yes" id="prot-new">Neues Protokoll</button><button class="btn" id="prot-import">Alte Protokolle hochladen</button><button class="btn ghost" id="prot-check">Azure prüfen</button></div>` : ""}
    <input class="search" id="prot-search" type="search" placeholder="Suchen (Datum, Stichwort …)" value="${esc(state.protQuery || "")}" aria-label="Protokolle durchsuchen" style="margin-top:10px">
  </div>
  ${list.length ? years.map(y => `<div class="month">${y}</div><div class="list">${list.filter(p => p.meeting_date.startsWith(y)).map(p => `
    <button class="card ev" data-prot="${p.id}">
      <div class="date"><div class="d">${p.number ? String(p.number).padStart(2, "0") : "–"}</div><div class="w">${p.date_is_month ? "" : wd(p.meeting_date)}</div></div>
      <div class="body">${p.status !== "final" ? `<span class="pill off">${isBusy(p) ? "in Arbeit" : "Entwurf"}</span> ` : ""}${p.source === "import" ? `<span class="pill">PDF</span> ` : ""}
        <h3>${esc(p.title)} · ${esc(protDateLabel(p))}</h3>
        ${isBusy(p) || p.job_state === "fehler" ? `<p class="meta"><span>${esc(PROT_STATE[p.job_state])}</span></p>` : ""}</div></button>`).join("")}</div>`).join("")
    : `<p class="empty" style="margin-top:12px">${q ? "Nichts gefunden." : "Noch keine Protokolle im Archiv."}</p>`}`;
}
function renderProtView() {
  const p = protById(state.protOpen);
  if (!p) { state.protOpen = null; return renderProtocols(); }
  const admin = state.me.is_admin;
  setTimeout(() => prepPdfLink(p), 0);
  return `<button class="back" id="prot-back">‹ Alle Protokolle</button>
  <div class="row-actions" style="margin-bottom:10px">
    ${p.pdf_path ? `<a class="btn yes" id="prot-pdf-link" href="#" aria-disabled="true">PDF wird vorbereitet …</a>` : p.body ? `<button class="btn yes" id="prot-pdf">Als PDF</button>` : ""}
    ${admin && p.source === "app" ? `<button class="btn" id="prot-edit">${p.status === "final" ? "Wieder öffnen und bearbeiten" : "Bearbeiten"}</button>` : ""}
    ${admin ? (state.protConfirmDelete
      ? `<span class="fn">Wirklich löschen?</span><button class="btn danger" id="prot-del-yes">Ja, löschen</button><button class="btn ghost" id="prot-del-no">Abbrechen</button>`
      : `<button class="btn danger" id="prot-del">Löschen</button>`) : ""}
  </div>
  ${p.body ? `<div class="panel">${protHtml(p)}</div>`
    : `<div class="panel"><h2>${esc(p.title)} · ${esc(protDateLabel(p))}</h2><p class="fn">${esc(p.original_name || "Importiertes Protokoll")} – Inhalt im PDF.</p></div>`}`;
}
async function prepPdfLink(p) {
  const a = $("#prot-pdf-link");
  if (!a) return;
  const { data, error } = await db.storage.from("vorstand").createSignedUrl(p.pdf_path, 3600);
  if (error) { a.textContent = "PDF nicht verfügbar"; return; }
  a.href = data.signedUrl; a.target = "_blank"; a.rel = "noopener"; a.removeAttribute("aria-disabled"); a.textContent = "PDF öffnen";
}

/* ---------- Neues Protokoll / Bearbeiten ---------- */
function suggestMeeting() {
  const past = state.events.filter(e => e.kind === "vorstand" && e.event_date <= todayIso()).sort((a, b) => b.event_date.localeCompare(a.event_date))[0];
  const date = past?.event_date || todayIso();
  const year = date.slice(0, 4);
  const number = Math.max(0, ...(state.protocols || []).filter(p => p.meeting_date.startsWith(year)).map(p => p.number || 0)) + 1;
  return { date, number, event_id: past?.event_date === date ? past.id : null };
}
function renderProtEditor() {
  const isNew = state.protEdit === "new";
  const p = isNew ? null : protById(state.protEdit);
  if (!isNew && !p) { state.protEdit = null; return renderProtocols(); }
  if (isNew) {
    const s = suggestMeeting();
    return `<button class="back" id="prot-edit-cancel" type="button">‹ Zurück</button>
    <form class="panel" id="prot-new-form">
      <h2>Neues Protokoll</h2>
      <div class="grid2">${field("pn-date", "Sitzungsdatum", s.date, "date", "required")}${field("pn-number", "Nummer im Jahr", s.number, "number", 'min="1" step="1"')}</div>
      ${field("pn-title", "Sitzung", "Vorstandssitzung", "text", "required")}
      <label for="pn-notes-file">Mitschrift (Word-Datei)<input id="pn-notes-file" type="file" accept=".docx,.txt,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"></label>
      <label for="pn-notes">Mitschrift (Text, wird aus der Word-Datei übernommen oder direkt eingegeben)<textarea id="pn-notes" rows="10" placeholder="Stichworte aus der Sitzung …"></textarea></label>
      <label for="pn-audio">Audioaufnahme der Sitzung (optional; m4a, mp3, wav …)<input id="pn-audio" type="file" accept="audio/*,.m4a,.mp3,.wav,.ogg,.opus,.webm,.flac"></label>
      <p class="rule">Die Aufnahme wird nur für die Spracherkennung (Azure, EU) verwendet und beim Abschließen des Protokolls gelöscht. Alle Anwesenden sollten der Aufnahme zugestimmt haben.</p>
      <div id="pn-progress" class="fn" aria-live="polite"></div>
      <div class="row-actions"><button class="btn yes" type="submit" id="pn-submit">Speichern und Entwurf erstellen</button></div>
    </form>`;
  }
  if (isBusy(p)) {
    setProtPolling(true);
    return `<button class="back" id="prot-edit-cancel" type="button">‹ Zurück</button>
    <div class="panel"><h2>${esc(p.title)} · ${esc(protDateLabel(p))}</h2>
      <p><span class="status">${esc(PROT_STATE[p.job_state])}</span></p>
      <p class="fn">Das dauert je nach Länge der Aufnahme einige Minuten. Du kannst die App schließen – du bekommst eine Push-Nachricht, sobald der Entwurf fertig ist.</p>
      <div class="row-actions"><button class="btn ghost" id="prot-job-cancel">Abbrechen</button></div>
    </div>`;
  }
  return `<button class="back" id="prot-edit-cancel" type="button">‹ Zurück</button>
  ${p.job_state === "fehler" ? `<div class="panel danger-box"><p><b>Der Entwurf konnte nicht erstellt werden.</b></p><p class="fn">${esc(p.job_error || "")}</p>
    <div class="row-actions"><button class="btn" id="prot-regen">Erneut versuchen</button></div></div>` : ""}
  ${p.hints ? `<div class="panel hint-box"><h4 class="sec-title">Hinweise der KI – bitte prüfen</h4><ul>${lines(p.hints).map(h => `<li>${esc(h)}</li>`).join("")}</ul></div>` : ""}
  <form class="panel" id="prot-form">
    <h2>${p.status === "final" ? "Protokoll bearbeiten" : "Protokollentwurf"}</h2>
    <div class="grid2">${field("pe-date", "Sitzungsdatum", p.meeting_date, "date", "required")}${field("pe-number", "Nummer im Jahr", p.number ?? "", "number", 'min="1" step="1"')}</div>
    ${field("pe-title", "Sitzung", p.title, "text", "required")}
    <div class="grid2">${field("pe-chair", "Sitzungsführung", p.chair)}${field("pe-recorder", "Protokollführung", p.recorder)}</div>
    <div class="grid2"><label for="pe-present">Anwesend (eine Person pro Zeile)<textarea id="pe-present" rows="6">${esc(p.present || "")}</textarea></label>
      <label for="pe-absent">Abwesend<textarea id="pe-absent" rows="6">${esc(p.absent || "")}</textarea></label></div>
    <label for="pe-body">Protokolltext<textarea id="pe-body" class="prot-text" rows="24">${esc(p.body)}</textarea></label>
    <p class="rule">„## “ = Abschnitt (POSTEINGANG …), „### “ = Person oder Thema, „- “ = Punkt, zwei Leerzeichen davor = Unterpunkt.</p>
    ${field("pe-end", "Sitzungsende (Uhrzeit)", p.ended_at, "text", 'placeholder="z. B. 20:54"')}
    <div class="row-actions">
      <button class="btn yes" type="submit" id="pe-save">Speichern</button>
      <button class="btn" type="button" id="prot-preview">Vorschau</button>
      <button class="btn" type="button" id="prot-draft-pdf">Entwurf als PDF</button>
      <button class="btn" type="button" id="prot-docx">Als Word</button>
    </div>
  </form>
  ${state.protPreview ? `<div class="panel" style="margin-top:12px">${protHtml(p)}</div>` : ""}
  <div class="panel" style="margin-top:12px">
    <h2>Abschließen</h2>
    <p class="fn">Erst abschließen, wenn der Hauptmann freigegeben hat. Dann wird das PDF erzeugt und ins Archiv gestellt; Mitschrift, Abschrift und Aufnahme werden gelöscht.</p>
    <label class="check-line" for="pe-notify"><input id="pe-notify" type="checkbox" checked> Vorstand per Push informieren</label>
    ${state.protConfirmFinal
      ? `<p><b>Protokoll jetzt endgültig ins Archiv stellen?</b></p><div class="row-actions"><button class="btn yes" id="prot-final-yes">Ja, abschließen</button><button class="btn ghost" id="prot-final-no">Abbrechen</button></div>`
      : `<div class="row-actions"><button class="btn yes" id="prot-final">Abschließen und archivieren</button></div>`}
  </div>
  ${p.notes || p.transcript ? `<details class="panel" style="margin-top:12px"><summary><b>Arbeitsmaterial</b> <span class="fn">(Mitschrift${p.transcript ? " und Abschrift der Aufnahme" : ""})</span></summary>
    ${p.notes ? `<h4 class="sec-title">Mitschrift</h4><pre class="msg prot-raw">${esc(p.notes)}</pre>` : ""}
    ${p.transcript ? `<h4 class="sec-title">Abschrift der Aufnahme</h4><pre class="msg prot-raw">${esc(p.transcript)}</pre>` : ""}
    <div class="row-actions"><button class="btn" id="prot-regen">Entwurf neu erstellen (überschreibt den Text)</button></div>
  </details>` : ""}`;
}
function readProtForm(p) {
  const val = id => $(id).value.trim();
  return { ...p, meeting_date: val("#pe-date"), number: Number(val("#pe-number")) || null, title: val("#pe-title") || "Vorstandssitzung",
    chair: val("#pe-chair") || null, recorder: val("#pe-recorder") || null, present: val("#pe-present") || null, absent: val("#pe-absent") || null,
    body: $("#pe-body").value.replace(/\s+$/, ""), ended_at: val("#pe-end") || null };
}
async function saveProt(p, extra = {}) {
  const row = { meeting_date: p.meeting_date, number: p.number, title: p.title, chair: p.chair, recorder: p.recorder,
    present: p.present, absent: p.absent, body: p.body, ended_at: p.ended_at, ...extra };
  const { data, error } = await db.from("protocols").update(row).eq("id", p.id).select().single();
  if (error) { fail(error, "Speichern hat nicht geklappt."); return null; }
  state.protocols = state.protocols.map(x => x.id === p.id ? { ...x, ...data } : x);
  return data;
}

async function createProtocol() {
  const btn = $("#pn-submit"), prog = $("#pn-progress");
  const notes = $("#pn-notes").value.trim(), audio = $("#pn-audio").files[0];
  if (!notes && !audio) { btn.disabled = false; return toast("Bitte Mitschrift oder Aufnahme angeben."); }
  // Große Aufnahmen werden in Teilen gespeichert und einzeln erkannt – das funktioniert nur bei MP3
  if (audio && audio.size > PROT_PART && !/mpeg|mp3/i.test(audio.type) && !/\.mp3$/i.test(audio.name)) {
    btn.disabled = false;
    return toast("Aufnahmen über 45 MB bitte als MP3 hochladen (z. B. im Rekorder als MP3 speichern oder umwandeln).");
  }
  const date = $("#pn-date").value, s = suggestMeeting();
  const { data: p, error } = await db.from("protocols").insert({
    meeting_date: date, number: Number($("#pn-number").value) || null, title: $("#pn-title").value.trim() || "Vorstandssitzung",
    notes: notes || null, event_id: s.date === date ? s.event_id : null, job_state: audio ? "hochgeladen" : null, recorder: fullName(state.me)
  }).select().single();
  if (error) { btn.disabled = false; return fail(error, "Das Protokoll konnte nicht angelegt werden."); }
  if (audio) {
    const n = Math.ceil(audio.size / PROT_PART);
    for (let i = 0; i < n; i++) {
      prog.textContent = `Aufnahme wird hochgeladen … ${Math.round(i / n * 100)} %`;
      const { error: e } = await db.storage.from("vorstand").upload(`audio/${p.id}/part-${String(i).padStart(3, "0")}`,
        audio.slice(i * PROT_PART, (i + 1) * PROT_PART), { contentType: audio.type || "application/octet-stream", upsert: true });
      if (e) { console.error(e); prog.textContent = ""; btn.disabled = false; await db.from("protocols").update({ job_state: "fehler", job_error: "Hochladen der Aufnahme fehlgeschlagen." }).eq("id", p.id); return toast("Die Aufnahme konnte nicht hochgeladen werden. Bitte erneut versuchen."); }
    }
    await db.from("protocols").update({ audio_parts: n, audio_type: audio.type || "audio/mp4", audio_name: audio.name }).eq("id", p.id);
  }
  prog.textContent = "Entwurf wird gestartet …";
  const r = await db.functions.invoke("protokoll", { body: { mode: "start", id: p.id } });
  let msg = null;
  if (r.error) { try { msg = (await r.error.context.json()).error; } catch (e) { msg = "Der Entwurf konnte nicht gestartet werden."; } }
  await loadProtocols();
  state.protEdit = p.id; render(); scrollTo(0, 0);
  toast(msg || (audio ? "Aufnahme hochgeladen. Die Spracherkennung läuft." : "Der Entwurf wird geschrieben."));
}
async function regenerate(p) {
  const { error } = await db.functions.invoke("protokoll", { body: { mode: "start", id: p.id } });
  if (error) { let m = "Konnte nicht gestartet werden."; try { m = (await error.context.json()).error || m; } catch (e) {} toast(m); }
  await loadProtocols(); render();
}
async function finalizeProt(p) {
  const notify = $("#pe-notify")?.checked;
  const cur = readProtForm(p);
  toast("PDF wird erzeugt …");
  let blob;
  try { blob = await protPdfBlob(cur, false); } catch (e) { console.error(e); return toast("Das PDF konnte nicht erzeugt werden."); }
  const path = `pdf/${p.id}.pdf`;
  const { error: up } = await db.storage.from("vorstand").upload(path, blob, { contentType: "application/pdf", upsert: true });
  if (up) return fail(up, "Das PDF konnte nicht gespeichert werden.");
  const saved = await saveProt(cur, { status: "final", pdf_path: path, notes: null, transcript: null, hints: null, audio_parts: 0, audio_type: null, audio_name: null, job_state: null, job_error: null });
  if (!saved) return;
  const { data: files } = await db.storage.from("vorstand").list(`audio/${p.id}`);
  if (files?.length) await db.storage.from("vorstand").remove(files.map(f => `audio/${p.id}/${f.name}`));
  let sent = null;
  if (notify) { const r = await db.functions.invoke("protokoll", { body: { mode: "notify", id: p.id } }); sent = r.error ? null : r.data?.sent; }
  state.protEdit = null; state.protConfirmFinal = false; state.protOpen = p.id; render(); scrollTo(0, 0);
  toast(notify ? (sent === null ? "Archiviert. Die Push-Nachricht konnte nicht verschickt werden." : `Archiviert und an ${sent} Vorstandsmitglieder geschickt.`) : "Protokoll archiviert.");
}

/* ---------- Alte Protokolle hochladen ---------- */
const MONTH_NUM = { jänner: 1, januar: 1, jaenner: 1, februar: 2, feber: 2, märz: 3, maerz: 3, april: 4, mai: 5, juni: 6, juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12 };
function parseProtName(name) {
  const base = name.replace(/\.[^.]+$/, "");
  const num = Number(base.match(/^(\d{1,2})[_\s-]/)?.[1]) || null;
  const full = base.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (full) return { number: num, meeting_date: `${full[3]}-${full[2].padStart(2, "0")}-${full[1].padStart(2, "0")}`, date_is_month: false };
  const my = base.toLowerCase().match(/(jänner|jaenner|januar|februar|feber|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)[_\s-]*(\d{4})/);
  if (my) return { number: num, meeting_date: `${my[2]}-${String(MONTH_NUM[my[1]]).padStart(2, "0")}-01`, date_is_month: true };
  return { number: num, meeting_date: null, date_is_month: false };
}
function renderProtImport() {
  const rows = state.protImport.rows || [];
  return `<button class="back" id="prot-import-close">‹ Alle Protokolle</button>
  <div class="panel"><h2>Alte Protokolle hochladen</h2>
    <p class="fn">PDF-Dateien auswählen (mehrere auf einmal möglich, z. B. ein ganzer Jahresordner). Datum und Nummer werden aus dem Dateinamen gelesen, etwa „08_Protokoll_Vorstandssitzung_28.09.2026.pdf“ oder „01_Jänner_2025_Vorstandssitzung_Protokoll.pdf“. Word-Dateien bitte vorher als PDF speichern.</p>
    <label class="btn" for="prot-files" style="align-self:flex-start">PDF-Dateien wählen<input id="prot-files" type="file" accept="application/pdf,.pdf" multiple hidden></label>
  </div>
  ${rows.length ? `<div class="panel" style="margin-top:12px"><table><tbody>${rows.map((r, i) => `<tr><td>${esc(r.file.name)}<br><span class="fn">${r.dup ? "schon im Archiv – wird übersprungen" : r.meeting_date ? `${r.number ? `Nr. ${r.number} · ` : ""}${r.date_is_month ? esc(dt(r.meeting_date).toLocaleDateString("de-AT", { month: "long", year: "numeric" })) : dmy(r.meeting_date)}` : "Datum nicht erkannt"}</span></td>
      <td style="width:150px">${r.dup ? "" : `<input type="date" data-imp-date="${i}" value="${r.meeting_date || ""}" aria-label="Datum">`}</td></tr>`).join("")}</tbody></table>
    <label class="check-line" for="imp-notify"><input id="imp-notify" type="checkbox" ${rows.filter(r => !r.dup).length <= 2 ? "checked" : ""}> Vorstand per Push informieren</label>
    <p class="rule">Bei mehreren Dateien kommt eine einzige Nachricht. Beim Nachtragen alter Jahrgänge am besten aus lassen.</p>
    <div id="imp-progress" class="fn" aria-live="polite"></div>
    <div class="row-actions"><button class="btn yes" id="prot-import-go">${rows.filter(r => !r.dup).length} Protokolle hochladen</button></div></div>` : ""}`;
}
async function runImport() {
  const rows = state.protImport.rows.filter(r => !r.dup);
  if (rows.some(r => !r.meeting_date)) return toast("Bitte bei allen Dateien ein Datum eintragen.");
  const notify = $("#imp-notify")?.checked;
  let ok = 0, failed = 0;
  const done = [];
  for (const [i, r] of rows.entries()) {
    $("#imp-progress").textContent = `Lade hoch … ${i + 1} von ${rows.length}`;
    const { data: p, error } = await db.from("protocols").insert({ meeting_date: r.meeting_date, date_is_month: r.date_is_month, number: r.number,
      title: /jahreshaupt/i.test(r.file.name) ? "Jahreshauptversammlung" : "Vorstandssitzung", status: "final", source: "import", original_name: r.file.name }).select("id").single();
    if (error) { failed++; continue; }
    const path = `pdf/${p.id}.pdf`;
    const { error: up } = await db.storage.from("vorstand").upload(path, r.file, { contentType: "application/pdf", upsert: true });
    if (up) { await db.from("protocols").delete().eq("id", p.id); failed++; continue; }
    await db.from("protocols").update({ pdf_path: path }).eq("id", p.id);
    done.push(p.id);
    ok++;
  }
  let sent = null;
  if (notify && done.length) {
    const r = await db.functions.invoke("protokoll", { body: done.length === 1 ? { mode: "notify", id: done[0] } : { mode: "notify", ids: done } });
    sent = r.error ? -1 : r.data?.sent ?? 0;
  }
  state.protImport = null; await loadProtocols(); render(); scrollTo(0, 0);
  toast(`${ok} Protokolle hochgeladen${failed ? `, ${failed} fehlgeschlagen` : ""}.${sent === -1 ? " Die Push-Nachricht konnte nicht verschickt werden." : sent !== null ? ` Vorstand informiert (${sent}).` : ""}`);
}

/* ---------- Status laufender Entwürfe automatisch nachladen ---------- */
let protTimer = null;
function setProtPolling(on) {
  if (on && !protTimer) protTimer = setInterval(async () => {
    const busy = (state.protocols || []).filter(isBusy);
    if (!busy.length || state.role !== "board" || state.boardTab !== "prot") { clearInterval(protTimer); protTimer = null; return; }
    const before = busy.map(p => p.job_state).join();
    await loadProtocols();
    const after = (state.protocols || []).filter(p => busy.some(b => b.id === p.id)).map(p => p.job_state).join();
    if (before !== after && !document.querySelector("#prot-form textarea:focus")) render();
  }, 20000);
}

/* ---------- Steuerung ---------- */
function openProtocolsFromHash() {
  const m = location.hash.match(/^#prot-(\d+)$/);
  if (!m || !state.me?.is_board) return;
  state.role = "board"; state.boardTab = "prot"; state.protocols = null;
  const id = +m[1];
  loadProtocols().then(() => { const p = protById(id); if (state.me.is_admin && p && p.status !== "final") state.protEdit = id; else state.protOpen = id; render(); });
}
window.addEventListener("hashchange", openProtocolsFromHash);

document.addEventListener("click", async ev => {
  const t = ev.target.closest("button, a");
  if (!t || !state.me) return;
  const d = t.dataset;
  if (d.prot) { const p = protById(+d.prot); if (state.me.is_admin && p.status !== "final") state.protEdit = p.id; else state.protOpen = p.id; state.protConfirmDelete = false; state.protPreview = false; render(); scrollTo(0, 0); return; }
  if (t.id === "prot-back") { state.protOpen = null; render(); return; }
  if (t.id === "prot-new") { state.protEdit = "new"; render(); scrollTo(0, 0); return; }
  if (t.id === "prot-edit-cancel") { const id = state.protEdit; state.protEdit = null; state.protOpen = id === "new" ? null : protById(id)?.status === "final" ? id : null; render(); return; }
  if (t.id === "prot-import") { state.protImport = { rows: [] }; render(); return; }
  if (t.id === "prot-import-close") { state.protImport = null; render(); return; }
  if (t.id === "prot-import-go") { t.disabled = true; return runImport(); }
  if (t.id === "prot-check") {
    t.disabled = true; t.textContent = "Wird geprüft …";
    const { data, error } = await db.functions.invoke("protokoll", { body: { mode: "check" } });
    t.disabled = false; t.textContent = "Azure prüfen";
    return toast(error ? "Prüfung fehlgeschlagen." : `Spracherkennung: ${data.speech} · KI: ${data.ki}${data.ki_ressource ? ` (Ressource ${data.ki_ressource}, Bereitstellungen: ${data.ki_bereitstellungen})` : ""}`);
  }
  if (t.id === "prot-pdf-link" && t.getAttribute("aria-disabled")) { ev.preventDefault(); return; }
  if (t.id === "prot-pdf") { const p = protById(state.protOpen); const b = await protPdfBlob(p, p.status !== "final"); return download(`${protFileName(p)}.pdf`, b, "application/pdf"); }
  if (t.id === "prot-edit") { state.protEdit = state.protOpen; state.protOpen = null; state.protConfirmFinal = false; render(); scrollTo(0, 0); return; }
  if (t.id === "prot-del") { state.protConfirmDelete = true; render(); return; }
  if (t.id === "prot-del-no") { state.protConfirmDelete = false; render(); return; }
  if (t.id === "prot-del-yes") {
    const p = protById(state.protOpen);
    const paths = [p.pdf_path].filter(Boolean);
    const { data: files } = await db.storage.from("vorstand").list(`audio/${p.id}`);
    paths.push(...(files || []).map(f => `audio/${p.id}/${f.name}`));
    if (paths.length) await db.storage.from("vorstand").remove(paths);
    const { error } = await db.from("protocols").delete().eq("id", p.id);
    if (error) return fail(error, "Löschen hat nicht geklappt.");
    state.protocols = state.protocols.filter(x => x.id !== p.id); state.protOpen = null; state.protConfirmDelete = false; render(); return toast("Protokoll gelöscht.");
  }
  const editing = () => protById(state.protEdit);
  if (t.id === "prot-preview") { const p = readProtForm(editing()); state.protocols = state.protocols.map(x => x.id === p.id ? p : x); state.protPreview = true; render(); return; }
  if (t.id === "prot-draft-pdf") { const p = readProtForm(editing()); t.disabled = true; try { download(`${protFileName(p)}_Entwurf.pdf`, await protPdfBlob(p, true), "application/pdf"); } catch (e) { toast("Das PDF konnte nicht erzeugt werden."); } t.disabled = false; return; }
  if (t.id === "prot-docx") { const p = readProtForm(editing()); return download(`${protFileName(p)}_Entwurf.docx`, protDocx(p), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"); }
  if (t.id === "prot-regen") { t.disabled = true; return regenerate(editing()); }
  if (t.id === "prot-job-cancel") { await db.from("protocols").update({ job_state: "fehler", job_error: "Abgebrochen." }).eq("id", state.protEdit); await loadProtocols(); render(); return; }
  if (t.id === "prot-final") { state.protConfirmFinal = true; const p = readProtForm(editing()); state.protocols = state.protocols.map(x => x.id === p.id ? p : x); render(); return; }
  if (t.id === "prot-final-no") { state.protConfirmFinal = false; render(); return; }
  if (t.id === "prot-final-yes") { t.disabled = true; return finalizeProt(editing()); }
});
document.addEventListener("input", ev => {
  if (ev.target.id === "prot-search") { state.protQuery = ev.target.value; const pos = ev.target.selectionStart; render(); const s = $("#prot-search"); s.focus(); s.setSelectionRange(pos, pos); }
});
document.addEventListener("change", async ev => {
  const t = ev.target;
  if (t.id === "pn-notes-file" && t.files[0]) {
    try {
      const f = t.files[0];
      const text = /\.docx$/i.test(f.name) ? await docxToText(f) : await f.text();
      $("#pn-notes").value = text; toast("Mitschrift übernommen.");
    } catch (e) { console.error(e); toast(e.message || "Die Datei konnte nicht gelesen werden."); }
  }
  if (t.id === "prot-files") {
    const have = new Set((state.protocols || []).map(p => p.original_name).filter(Boolean));
    state.protImport.rows = [...t.files].filter(f => /\.pdf$/i.test(f.name)).sort((a, b) => a.name.localeCompare(b.name))
      .map(f => ({ file: f, dup: have.has(f.name), ...parseProtName(f.name) }));
    if (t.files.length && !state.protImport.rows.length) toast("Bitte PDF-Dateien wählen.");
    render();
  }
  if (t.dataset?.impDate !== undefined) {
    const r = state.protImport.rows[+t.dataset.impDate];
    if (r) { r.meeting_date = t.value || null; r.date_is_month = false; }
  }
});
document.addEventListener("submit", async ev => {
  if (ev.target.id === "prot-new-form") { ev.preventDefault(); $("#pn-submit").disabled = true; return createProtocol(); }
  if (ev.target.id === "prot-form") {
    ev.preventDefault();
    const p = readProtForm(protById(state.protEdit));
    $("#pe-save").disabled = true;
    const saved = await saveProt(p, p.job_state === "fertig" ? { job_state: null } : {});
    $("#pe-save") && ($("#pe-save").disabled = false);
    if (saved) toast("Gespeichert.");
  }
});
