/* Financeiro — funciona sem internet. Arquivos do app: rede primeiro, cópia
   guardada se estiver offline. Fontes do Google: cópia guardada primeiro. */
const CACHE = 'financeiro-v3';
const CORE = ['./', 'index.html', 'extrato.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(CORE.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  const fonte = u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com';
  if (u.origin !== location.origin && !fonte) return;
  const guarda = res => { if (res && (res.ok || res.type === 'opaque')) { const cp = res.clone(); caches.open(CACHE).then(c => c.put(r, cp)); } return res; };
  if (fonte) {
    e.respondWith(caches.match(r).then(m => m || fetch(r).then(guarda)));
    return;
  }
  e.respondWith(fetch(r).then(guarda).catch(() =>
    caches.match(r, { ignoreSearch: true })
      .then(m => m || (r.mode === 'navigate' ? caches.match('index.html') : null))
      .then(m => m || Response.error())));
});
