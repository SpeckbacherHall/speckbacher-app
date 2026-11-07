/* Speckbacher-App – Geburtstagsliste
   Alle Mitglieder sehen Name, Tag und Monat. Admins sehen zusätzlich, wie alt jemand wird,
   und bekommen im Rundschreiben-Editor die runden Geburtstage des Monats zum Übernehmen.
   Nutzt state, db, esc … aus app.js. */

const ROUND_AGES = new Set([18, 30, 40, 50, 60, 65, 70, 75, 80, 85, 90, 95, 100]);

function nextBirthday(b, from = todayIso()) {
  const [fy, fm, fd] = from.split("-").map(Number);
  const make = y => {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const [m, d] = b.birth_month === 2 && b.birth_day === 29 && !leap ? [3, 1] : [b.birth_month, b.birth_day];
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  };
  let iso = make(fy);
  if (iso < from) iso = make(fy + 1);
  return iso;
}
const ageOn = (b, iso) => b.birth_year ? Number(iso.slice(0, 4)) - b.birth_year : null;
const daysUntil = iso => Math.round((Date.parse(iso + "T12:00:00") - Date.parse(todayIso() + "T12:00:00")) / 864e5);
const shortDate = iso => dt(iso).toLocaleDateString("de-AT", { day: "numeric", month: "short" });
const MONTHS = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

function birthdayRow(b, iso) {
  const age = ageOn(b, iso);
  const round = age !== null && ROUND_AGES.has(age);
  const isMe = b.member_id === state.me.id;
  return `<tr class="${round ? "is-round" : ""}">
    <td class="bd-date"><b>${b.birth_day}.</b> ${esc(MONTHS[b.birth_month - 1].slice(0, 3))}</td>
    <td>${esc(b.first_name)} ${esc(b.last_name)}${isMe ? ` <span class="fn">(du)</span>` : ""}
      ${age !== null ? `<br><span class="fn">wird ${age}${round ? " · runder Geburtstag" : ""}</span>` : ""}</td>
    <td class="bd-when">${wd(iso)}</td></tr>`;
}
function renderBirthdays() {
  const list = (state.birthdays || []).map(b => ({ b, iso: nextBirthday(b) })).sort((x, y) => x.iso.localeCompare(y.iso));
  const today = list.filter(x => x.iso === todayIso());
  const soon = list.filter(x => { const n = daysUntil(x.iso); return n > 0 && n <= 30; });
  const byMonth = MONTHS.map((name, i) => ({ name, rows: (state.birthdays || []).filter(b => b.birth_month === i + 1) }));
  return `<button class="back" id="bd-close">${ico("arrow_back")}Zu den Ausrückungen</button>
  ${today.length ? `<div class="panel bd-today"><h2>Heute hat Geburtstag</h2>
    ${today.map(({ b, iso }) => `<p class="bd-big">${esc(b.first_name)} ${esc(b.last_name)}${ageOn(b, iso) !== null ? ` <span class="fn">wird ${ageOn(b, iso)}</span>` : ""}</p>`).join("")}</div>` : ""}
  <div class="panel" style="margin-top:12px"><h2>Die nächsten 30 Tage</h2>
    ${soon.length ? `<table><tbody>${soon.map(({ b, iso }) => birthdayRow(b, iso)).join("")}</tbody></table>` : `<p class="empty">In den nächsten 30 Tagen hat niemand Geburtstag.</p>`}
  </div>
  <div class="panel" style="margin-top:12px"><h2>Das ganze Jahr</h2>
    ${byMonth.filter(m => m.rows.length).map(m => `<div class="sec"><h4>${m.name} <span>${m.rows.length}</span></h4>
      <table><tbody>${m.rows.map(b => birthdayRow(b, nextBirthday(b))).join("")}</tbody></table></div>`).join("")}
  </div>
  <p class="rule" style="margin-top:12px">Wer nicht in der Liste stehen möchte, kann das unter „Erinnerungen &amp; Kalender“ ausschalten.</p>`;
}

/* Rundschreiben: runde Geburtstage des gewählten Monats (nur Admins sehen das Alter) */
function roundBirthdaysIn(month) {
  const m = Number(month.slice(5, 7)), y = Number(month.slice(0, 4));
  return (state.birthdays || []).filter(b => b.birth_month === m && b.birth_year && ROUND_AGES.has(y - b.birth_year))
    .map(b => ({ ...b, age: y - b.birth_year }));
}
function roundBirthdayHelper(month) {
  const list = roundBirthdaysIn(month);
  if (!list.length) return `<p class="rule">Keine runden Geburtstage im ${esc(MONTHS[Number(month.slice(5, 7)) - 1])}.</p>`;
  return `<div class="bd-helper"><p class="rule">Runde Geburtstage im ${esc(MONTHS[Number(month.slice(5, 7)) - 1])}: ${list.map(b => `${esc(b.first_name)} ${esc(b.last_name)} (${b.age})`).join(", ")}</p>
    <button class="btn ghost" type="button" id="bd-to-text">Glückwunsch in den freien Text übernehmen</button></div>`;
}
function birthdayGreeting(month) {
  const list = roundBirthdaysIn(month);
  const names = list.map(b => `${b.first_name} ${b.last_name} zum ${b.age}er`);
  const joined = names.length > 1 ? names.slice(0, -1).join(", ") + " und " + names.at(-1) : names[0];
  return `Wir gratulieren herzlich zum runden Geburtstag: ${joined}. Alles Gute und noch viele schöne Jahre in unserer Kompanie!`;
}

document.addEventListener("click", async ev => {
  const t = ev.target.closest("button");
  if (!t || !state.me) return;
  if (t.id === "open-birthdays") { state.showBirthdays = true; render(); scrollTo(0, 0); return; }
  if (t.id === "bd-close") { state.showBirthdays = false; render(); return; }
  if (t.id === "bd-to-text") {
    const ta = $("#nl-free");
    const text = birthdayGreeting(state.nlDraft.month);
    ta.value = ta.value.trim() ? ta.value.trim() + "\n\n" + text : text;
    toast("Glückwunsch eingefügt – noch speichern.");
  }
});
document.addEventListener("change", async ev => {
  if (ev.target.id !== "bd-hide") return;
  const hide = !ev.target.checked;
  const { error } = await db.from("member_private").update({ hide_birthday: hide }).eq("member_id", state.me.id);
  if (error) { ev.target.checked = hide; return fail(error, "Die Einstellung konnte nicht gespeichert werden."); }
  priv(state.me).hide_birthday = hide;
  const r = await db.rpc("birthday_list");
  if (!r.error) state.birthdays = r.data;
  toast(hide ? "Dein Geburtstag ist in der Liste ausgeblendet." : "Dein Geburtstag steht wieder in der Liste.");
});
