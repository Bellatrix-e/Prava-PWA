const SHELL = 'shell-v3';
const SHELL_FILES = [
  './', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest',
  'pdfjs/pdf.min.mjs', 'pdfjs/pdf.worker.min.mjs',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== 'docs').map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // library.json: sempre dalla rete se possibile (serve a rilevare aggiornamenti)
  if (url.pathname.endsWith('library.json')) {
    e.respondWith(fetch(req).catch(() => caches.match('library.json', { ignoreSearch: true })));
    return;
  }
  // download dei documenti con ?v=...: vai in rete (la cache viene scritta da app.js)
  if (url.pathname.includes('/docs/') && url.search) return;

  e.respondWith(
    caches.match(req, { ignoreSearch: req.mode === 'navigate' }).then(hit => hit || fetch(req))
      .catch(() => caches.match('index.html'))
  );
});
