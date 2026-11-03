// Service Worker der Speckbacher-App: zeigt Push-Erinnerungen an und öffnet die App beim Antippen.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || "Speckbacher", {
    body: data.body || "",
    icon: "icon-192.png",
    badge: "icon-192.png",
    data: { url: data.url || "./" },
    lang: "de"
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "./", self.registration.scope).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) { if (c.url.startsWith(self.registration.scope)) { await c.focus(); return; } }
    await self.clients.openWindow(url);
  })());
});
