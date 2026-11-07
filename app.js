import * as pdfjsLib from './pdfjs/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = './pdfjs/pdf.worker.min.mjs';

const DOCS_CACHE = 'docs';
const $ = id => document.getElementById(id);
const els = {
  welcome: $('welcome'), reader: $('reader'), pages: $('pages'), title: $('title'),
  btnDownload: $('btn-download'), btnBack: $('btn-back'), btnHome: $('btn-home'),
  progress: $('progress'), fill: $('bar-fill'), ptext: $('progress-text'),
  error: $('error'), iosHint: $('ios-hint'), updateBar: $('update-bar'), btnUpdate: $('btn-update')
};

let lib = null;           // contenuto di library.json
let history = [];         // pila dei documenti aperti: {path, page}
let renderToken = 0;

const baseName = p => p.split('?')[0].split('#')[0].split('/').pop().toLowerCase();
const findByName = name => lib.files.find(f => baseName(f.path) === name.toLowerCase());
const titleOf = path => (lib.files.find(f => f.path === path) || {}).title || baseName(path);

async function loadLibraryJson() {
  try {
    const r = await fetch('library.json?t=' + Date.now(), { cache: 'no-store' });
    if (r.ok) { const j = await r.json(); localStorage.setItem('libJson', JSON.stringify(j)); return j; }
  } catch (e) { /* offline */ }
  const saved = localStorage.getItem('libJson');
  return saved ? JSON.parse(saved) : null;
}

async function isInstalled() {
  if (!lib) return false;
  const cache = await caches.open(DOCS_CACHE);
  for (const f of lib.files) if (!(await cache.match(f.path))) return false;
  return true;
}

async function downloadAll(onlyChanged) {
  els.btnDownload.disabled = true;
  els.error.hidden = true;
  els.progress.hidden = false;
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) {}
  const cache = await caches.open(DOCS_CACHE);
  const total = lib.files.length;
  try {
    for (let i = 0; i < total; i++) {
      const f = lib.files[i];
      els.ptext.textContent = `Scarico ${f.title} (${i + 1}/${total})`;
      const r = await fetch(`${f.path}?v=${lib.version}`, { cache: 'reload' });
      if (!r.ok) throw new Error(`File non trovato: ${f.path}`);
      await cache.put(f.path, r);
      els.fill.style.width = Math.round(((i + 1) / total) * 100) + '%';
    }
    localStorage.setItem('libVersion', String(lib.version));
    startReader();
  } catch (e) {
    els.error.textContent = 'Download non riuscito. Controlla la connessione e riprova. (' + e.message + ')';
    els.error.hidden = false;
    els.btnDownload.disabled = false;
  }
}

function startReader() {
  els.welcome.hidden = true;
  els.reader.hidden = false;
  history = [];
  openDoc(lib.main);
}

function updateButtons() {
  els.btnBack.disabled = history.length < 2;
  els.btnHome.disabled = history.length === 1 && history[0].path === lib.main;
  els.title.textContent = history.length ? titleOf(history[history.length - 1].path) : '';
}

async function openDoc(path, page = 1, replaceTop = false) {
  if (replaceTop) history.pop();
  history.push({ path, page });
  updateButtons();
  await renderDoc(path, page);
}

async function goBack() {
  if (history.length < 2) return;
  history.pop();
  const cur = history[history.length - 1];
  updateButtons();
  await renderDoc(cur.path, cur.page);
}

async function goHome() {
  history = [];
  await openDoc(lib.main);
}

