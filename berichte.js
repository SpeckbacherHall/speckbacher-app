/* Speckbacher-App – Neues von der Homepage
   Zeigt die letzten Berichte von speckbacher-schuetzen.at (Edge Function „berichte“ liest den RSS-Feed)
   als waagrecht wischbare Karten; ein Tipp öffnet den Bericht auf der Homepage. Nutzt state, esc, cfg aus app.js. */

state.news = null;   // null = noch nicht geladen, "laden", [] oder Liste

async function loadNews() {
  state.news = "laden";
  try {
    const r = await fetch(`${cfg.supabaseUrl}/functions/v1/berichte`, { headers: { apikey: cfg.supabaseKey } });
    const data = await r.json();
    state.news = Array.isArray(data) ? data : [];
  } catch (e) { console.error(e); state.news = []; }
  if (state.role === "member" && !state.letterId) render();
}

function newsBlock() {
  if (state.news === null) { loadNews(); return ""; }
  if (!Array.isArray(state.news) || !state.news.length) return "";
  const date = iso => new Date(iso).toLocaleDateString("de-AT", { day: "numeric", month: "long", year: "numeric" });
  return `<section class="news" aria-label="Neues von der Homepage">
    <div class="news-head"><h2>Neues von der Homepage</h2><a class="btn ghost" href="https://speckbacher-schuetzen.at/berichte-bilder/" target="_blank" rel="noopener">Alle Berichte</a></div>
    <div class="news-row">${state.news.map(n => `<a class="news-card" href="${esc(n.link)}" target="_blank" rel="noopener">
      ${n.image ? `<img src="${esc(n.image)}" alt="" loading="lazy" decoding="async">` : `<div class="news-noimg"></div>`}
      <div class="news-body"><span class="news-date">${esc(date(n.date))}</span><h3>${esc(n.title)}</h3><p>${esc(n.teaser)}</p></div></a>`).join("")}</div>
  </section>`;
}
