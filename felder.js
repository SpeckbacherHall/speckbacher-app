/* Speckbacher-App – Textfelder nach Material 3 („Outlined text field“, vgl. material-web text-field):
   Die Beschriftung steht im Feld und wandert beim Tippen bzw. mit Inhalt auf den Rahmen.
   Lange Zusätze in Klammern werden zum Hilfetext unter dem Feld. Wirkt auf jedes <label> mit einem
   Eingabefeld darin, auch auf später gezeichnete Ansichten (MutationObserver). Keine Abhängigkeiten. */
(function () {
  const FIXED = /^(date|time|month|week|datetime-local|color)$/;   // zeigen immer ein Format an → Beschriftung oben
  const skip = c => !c || (c.tagName === "INPUT" && /^(checkbox|radio|file|hidden|submit|button)$/.test(c.type));

  function upgrade(label) {
    if (label.classList.contains("tf") || label.classList.contains("check") || label.classList.contains("btn")) return;
    const control = label.querySelector(":scope > input, :scope > select, :scope > textarea");
    if (skip(control)) return;
    // alles vor dem Feld wird zur Beschriftung
    const before = [];
    for (const n of label.childNodes) { if (n === control) break; before.push(n); }
    const text = before.map(n => n.textContent).join("").replace(/\s+/g, " ").trim();
    if (!text) return;
    const span = document.createElement("span");
    span.className = "tf-label";
    before.forEach(n => span.append(n));
    // „Text (langer Zusatz)“ → Beschriftung „Text“, Zusatz als Hilfetext darunter
    const m = text.match(/^(.+?)\s*\((.+)\)$/);
    if (m && text.length > 30 && before.every(n => n.nodeType === Node.TEXT_NODE)) {
      span.textContent = m[1];
      const help = document.createElement("span");
      help.className = "tf-support";
      help.textContent = m[2].charAt(0).toUpperCase() + m[2].slice(1);
      control.after(help);
    }
    label.prepend(span);
    label.classList.add("tf");
    if (control.tagName === "SELECT" || FIXED.test(control.type)) label.classList.add("tf-fixed");
    if (control.required) label.classList.add("tf-required");
    if (control.tagName !== "SELECT" && !control.hasAttribute("placeholder")) control.setAttribute("placeholder", " ");
    sync(control);
  }
  const sync = c => c.parentElement?.classList.toggle("tf-filled", c.value !== "");

  function scan(root) { root.querySelectorAll?.("label").forEach(upgrade); }
  document.addEventListener("input", e => { if (e.target.parentElement?.classList.contains("tf")) sync(e.target); }, true);
  document.addEventListener("change", e => { if (e.target.parentElement?.classList.contains("tf")) sync(e.target); }, true);
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => { queued = false; scan(document.body); document.querySelectorAll(".tf > input, .tf > textarea").forEach(sync); });
  }).observe(document.body, { childList: true, subtree: true });
  scan(document.body);
})();
