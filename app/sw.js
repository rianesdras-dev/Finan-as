/* Financeiro — funciona sem internet. Arquivos do app: rede primeiro, cópia
   guardada se estiver offline. Fontes do Google: cópia guardada primeiro. */
const CACHE = 'financeiro-v5';
const CORE = ['./', 'index.html', 'extrato.js', 'conferencia.js', 'comprovantes.js', 'agenda.js', 'sincronia.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

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
  // Android: "Compartilhar › Financeiro" manda o comprovante para cá; guardo e abro o app
  if (r.method === 'POST' && new URL(r.url).pathname.endsWith('/compartilhar')) {
    e.respondWith((async () => {
      try {
        const form = await r.formData(), c = await caches.open('financeiro-compartilhado');
        let i = 0;
        for (const f of form.getAll('arquivo')) {
          if (!f || typeof f === 'string') continue;
          await c.put('./compartilhado/' + Date.now() + '-' + (i++), new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-Nome': encodeURIComponent(f.name || 'comprovante') } }));
        }
      } catch (_) {}
      return Response.redirect('./?compartilhado=1', 303);
    })());
    return;
  }
  if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.pathname.includes('/api/')) return;   // a sincronização vai sempre à rede
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
