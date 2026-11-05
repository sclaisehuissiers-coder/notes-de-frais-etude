// Mise en cache de l'application pour un démarrage hors connexion
const VERSION = 'ndf-v3';
const FICHIERS = ['./', './index.html', './app.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // les envois vers Google ne passent pas par le cache
  e.respondWith(fetch(e.request).then((r) => {
    const copie = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copie)); return r;
  }).catch(() => caches.match(e.request)));
});
