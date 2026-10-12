// Guarda la app en el teléfono para que abra al instante y sin internet.
// Los datos no pasan por acá: van al repo privado por la API de GitHub.
const CACHE = "kimchi-v1";
const ARCHIVOS = ["./", "index.html", "app.css", "app.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Primero lo guardado (rápido); en segundo plano trae la versión nueva para la próxima vez.
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  const red = caches.open(CACHE).then(c => fetch(e.request).then(r => {
    if (r.ok) c.put(e.request, r.clone());
    return r;
  }));
  e.waitUntil(red.catch(() => {}));
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(g => g || red));
});
