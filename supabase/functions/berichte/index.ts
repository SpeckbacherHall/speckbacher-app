// Edge Function "berichte": die letzten Berichte der Homepage (speckbacher-schuetzen.at) für die App.
// Liest den RSS-Feed von WordPress (die REST-API ist dort gesperrt) und das Vorschaubild (og:image) jedes Beitrags.
// Aufruf: GET /functions/v1/berichte  → [{ title, link, date, teaser, image }]; 30 Minuten zwischengespeichert.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SITE = "https://speckbacher-schuetzen.at";
const MAX = 6;
let cache: { at: number; data: unknown } | null = null;

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
const tag = (xml: string, name: string) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? m[1].replace(/^<!\[CDATA\[|\]\]>$/g, "").trim() : "";
};
const text = (html: string) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s*\[…\]\s*$/, " …").replace(/\s+/g, " ").trim();

async function ogImage(url: string) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { "User-Agent": "Speckbacher-App" } });
    const html = await r.text();
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    if (!m || !m[1].startsWith(SITE)) return null;
    const og = decode(m[1]);
    // kleinere Fassung (ca. 768 px breit) aus dem srcset desselben Bildes, damit die App nicht 2560-px-Fotos lädt
    const base = og.replace(/-\d+x\d+(?=\.\w+$)/, "").replace(/-scaled(?=\.\w+$)/, "").replace(/\.\w+$/, "");
    const cands = [...html.matchAll(/srcset=["']([^"']+)["']/gi)].flatMap((s) => decode(s[1]).split(",")
      .map((c) => c.trim().split(/\s+/)).map(([u, w]) => ({ u, w: parseInt(w) })))
      .filter((c) => c.u?.startsWith(base) && c.w >= 600 && c.w <= 1200).sort((a, b) => Math.abs(a.w - 800) - Math.abs(b.w - 800));
    return cands[0]?.u ?? og;
  } catch { return null; }
}

async function load() {
  const r = await fetch(`${SITE}/feed/`, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "Speckbacher-App" } });
  if (!r.ok) throw new Error(`Feed ${r.status}`);
  const xml = await r.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, MAX).map((m) => m[1]);
  return await Promise.all(items.map(async (it) => {
    const link = decode(tag(it, "link"));
    return {
      title: text(tag(it, "title")),
      link: link.startsWith(SITE) ? link : SITE,
      date: new Date(tag(it, "pubDate")).toISOString(),
      teaser: text(tag(it, "description")).slice(0, 220),
      image: await ogImage(link),
    };
  }));
}

Deno.serve(async (req) => {
  const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=1800" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: { ...headers, "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" } });
  try {
    if (!cache || Date.now() - cache.at > 30 * 60e3) cache = { at: Date.now(), data: await load() };
    return new Response(JSON.stringify(cache.data), { headers });
  } catch (e) {
    console.error(e);
    if (cache) return new Response(JSON.stringify(cache.data), { headers });
    return new Response(JSON.stringify({ error: "Die Homepage ist gerade nicht erreichbar." }), { status: 502, headers });
  }
});
