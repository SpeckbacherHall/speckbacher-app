/* Speckbacher-App – Pilot
   Ausrückungen mit Zu-/Absage, Admin-Rückmeldungen, Telefonliste, Termine anlegen.
   Alle Rechte werden in der Datenbank geprüft (Row-Level-Security); die App zeigt nur an. */

const { createClient } = window.supabase;
const cfg = window.SPECKBACHER_CONFIG;
const db = createClient(cfg.supabaseUrl, cfg.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

const TYPES = { kompanie: "Kompanieausrückung", fahne: "Fahnenabordnung", sonstig: "Sonstige Aktivität", vorstand: "Vorstandstermin" };

const state = {
  me: null, events: [], responses: [], members: [],
  role: "member", filter: "alle", when: "kommend", detailTab: null, attendance: [], access: null, edit: null, editEvent: false, allMembers: [], adminTab: "rueck", openEvent: null, phoneQuery: "", confirmDelete: false
};

/* ---------- Hilfen ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dt = d => new Date(d + "T12:00:00");
const wd = d => dt(d).toLocaleDateString("de-AT", { weekday: "short" }).replace(".", "");
const day = d => dt(d).getDate();
const monthYear = d => dt(d).toLocaleDateString("de-AT", { month: "long", year: "numeric" });
const longDate = d => dt(d).toLocaleDateString("de-AT", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const hm = t => (t || "").slice(0, 5);
const todayIso = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Vienna" });
const canDecline = e => e.kind === "kompanie" || e.kind === "vorstand";
const fullName = m => `${m.first_name} ${m.last_name}`;
const priv = m => (Array.isArray(m.member_private) ? m.member_private[0] : m.member_private) || {};
const myResp = id => state.responses.find(r => r.event_id === id && r.member_id === state.me.id)?.status;
const timesLine = e => {
  const begin = e.start_time ? `Beginn ${hm(e.start_time)} Uhr` : "Uhrzeit folgt";
  return e.muster_time ? `Antreten ${hm(e.muster_time)} · ${begin}` : begin;
};
const isPast = e => e.event_date < todayIso();
const upcoming = () => state.events.filter(e => !isPast(e));
const daysAgoIso = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toLocaleDateString("sv-SE", { timeZone: "Europe/Vienna" }); };
const sortEvents = () => state.events.sort((a, b) => (a.event_date + (a.start_time || "99")).localeCompare(b.event_date + (b.start_time || "99")));

let toastTimer;
function toast(text) {
  $("#toast-text").textContent = text;
  $("#toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 4500);
}
function fail(error, fallback) {
  console.error(error);
  toast(error?.message && /[äöüß]|nur|Admin|Termin/.test(error.message) ? error.message : fallback);
}
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- Anmeldung ---------- */
function renderLogin(message) {
  $("#roles").hidden = true; $("#logout").hidden = true;
  $("#view").innerHTML = `<form class="panel login" id="login-form">
    <h2>Anmelden</h2>
    <p class="fn">Deine E-Mail-Adresse und deinen persönlichen Zugangscode bekommst du von der Kompanieführung.</p>
    <label for="login-email">E-Mail-Adresse<input id="login-email" type="email" autocomplete="username" required></label>
    <label for="login-code">Zugangscode<input id="login-code" autocomplete="current-password" autocapitalize="characters" placeholder="z. B. K7QM-4TXA" required></label>
    <button class="btn yes" type="submit">Anmelden</button>
    ${message ? `<p class="rule">${esc(message)}</p>` : ""}
  </form>`;
}
const normCode = c => {
  const s = c.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4)}` : c.trim();
};
async function login(email, code) {
  const { error } = await db.auth.signInWithPassword({ email: email.trim().toLowerCase(), password: normCode(code) });
  if (error) {
    console.error(error);
    return renderLogin("E-Mail-Adresse oder Zugangscode stimmen nicht. Bitte prüfe die Eingabe oder frag nach einem neuen Code.");
  }
  // Weiter geht es über onAuthStateChange (SIGNED_IN)
}

/* ---------- Daten ---------- */
async function loadAll() {
  const uid = (await db.auth.getUser()).data.user?.id;
  const [mem, ev, rs, at] = await Promise.all([
    db.from("members").select("id,user_id,first_name,last_name,role_title,rank,is_admin,is_board,active,member_private(phone,rifle_number,email,needs_post,address,birthday)").order("last_name").order("first_name"),
    db.from("events").select("*").gte("event_date", daysAgoIso(400)).order("event_date").order("start_time", { nullsFirst: false }),
    db.from("responses").select("event_id,member_id,status,entered_by"),
    db.from("attendance").select("event_id,member_id,present")
  ]);
  if (mem.error || ev.error || rs.error || at.error) throw (mem.error || ev.error || rs.error || at.error);
  state.attendance = at.data;
  state.allMembers = mem.data;
  state.members = mem.data.filter(m => m.active);
  state.events = ev.data;
  state.responses = rs.data;
  state.me = state.members.find(m => m.user_id === uid) || null;
}

/* ---------- Mitglied ---------- */
function renderMember() {
  let list = upcoming();
  if (state.filter === "offen") list = list.filter(e => !myResp(e.id));
  if (state.filter === "zu") list = list.filter(e => myResp(e.id) === "yes");
  const open = upcoming().filter(e => !myResp(e.id)).length;
  let html = `<p class="hello">Angemeldet als <b>${esc(fullName(state.me))}</b> · ${open ? `${open} ${open === 1 ? "Termin wartet" : "Termine warten"} auf deine Rückmeldung` : "Alles beantwortet"}</p>
  <div class="filters" role="group" aria-label="Filter">
    ${[["alle", "Alle"], ["offen", "Offen"], ["zu", "Zugesagt"]].map(([k, l]) => `<button class="chip" data-filter="${k}" aria-pressed="${state.filter === k}">${l}</button>`).join("")}
  </div>`;
  if (!upcoming().length) return html + `<p class="empty" style="margin-top:16px">Derzeit sind keine Ausrückungen eingetragen.</p>`;
  if (!list.length) return html + `<p class="empty" style="margin-top:16px">Keine Termine in dieser Auswahl.</p>`;
  let lastMonth = "";
  for (const e of list) {
    const m = monthYear(e.event_date);
    if (m !== lastMonth) { if (lastMonth) html += `</div>`; html += `<div class="month">${m}</div><div class="list">`; lastMonth = m; }
    const r = myResp(e.id);
    let act;
    if (r === "yes") act = `<span class="status yes">Zugesagt</span><button class="btn ghost" data-cal="${e.id}">In Kalender</button><button class="btn ghost" data-undo="${e.id}">Zusage zurückziehen</button>`;
    else if (r === "no") act = `<span class="status no">Abgesagt</span><button class="btn ghost" data-undo="${e.id}">Ändern</button>`;
    else act = `<button class="btn yes" data-yes="${e.id}">Zusagen</button>${canDecline(e) ? `<button class="btn no" data-no="${e.id}">Absagen</button>` : ""}`;
    html += `<article class="card">
      <div class="date"><div class="d">${day(e.event_date)}</div><div class="w">${wd(e.event_date)}</div></div>
      <div class="body">
        <span class="type t-${e.kind}">${TYPES[e.kind]}</span>
        <h3>${esc(e.title)}</h3>
        <p class="meta"><span>${timesLine(e)}</span><span>${esc(e.place)}</span>${e.dress ? `<span>Adjustierung: ${esc(e.dress)}</span>` : ""}${e.notes ? `<span>${esc(e.notes)}</span>` : ""}</p>
        <div class="actions">${act}</div>
        ${!r && !canDecline(e) ? `<p class="rule">Bei ${e.kind === "fahne" ? "Fahnenabordnungen" : "sonstigen Aktivitäten"} meldest du dich nur, wenn du dabei bist.</p>` : ""}
      </div></article>`;
  }
  return html + `</div>`;
}
async function setResp(eventId, status) {
  const q = status
    ? db.from("responses").upsert({ event_id: eventId, member_id: state.me.id, status })
    : db.from("responses").delete().eq("event_id", eventId).eq("member_id", state.me.id);
  const { error } = await q;
  if (error) return fail(error, "Die Rückmeldung konnte nicht gespeichert werden.");
  state.responses = state.responses.filter(r => !(r.event_id === eventId && r.member_id === state.me.id));
  if (status) state.responses.push({ event_id: eventId, member_id: state.me.id, status });
  render();
  if (status === "yes") toast("Zugesagt. Danke für deine Rückmeldung.");
  if (status === "no") toast("Abgesagt. Die Kompanieführung sieht deine Rückmeldung.");
}
function icsFor(e) {
  const d = e.event_date.replace(/-/g, "");
  const first = e.muster_time || e.start_time;
  const next = new Date(e.event_date + "T12:00:00"); next.setDate(next.getDate() + 1);
  const dNext = next.toISOString().slice(0, 10).replace(/-/g, "");
  let when;
  if (first) {
    const start = first.slice(0, 5).replace(":", "") + "00";
    const [h, m] = (e.start_time || first).split(":").map(Number);
    const endH = String(Math.min(h + 2, 23)).padStart(2, "0");
    when = [`DTSTART;TZID=Europe/Vienna:${d}T${start}`, `DTEND;TZID=Europe/Vienna:${d}T${endH}${String(m).padStart(2, "0")}00`];
  } else {
    when = [`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${dNext}`];
  }
  const fold = s => String(s || "").replace(/[\\,;]/g, c => "\\" + c).replace(/\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Speckbacher Schützenkompanie//App//DE", "BEGIN:VEVENT",
    `UID:speckbacher-${e.id}@speckbacher-schuetzen.at`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
    ...when,
    `SUMMARY:${fold(e.title)}`,
    `LOCATION:${fold(e.place)}`,
    `DESCRIPTION:${fold(`${TYPES[e.kind]} · ${timesLine(e)}${e.dress ? " · Adjustierung: " + e.dress : ""}`)}`,
    "END:VEVENT", "END:VCALENDAR"
  ].join("\r\n");
}

/* ---------- Admin ---------- */
function tally(e) {
  const rs = state.responses.filter(r => r.event_id === e.id);
  const st = id => rs.find(r => r.member_id === id)?.status;
  const who = e.kind === "vorstand" ? state.members.filter(m => m.is_board) : state.members;
  return {
    yes: who.filter(m => st(m.id) === "yes"),
    no: who.filter(m => st(m.id) === "no"),
    open: who.filter(m => !st(m.id))
  };
}
function bar(t, showNo = true) {
  const n = (t.yes.length + t.no.length + t.open.length) || 1, w = x => (x / n * 100).toFixed(1) + "%";
  return `<div class="bar" aria-hidden="true"><i style="width:${w(t.yes.length)};background:var(--good)"></i>${showNo ? `<i style="width:${w(t.no.length)};background:var(--red)"></i>` : ""}</div>
  <div class="counts"><span><i class="dot" style="background:var(--good)"></i><b>${t.yes.length}</b> zugesagt</span>${showNo ? `<span><i class="dot" style="background:var(--red)"></i><b>${t.no.length}</b> abgesagt</span>` : ""}<span><i class="dot" style="background:var(--line)"></i><b>${t.open.length}</b> offen</span></div>`;
}
function rows(list, empty, e, status) {
  if (!list.length) return `<p class="empty">${empty}</p>`;
  return `<table><tbody>${list.map(m => {
    const p = priv(m);
    const r = state.responses.find(x => x.event_id === e.id && x.member_id === m.id);
    const byAdmin = r?.entered_by ? " · vom Admin eingetragen" : "";
    // Admins tragen Rückmeldungen für Mitglieder ohne App ein (oder korrigieren sie)
    const act = status === "open"
      ? `<button class="mini yes" data-set="${m.id}" data-status="yes">Zusage</button>${canDecline(e) ? `<button class="mini no" data-set="${m.id}" data-status="no">Absage</button>` : ""}`
      : `<button class="mini" data-set="${m.id}" data-status="">zurücksetzen</button>`;
    return `<tr><td>${esc(fullName(m))}${m.id === state.me.id ? ` <span class="fn">(du)</span>` : ""}<br><span class="fn">${esc([m.rank, m.role_title].filter(Boolean).join(" · ") || "Mitglied")}${!m.user_id ? " · ohne App" : ""}${byAdmin}</span><div class="minis">${act}</div></td>
      <td class="gw">${p.rifle_number ? "Nr. " + esc(p.rifle_number) : "–"}</td></tr>`;
  }).join("")}</tbody></table>`;
}
async function setRespFor(eventId, memberId, status) {
  const q = status
    ? db.from("responses").upsert({ event_id: eventId, member_id: memberId, status }).select("event_id,member_id,status,entered_by").single()
    : db.from("responses").delete().eq("event_id", eventId).eq("member_id", memberId);
  const { data, error } = await q;
  if (error) return fail(error, "Die Rückmeldung konnte nicht gespeichert werden.");
  state.responses = state.responses.filter(r => !(r.event_id === eventId && r.member_id === memberId));
  if (status) state.responses.push(data);
  render();
}
function relevantMembers(e) {
  return e.kind === "vorstand" ? state.members.filter(m => m.is_board) : state.members;
}
const presentOf = (e, id) => state.attendance.find(a => a.event_id === e.id && a.member_id === id)?.present;
function attendanceCounts(e) {
  const as = state.attendance.filter(a => a.event_id === e.id);
  return { present: as.filter(a => a.present).length, absent: as.filter(a => !a.present).length };
}
function attendanceSummary(e) {
  const t = tally(e), c = attendanceCounts(e);
  const noShows = t.yes.filter(m => presentOf(e, m.id) === false).length;
  const unannounced = relevantMembers(e).filter(m => presentOf(e, m.id) === true && !t.yes.includes(m)).length;
  return `<div class="counts"><span><i class="dot" style="background:var(--good)"></i><b>${c.present}</b> anwesend</span><span><i class="dot" style="background:var(--red)"></i><b>${c.absent}</b> nicht da</span><span><b>${relevantMembers(e).length - c.present - c.absent}</b> nicht erfasst</span></div>
  ${c.present + c.absent ? `<p class="rule">${noShows} zugesagt, aber nicht da · ${unannounced} da ohne Zusage</p>` : ""}`;
}
function attendanceList(e, t) {
  // Reihenfolge: Zugesagte zuerst, dann ohne Rückmeldung, dann Abgesagte
  const order = [...t.yes, ...t.open, ...t.no];
  const label = m => t.yes.includes(m) ? "zugesagt" : t.no.includes(m) ? "abgesagt" : "keine Rückmeldung";
  const rowsHtml = order.map(m => {
    const p = presentOf(e, m.id);
    return `<tr class="${p === true ? "is-present" : p === false ? "is-absent" : ""}"><td>${esc(fullName(m))}<br><span class="fn">${label(m)}${priv(m).rifle_number ? " · Nr. " + esc(priv(m).rifle_number) : ""}</span></td>
      <td class="att"><button class="mini yes ${p === true ? "on" : ""}" data-att="${m.id}" data-val="true" aria-pressed="${p === true}">da</button><button class="mini no ${p === false ? "on" : ""}" data-att="${m.id}" data-val="false" aria-pressed="${p === false}">nicht da</button></td></tr>`;
  }).join("");
  return `<div class="row-actions" style="margin-top:12px">
      <button class="btn" id="att-all-yes" ${t.yes.length ? "" : "disabled"}>Alle Zugesagten als „da“</button>
      <button class="btn" id="att-rest-no">Übrige als „nicht da“</button>
    </div>
    <p class="rule">Tippe „da“ oder „nicht da“. Nochmal tippen hebt die Auswahl auf.</p>
    <table class="att-table"><tbody>${rowsHtml}</tbody></table>`;
}
async function setAttendance(e, memberIds, present) {
  const q = present === null
    ? db.from("attendance").delete().eq("event_id", e.id).in("member_id", memberIds)
    : db.from("attendance").upsert(memberIds.map(id => ({ event_id: e.id, member_id: id, present })));
  const { error } = await q;
  if (error) return fail(error, "Die Anwesenheit konnte nicht gespeichert werden.");
  state.attendance = state.attendance.filter(a => !(a.event_id === e.id && memberIds.includes(a.member_id)));
  if (present !== null) memberIds.forEach(id => state.attendance.push({ event_id: e.id, member_id: id, present }));
  render();
}
function renderAdmin() {
  let html = `<div class="seg sm" role="group" aria-label="Admin-Bereich">
    <button data-atab="rueck" aria-pressed="${state.adminTab === "rueck"}">Rückmeldungen</button>
    <button data-atab="tel" aria-pressed="${state.adminTab === "tel"}">Mitglieder</button>
    <button data-atab="neu" aria-pressed="${state.adminTab === "neu"}">Neuer Termin</button></div>`;
  if (state.adminTab === "tel") return html + renderPhone();
  if (state.adminTab === "neu") return html + renderNew();
  if (state.openEvent) {
    const e = state.events.find(x => x.id === state.openEvent);
    if (e && state.editEvent) return html + renderNew(e);
    if (e) {
      const t = tally(e);
      // Am Termintag und danach öffnet der Termin direkt in der Anwesenheit
      const tab = state.detailTab || (e.event_date <= todayIso() ? "anw" : "rueck");
      return html + `<button class="back" id="back">‹ Alle Termine</button>
      <div class="panel">
        <span class="type t-${e.kind}">${TYPES[e.kind]}</span>
        <h2>${esc(e.title)}</h2>
        <p class="meta"><span>${longDate(e.event_date)} · ${timesLine(e)}</span><span>${esc(e.place)}${e.dress ? " · " + esc(e.dress) : ""}</span></p>
        ${tab === "rueck" ? bar(t, canDecline(e)) : attendanceSummary(e)}
        <div class="seg sm" role="group" aria-label="Ansicht des Termins">
          <button data-dtab="rueck" aria-pressed="${tab === "rueck"}">Rückmeldungen</button>
          <button data-dtab="anw" aria-pressed="${tab === "anw"}">Anwesenheit</button>
        </div>
        <div class="row-actions">
          <button class="btn" id="event-edit">Bearbeiten</button>
          <button class="btn" id="export">Liste als CSV</button>
          ${state.confirmDelete
            ? `<span class="fn">Termin wirklich löschen?</span><button class="btn danger" id="delete-yes">Ja, löschen</button><button class="btn ghost" id="delete-no">Abbrechen</button>`
            : `<button class="btn danger" id="delete">Termin löschen</button>`}
        </div>
        ${tab === "anw" ? attendanceList(e, t) : `
        <div class="sec"><h4>Zugesagt <span>${t.yes.length}</span></h4>${rows(t.yes, "Noch keine Zusagen.", e, "yes")}</div>
        ${canDecline(e) ? `<div class="sec"><h4>Abgesagt <span>${t.no.length}</span></h4>${rows(t.no, "Keine Absagen.", e, "no")}</div>` : ""}
        <div class="sec"><h4>Keine Rückmeldung <span>${t.open.length}</span></h4>${rows(t.open, "Alle haben geantwortet.", e, "open")}</div>`}
      </div>`;
    }
    state.openEvent = null;
  }
  html += `<div class="filters" role="group" aria-label="Zeitraum">
    <button class="chip" data-when="kommend" aria-pressed="${state.when === "kommend"}">Kommende</button>
    <button class="chip" data-when="vergangen" aria-pressed="${state.when === "vergangen"}">Vergangene</button></div>`;
  const list = state.when === "kommend" ? upcoming() : state.events.filter(isPast).reverse();
  if (!list.length) return html + `<p class="empty" style="margin-top:12px">${state.when === "kommend" ? "Keine kommenden Termine. Lege einen unter „Neuer Termin“ an." : "Keine vergangenen Termine in den letzten zwölf Monaten."}</p>`;
  html += `<div class="list">`;
  let lastMonth = "";
  for (const e of list) {
    const mo = monthYear(e.event_date);
    if (mo !== lastMonth) { html += `<div class="month">${mo}</div>`; lastMonth = mo; }
    const a = attendanceCounts(e);
    html += `<button class="card ev" data-open="${e.id}">
      <div class="date"><div class="d">${day(e.event_date)}</div><div class="w">${wd(e.event_date)}</div></div>
      <div class="body"><span class="type t-${e.kind}">${TYPES[e.kind]}</span><h3>${esc(e.title)}</h3>${isPast(e) ? `<div class="counts"><span><i class="dot" style="background:var(--good)"></i><b>${a.present}</b> anwesend</span><span><i class="dot" style="background:var(--red)"></i><b>${a.absent}</b> nicht da</span>${a.present + a.absent === 0 ? `<span>Anwesenheit nicht erfasst</span>` : ""}</div>` : bar(tally(e), canDecline(e))}</div></button>`;
  }
  return html + `</div>`;
}
function phoneList() {
  const q = state.phoneQuery.toLowerCase();
  return state.allMembers.filter(m => `${fullName(m)} ${m.rank || ""} ${m.role_title || ""}`.toLowerCase().includes(q));
}
function accessMessage(a) {
  const url = location.origin + location.pathname;
  return `Servus ${a.first_name}! Dein Zugang zur Speckbacher-App:\n${url}\nE-Mail: ${a.email}\nZugangscode: ${a.code}\nTipp: Seite am Handy öffnen und „Zum Home-Bildschirm“ hinzufügen.`;
}
function accessBox(m) {
  const a = state.access;
  if (!a || a.memberId !== m.id) return "";
  const msg = accessMessage(a);
  const phone = (priv(m).phone || "").replace(/[^\d]/g, "");
  return `<tr><td colspan="2"><div class="access">
    <p><b>Zugangscode für ${esc(a.first_name)}:</b> <span class="code">${esc(a.code)}</span></p>
    <p class="fn">Der Code wird nur jetzt angezeigt. Ein neuer Code macht den alten ungültig.</p>
    <pre class="msg" id="access-msg">${esc(msg)}</pre>
    <div class="row-actions">
      <button class="btn yes" id="copy-msg">Nachricht kopieren</button>
      ${phone ? `<a class="btn" href="https://wa.me/${phone}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">Per WhatsApp senden</a>` : ""}
    </div></div></td></tr>`;
}
function phoneRows(list) {
  if (!list.length) return `<p class="empty">Kein Mitglied gefunden.</p>`;
  return `<table><tbody>${list.map(m => {
    const p = priv(m);
    const access = !m.active ? "" : !p.email ? `<span class="fn">keine E-Mail</span>`
      : `<button class="btn ghost" data-access="${m.id}">${m.user_id ? "Neuer Code" : "Zugang erzeugen"}</button>`;
    return `<tr><td><button class="name-btn" data-edit="${m.id}">${esc(fullName(m))}</button>${m.user_id ? ` <span class="pill">App</span>` : ""}${!m.active ? ` <span class="pill off">inaktiv</span>` : ""}<br><span class="fn">${esc([m.rank, m.role_title].filter(Boolean).join(" · ") || "Mitglied")}${p.rifle_number ? " · Gewehr Nr. " + esc(p.rifle_number) : ""}</span></td>
      <td style="text-align:right">${p.phone ? `<a class="tel" href="tel:${esc(p.phone.replace(/\s/g, ""))}">${esc(p.phone)}</a>` : `<span class="fn">keine Nummer</span>`}<br>${access}</td></tr>${accessBox(m)}`;
  }).join("")}</tbody></table>`;
}
async function createAccess(memberId) {
  const { data, error } = await db.functions.invoke("zugang", { body: { member_id: memberId } });
  if (error) {
    let msg = "Der Zugang konnte nicht erzeugt werden.";
    try { msg = (await error.context.json()).error || msg; } catch (e) {}
    return toast(msg);
  }
  const m = state.members.find(x => x.id === memberId);
  if (m && !m.user_id) m.user_id = "neu";
  state.access = { memberId, ...data };
  $("#phone-list").innerHTML = phoneRows(phoneList());
}
function field(id, label, value, type = "text", extra = "") {
  return `<label for="${id}">${label}<input id="${id}" type="${type}" value="${esc(value ?? "")}" ${extra}></label>`;
}
function check(id, label, on) {
  return `<label class="check" for="${id}"><input id="${id}" type="checkbox" ${on ? "checked" : ""}> ${label}</label>`;
}
function renderEdit() {
  const isNew = state.edit === "new";
  const m = isNew ? { active: true, is_admin: false } : state.allMembers.find(x => x.id === state.edit);
  if (!m) { state.edit = null; return renderPhone(); }
  const p = isNew ? {} : priv(m);
  return `<button class="back" id="edit-cancel" type="button">‹ Alle Mitglieder</button>
  <form class="panel" id="edit-form">
    <h2>${isNew ? "Neues Mitglied" : esc(fullName(m))}</h2>
    <div class="grid2">${field("e-first", "Vorname", m.first_name, "text", "required")}${field("e-last", "Nachname", m.last_name, "text", "required")}</div>
    <div class="grid2">${field("e-rank", "Rang", m.rank)}${field("e-role", "Funktion", m.role_title)}</div>
    ${field("e-email", "E-Mail (für die Anmeldung)", p.email, "email", 'autocomplete="off"')}
    <div class="grid2">${field("e-phone", "Telefon", p.phone, "tel")}${field("e-rifle", "Gewehrnummer", p.rifle_number)}</div>
    ${field("e-address", "Adresse", p.address)}
    ${field("e-birthday", "Geburtstag", p.birthday, "date")}
    <div class="checks">
      ${check("e-post", "Rundschreiben per Post", p.needs_post)}
      ${check("e-active", "Aktiv (kann sich anmelden)", m.active)}
      ${check("e-board", "Vorstand (sieht Vorstandstermine)", m.is_board)}
      ${check("e-admin", "Admin", m.is_admin)}
    </div>
    ${!isNew && m.user_id ? `<p class="rule">Eine geänderte E-Mail-Adresse gilt sofort auch für die Anmeldung. Der Zugangscode bleibt gleich.</p>` : ""}
    <div class="row-actions"><button class="btn yes" type="submit" id="e-submit">Speichern</button><button class="btn ghost" type="button" id="edit-cancel2">Abbrechen</button></div>
  </form>`;
}
async function saveMember() {
  const isNew = state.edit === "new";
  const val = id => $(id).value.trim() || null;
  const email = val("#e-email")?.toLowerCase() || null;
  const memberRow = {
    first_name: val("#e-first"), last_name: val("#e-last"), rank: val("#e-rank"), role_title: val("#e-role"),
    active: $("#e-active").checked, is_board: $("#e-board").checked, is_admin: $("#e-admin").checked
  };
  const privRow = {
    email, phone: val("#e-phone"), rifle_number: val("#e-rifle"), address: val("#e-address"),
    birthday: val("#e-birthday"), needs_post: $("#e-post").checked
  };
  const old = isNew ? null : state.allMembers.find(x => x.id === state.edit);
  const oldEmail = old ? priv(old).email : null;
  let id = state.edit;
  if (isNew) {
    const r = await db.from("members").insert(memberRow).select("id").single();
    if (r.error) return saveFailed(r.error);
    id = r.data.id;
  } else {
    const r = await db.from("members").update(memberRow).eq("id", id);
    if (r.error) return saveFailed(r.error);
  }
  const r2 = await db.from("member_private").upsert({ member_id: id, ...privRow });
  if (r2.error) return saveFailed(r2.error);
  if (old?.user_id && email && email !== oldEmail) {
    const { error } = await db.functions.invoke("zugang", { body: { member_id: id, action: "email" } });
    if (error) toast("Gespeichert, aber die Anmelde-E-Mail konnte nicht geändert werden. Erzeuge einen neuen Zugangscode.");
  }
  await loadAll();
  state.edit = null;
  if (!state.me) { await db.auth.signOut(); return renderLogin(); }
  render();
  toast(isNew ? "Mitglied angelegt." : "Gespeichert.");
}
function saveFailed(error) {
  console.error(error);
  $("#e-submit").disabled = false;
  toast(error.code === "23505" ? "Diese E-Mail-Adresse ist schon bei einem anderen Mitglied eingetragen." : "Speichern hat nicht geklappt. Bitte prüfe die Eingaben.");
}
function renderPhone() {
  if (state.edit) return renderEdit();
  return `<div class="row-actions" style="margin-bottom:10px"><button class="btn" id="member-new">Neues Mitglied</button></div>
  <input class="search" id="phone-search" type="search" placeholder="Name, Rang oder Funktion suchen" value="${esc(state.phoneQuery)}" aria-label="Mitglied suchen">
  <div class="panel" id="phone-list">${phoneRows(phoneList())}</div>`;
}
function renderNew(e = null) {
  const v = k => esc(e?.[k] ?? "");
  const t = k => esc(hm(e?.[k]));
  return `${e ? `<button class="back" id="event-edit-cancel" type="button">‹ Zurück zum Termin</button>` : ""}
  <form class="panel" id="new-form">
    <h2>${e ? "Termin bearbeiten" : "Neuen Termin anlegen"}</h2>
    <label for="f-kind">Art<select id="f-kind">${Object.entries(TYPES).map(([k, l]) => `<option value="${k}" ${e?.kind === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    <p class="rule">Vorstandstermine sehen nur Mitglieder mit dem Häkchen „Vorstand“.</p>
    <label for="f-title">Bezeichnung<input id="f-title" required placeholder="z. B. Herz-Jesu-Prozession" value="${v("title")}"></label>
    <div class="grid2">
      <label for="f-date">Datum<input id="f-date" type="date" required ${e ? "" : `min="${todayIso()}"`} value="${v("event_date")}"></label>
      <label for="f-time">Beginn (leer = folgt)<input id="f-time" type="time" value="${t("start_time")}"></label>
    </div>
    <div class="grid2">
      <label for="f-muster">Antreten (optional)<input id="f-muster" type="time" value="${t("muster_time")}"></label>
      <label for="f-dress">Adjustierung<input id="f-dress" placeholder="z. B. Tracht mit Gewehr" value="${v("dress")}"></label>
    </div>
    <label for="f-place">Ort<input id="f-place" required placeholder="z. B. Pfarrkirche St. Nikolaus" value="${v("place")}"></label>
    <label for="f-notes">Hinweis (optional)<input id="f-notes" value="${v("notes")}"></label>
    <button class="btn yes" type="submit" id="f-submit">${e ? "Änderungen speichern" : "Termin veröffentlichen"}</button>
  </form>`;
}
function exportCsv(e) {
  const t = tally(e);
  const att = m => { const p = presentOf(e, m.id); return p === true ? "anwesend" : p === false ? "nicht anwesend" : ""; };
  const line = (m, s) => [fullName(m), m.rank || "", m.role_title || "", priv(m).rifle_number || "", priv(m).phone || "", s, att(m)].map(v => `"${String(v).replace(/"/g, '""')}"`).join(";");
  const csv = "\uFEFFName;Rang;Funktion;Gewehrnummer;Telefon;Rückmeldung;Anwesenheit\r\n" +
    [...t.yes.map(m => line(m, "zugesagt")), ...t.no.map(m => line(m, "abgesagt")), ...t.open.map(m => line(m, "offen"))].join("\r\n");
  download(`Rueckmeldungen_${e.event_date}_${e.title.replace(/[^\wäöüÄÖÜß-]+/g, "_")}.csv`, csv, "text/csv;charset=utf-8");
}

/* ---------- Steuerung ---------- */
function render() {
  if (!state.me) return;
  const admin = !!state.me.is_admin;
  $("#roles").hidden = !admin;
  $("#logout").hidden = false;
  if (!admin) state.role = "member";
  $("#role-member").setAttribute("aria-pressed", state.role === "member");
  $("#role-admin").setAttribute("aria-pressed", state.role === "admin");
  $("#view").innerHTML = state.role === "admin" ? renderAdmin() : renderMember();
}

document.addEventListener("click", async ev => {
  const t = ev.target.closest("button");
  if (!t) return;
  const d = t.dataset;
  if (t.id === "logout") { await db.auth.signOut(); state.me = null; renderLogin(); return; }
  if (t.id === "role-member" || t.id === "role-admin") {
    state.role = t.id === "role-admin" ? "admin" : "member"; state.openEvent = null;
    try { localStorage.setItem("sp-role", state.role); } catch (e) {}
    render(); scrollTo(0, 0); return;
  }
  if (d.filter) { state.filter = d.filter; render(); return; }
  if (d.yes) return setResp(+d.yes, "yes");
  if (d.no) return setResp(+d.no, "no");
  if (d.undo) return setResp(+d.undo, null);
  if (d.cal) { const e = state.events.find(x => x.id === +d.cal); download(`${e.event_date}_Ausrueckung.ics`, icsFor(e), "text/calendar"); return; }
  if (d.atab) { state.adminTab = d.atab; state.openEvent = null; state.access = null; state.edit = null; state.editEvent = false; render(); return; }
  if (d.open) { state.openEvent = +d.open; state.confirmDelete = false; state.editEvent = false; state.detailTab = null; render(); scrollTo(0, 0); return; }
  if (t.id === "back") { state.openEvent = null; render(); return; }
  if (d.access) { t.disabled = true; t.textContent = "Wird erzeugt …"; return createAccess(d.access); }
  if (d.edit) { state.edit = d.edit; state.access = null; render(); scrollTo(0, 0); return; }
  if (t.id === "member-new") { state.edit = "new"; state.access = null; render(); scrollTo(0, 0); return; }
  if (t.id === "edit-cancel" || t.id === "edit-cancel2") { state.edit = null; render(); return; }
  if (t.id === "copy-msg") {
    const text = $("#access-msg").textContent;
    try { await navigator.clipboard.writeText(text); toast("Nachricht kopiert."); }
    catch (e) { const r = document.createRange(); r.selectNodeContents($("#access-msg")); getSelection().removeAllRanges(); getSelection().addRange(r); toast("Text markiert – jetzt kopieren."); }
    return;
  }
  if (t.id === "event-edit") { state.editEvent = true; render(); scrollTo(0, 0); return; }
  if (t.id === "event-edit-cancel") { state.editEvent = false; render(); return; }
  if (d.set !== undefined && d.status !== undefined) { t.disabled = true; return setRespFor(state.openEvent, d.set, d.status || null); }
  if (d.when) { state.when = d.when; render(); return; }
  if (d.dtab) { state.detailTab = d.dtab; render(); return; }
  if (d.att) {
    const e = state.events.find(x => x.id === state.openEvent);
    const val = d.val === "true";
    t.disabled = true;
    return setAttendance(e, [d.att], presentOf(e, d.att) === val ? null : val);
  }
  if (t.id === "att-all-yes") { const e = state.events.find(x => x.id === state.openEvent); return setAttendance(e, tally(e).yes.map(m => m.id), true); }
  if (t.id === "att-rest-no") {
    const e = state.events.find(x => x.id === state.openEvent);
    const rest = relevantMembers(e).filter(m => presentOf(e, m.id) === undefined).map(m => m.id);
    if (!rest.length) return toast("Alle sind bereits erfasst.");
    return setAttendance(e, rest, false);
  }
  if (t.id === "export") { exportCsv(state.events.find(x => x.id === state.openEvent)); return; }
  if (t.id === "delete") { state.confirmDelete = true; render(); return; }
  if (t.id === "delete-no") { state.confirmDelete = false; render(); return; }
  if (t.id === "delete-yes") {
    const id = state.openEvent;
    const { error } = await db.from("events").delete().eq("id", id);
    if (error) return fail(error, "Der Termin konnte nicht gelöscht werden.");
    state.events = state.events.filter(e => e.id !== id);
    state.responses = state.responses.filter(r => r.event_id !== id);
    state.openEvent = null; state.confirmDelete = false; render(); toast("Termin gelöscht."); return;
  }
});
document.addEventListener("input", ev => {
  if (ev.target.id === "phone-search") { state.phoneQuery = ev.target.value; $("#phone-list").innerHTML = phoneRows(phoneList()); }
});
document.addEventListener("submit", async ev => {
  ev.preventDefault();
  if (ev.target.id === "login-form") {
    const btn = ev.target.querySelector("button"); btn.disabled = true; btn.textContent = "Anmelden …";
    return login($("#login-email").value, $("#login-code").value);
  }
  if (ev.target.id === "edit-form") { $("#e-submit").disabled = true; return saveMember(); }
  if (ev.target.id === "new-form") {
    $("#f-submit").disabled = true;
    const editing = state.editEvent ? state.openEvent : null;
    const row = {
      kind: $("#f-kind").value, title: $("#f-title").value.trim(), event_date: $("#f-date").value,
      start_time: $("#f-time").value || null, muster_time: $("#f-muster").value || null, place: $("#f-place").value.trim(),
      dress: $("#f-dress").value.trim() || null, notes: $("#f-notes").value.trim() || null
    };
    if (!editing) row.created_by = state.me.id;
    const { data, error } = editing
      ? await db.from("events").update(row).eq("id", editing).select().single()
      : await db.from("events").insert(row).select().single();
    if (error) { $("#f-submit").disabled = false; return fail(error, "Der Termin konnte nicht gespeichert werden."); }
    state.events = state.events.filter(x => x.id !== data.id);
    state.editEvent = false;
    state.events.push(data);
    sortEvents();
    state.adminTab = "rueck"; state.openEvent = data.id; render(); scrollTo(0, 0);
    toast(editing ? "Änderungen gespeichert." : "Termin veröffentlicht.");
  }
});

let starting = false;
async function start() {
  if (starting) return;
  starting = true;
  try { await boot(); } finally { starting = false; }
}
async function boot() {
  const { data } = await db.auth.getSession();
  if (!data.session) return renderLogin();
  try {
    await loadAll();
  } catch (e) {
    console.error(e);
    $("#view").innerHTML = `<p class="empty">Die Daten konnten nicht geladen werden. Bitte lade die Seite neu.</p>`;
    return;
  }
  if (!state.me) {
    await db.auth.signOut();
    return renderLogin("Dein Konto ist keinem aktiven Mitglied zugeordnet. Bitte wende dich an den Schriftführer.");
  }
  try { const r = localStorage.getItem("sp-role"); if (r === "admin" || r === "member") state.role = r; } catch (e) {}
  render();
}
db.auth.onAuthStateChange((event) => { if (event === "SIGNED_IN" && !state.me) start(); });
start();