async function renderDoc(path, startPage) {
  const token = ++renderToken;
  els.pages.innerHTML = '';
  els.pages.scrollTop = 0;
  const cache = await caches.open(DOCS_CACHE);
  const resp = await cache.match(path);
  if (!resp) { els.pages.textContent = 'Documento non disponibile offline.'; return; }
  const data = new Uint8Array(await resp.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const width = els.pages.clientWidth;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let target = null;

  for (let n = 1; n <= pdf.numPages; n++) {
    if (token !== renderToken) return;
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = width / base.width;
    const vp = page.getViewport({ scale });

    const wrap = document.createElement('div');
    wrap.className = 'page';
    wrap.style.width = vp.width + 'px';
    wrap.style.height = vp.height + 'px';
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width * dpr);
    canvas.height = Math.floor(vp.height * dpr);
    wrap.appendChild(canvas);
    els.pages.appendChild(wrap);
    if (n === startPage) target = wrap;

    await page.render({
      canvasContext: canvas.getContext('2d'),
      viewport: page.getViewport({ scale: scale * dpr })
    }).promise;

    let found = 0;
    const links = [];
    try {
      const annots = await page.getAnnotations();
      for (const an of annots) {
        if (an.subtype !== 'Link') continue;
        const href = an.unsafeUrl || an.url;
        let handler = null;
        if (href) handler = () => followLink(href);
        else if (an.dest) handler = () => followDest(pdf, an.dest, path);
        if (!handler) continue;
        const [x1, y1, x2, y2] = vp.convertToViewportRectangle(an.rect);
        links.push({ l: Math.min(x1, x2), t: Math.min(y1, y2), r: Math.max(x1, x2), b: Math.max(y1, y2), handler });
        found++;
      }
    } catch (e) { alert('Errore lettura link: ' + e.message); }
    wrap.addEventListener('click', ev => {
      const box = wrap.getBoundingClientRect();
      const x = ev.clientX - box.left, y = ev.clientY - box.top;
      const hit = links.find(k => x >= k.l && x <= k.r && y >= k.t && y <= k.b);
      if (hit) hit.handler();
    });
    if (n === 1) els.title.textContent = titleOf(path) + ' (link: ' + found + ')';
  }
  if (target && startPage > 1) els.pages.scrollTop = target.offsetTop - 8;
}

function followLink(href) {
  let name = baseName(href);
  if (!findByName(name)) {
    try { name = new URL(href, location.href).hostname; } catch (e) {}
  }
  const file = findByName(name);
  if (file) {
    const m = /[#&]page=(\d+)/i.exec(href);
    openDoc(file.path, m ? parseInt(m[1], 10) : 1);
    return;
  }
  if (/^(https?:|mailto:|tel:)/i.test(href)) { window.open(href, '_blank', 'noopener'); return; }
  alert('Link non riconosciuto: ' + href);
}

// collegamenti interni allo stesso PDF (destinazioni)
async function followDest(pdf, dest, path) {
  try {
    const d = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
    const idx = await pdf.getPageIndex(d[0]);
    const top = history[history.length - 1];
    top.page = idx + 1;
    const wraps = els.pages.querySelectorAll('.page');
    if (wraps[idx]) els.pages.scrollTop = wraps[idx].offsetTop - 8;
  } catch (e) {}
}

async function checkUpdate() {
  if (!navigator.onLine) return;
  try {
    const r = await fetch('library.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return;
    const remote = await r.json();
    if (String(remote.version) !== localStorage.getItem('libVersion')) {
      lib = remote;
      localStorage.setItem('libJson', JSON.stringify(remote));
      els.updateBar.hidden = false;
    }
  } catch (e) {}
}

async function init() {
  els.btnBack.onclick = goBack;
  els.btnHome.onclick = goHome;
  els.btnDownload.onclick = () => downloadAll();
  els.btnUpdate.onclick = async () => {
    els.updateBar.hidden = true;
    els.reader.hidden = true; els.welcome.hidden = false;
    $('welcome-text').textContent = 'Aggiornamento della libreria in corso...';
    await downloadAll();
  };

  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register('sw.js'); } catch (e) { console.warn(e); }
  }

  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua);
  const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  if (isIOS && !standalone) els.iosHint.hidden = false;

  lib = await loadLibraryJson();
  if (!lib) {
    els.error.textContent = 'Impossibile caricare la libreria. Connettiti a Internet per il primo accesso.';
    els.error.hidden = false; els.btnDownload.disabled = true;
    return;
  }
  if (await isInstalled()) {
    startReader();
    checkUpdate();
  }
}
init();
