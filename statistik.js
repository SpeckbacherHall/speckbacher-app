/* Speckbacher-App – Statistik (Admin → Termine → Statistik)
   Je vergangenem Termin: wie viele Schützen und Marketenderinnen anwesend waren (aus der Anwesenheit)
   und wie viele Schuss abgegeben wurden; dazu Jahressummen. Marketenderinnen = Funktion „Marketenderin“
   laut heutigem Mitgliederstand. Lädt alle Jahre bei Bedarf nach. Nutzt state, db, esc, fetchAll … aus app.js. */

state.stats = null;
state.statsYear = null;

async function loadStats() {
  state.stats = "laden";
  const [ev, at] = await Promise.all([
    fetchAll(() => db.from("events").select("id,kind,title,event_date,shots").neq("kind", "vorstand").lte("event_date", todayIso()).order("event_date")),
    fetchAll(() => db.from("attendance").select("event_id,member_id").eq("present", true).order("event_id").order("member_id"))
  ]);
  if (ev.error || at.error) { state.stats = null; return toast("Die Statistik konnte nicht geladen werden."); }
  const byEvent = new Map();
  for (const a of at.data) { if (!byEvent.has(a.event_id)) byEvent.set(a.event_id, []); byEvent.get(a.event_id).push(a.member_id); }
  const member = id => state.allMembers.find(m => m.id === id);
  state.stats = ev.data.map(e => {
    const ids = byEvent.get(e.id) || [];
    const mk = ids.filter(id => isMk(member(id))).length;
    return { ...e, recorded: ids.length > 0, schuetzen: ids.length - mk, mk };
  }).filter(e => e.recorded || e.shots != null);
  const years = statYears();
  if (!state.statsYear || !years.includes(state.statsYear)) state.statsYear = years[0] || todayIso().slice(0, 4);
  if (state.adminTab === "rueck" && state.when === "statistik") render();
}
const statYears = () => [...new Set((Array.isArray(state.stats) ? state.stats : []).map(e => e.event_date.slice(0, 4)))].sort().reverse();

function renderStats() {
  if (state.stats === null) { loadStats(); return `<p class="empty">Statistik wird geladen …</p>`; }
  if (state.stats === "laden") return `<p class="empty">Statistik wird geladen …</p>`;
  const years = statYears();
  if (!years.length) return `<p class="empty" style="margin-top:12px">Noch keine Anwesenheit erfasst. Die Statistik füllt sich, sobald bei vergangenen Terminen „da“/„nicht da“ eingetragen ist.</p>`;
  const y = state.statsYear;
  const list = state.stats.filter(e => e.event_date.startsWith(y)).reverse();
  const rec = list.filter(e => e.recorded);
  const sum = k => list.reduce((s, e) => s + (e[k] || 0), 0);
  const avg = k => rec.length ? (rec.reduce((s, e) => s + e[k], 0) / rec.length).toLocaleString("de-AT", { maximumFractionDigits: 1 }) : "–";
  return `<div class="filters" role="group" aria-label="Jahr">${years.map(v => `<button class="chip" data-stat-year="${v}" aria-pressed="${v === y}">${v}</button>`).join("")}</div>
  <div class="stat-tiles">
    <div class="stat"><b>${rec.length}</b><span>Termine mit Anwesenheit</span></div>
    <div class="stat"><b>${sum("schuetzen")}</b><span>Schützen gesamt<br>Ø ${avg("schuetzen")} je Termin</span></div>
    <div class="stat"><b>${sum("mk")}</b><span>Marketenderinnen gesamt<br>Ø ${avg("mk")} je Termin</span></div>
    <div class="stat"><b>${sum("shots").toLocaleString("de-AT")}</b><span>Schuss abgegeben</span></div>
  </div>
  <div class="panel" style="margin-top:12px">
    <div class="row-actions" style="justify-content:space-between"><h2>Termine ${esc(y)}</h2>${iconBtn("download", `Statistik ${y} als CSV herunterladen`, 'id="stats-csv"', "tonal")}</div>
    <table class="stat-table"><thead><tr><th>Termin</th><th title="Schützen">Sch.</th><th title="Marketenderinnen">Mk.</th><th title="Schuss">Schuss</th></tr></thead><tbody>
    ${list.map(e => `<tr><td>${state.events.some(x => x.id === e.id) ? `<button class="linkish" data-stat-open="${e.id}">${esc(e.title)}</button>` : esc(e.title)}<br><span class="fn">${dmy(e.event_date)} · ${esc(TYPES[e.kind])}</span></td>
      <td>${e.recorded ? e.schuetzen : "–"}</td><td>${e.recorded ? e.mk : "–"}</td><td>${e.shots ?? "–"}</td></tr>`).join("")}
    </tbody></table>
    <p class="rule">Gezählt werden alle als „da“ erfassten Mitglieder; Marketenderinnen nach der Funktion im heutigen Mitgliederstand. Die Schusszahl trägst du beim Termin unter „Anwesenheit“ ein.</p>
  </div>`;
}

function statsCsv() {
  const y = state.statsYear;
  const rows = state.stats.filter(e => e.event_date.startsWith(y));
  const cell = v => { let x = String(v ?? ""); if (/^[=+\-@]/.test(x)) x = "\t" + x; return `"${x.replace(/"/g, '""')}"`; };
  const csv = "﻿Datum;Termin;Art;Schützen;Marketenderinnen;Schuss\r\n" +
    rows.map(e => [dmy(e.event_date), e.title, TYPES[e.kind], e.recorded ? e.schuetzen : "", e.recorded ? e.mk : "", e.shots ?? ""].map(cell).join(";")).join("\r\n");
  download(`Statistik_${y}.csv`, csv, "text/csv;charset=utf-8");
}

document.addEventListener("click", ev => {
  const t = ev.target.closest("button");
  if (!t || !state.me?.is_admin) return;
  if (t.dataset.statYear) { state.statsYear = t.dataset.statYear; render(); return; }
  if (t.dataset.statOpen) { state.openEvent = +t.dataset.statOpen; state.detailTab = "anw"; render(); scrollTo(0, 0); return; }
  if (t.id === "stats-csv") statsCsv();
  if (t.dataset.when === "statistik" && Array.isArray(state.stats)) loadStats();   // beim Öffnen frisch laden
});
