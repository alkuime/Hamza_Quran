// عامل الخدمة لمصحف التجويد التفاعلي — العمل دون إنترنت (v79)
const SHELL = 'quran-shell-v107', DATA = 'quran-data-v1', AUDIO = 'quran-audio-v1', CDN = 'quran-cdn-v1', API = 'quran-api-v1';
const SHELL_FILES = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
const CDN_HOSTS = ['cdn.tailwindcss.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net'];
const AUDIO_HOSTS = ['audio.qurancdn.com', 'verses.quran.com', 'download.quranicaudio.com', 'everyayah.com', 'mirrors.quranicaudio.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => Promise.all(SHELL_FILES.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  const keep = [SHELL, DATA, AUDIO, CDN, API];
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => !keep.includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

async function fromAnyCache(req) { return caches.match(req, { ignoreSearch: false }); }

// الصوت المخزّن يُخدم مع دعم طلبات الأجزاء (Range) التي يستعملها مشغل الصوت
async function rangeResponse(req, cached) {
  const range = req.headers.get('range');
  if (!range || cached.type === 'opaque') return cached;
  const buf = await cached.arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
  const start = m[1] ? +m[1] : 0, end = m[2] ? Math.min(+m[2], buf.byteLength - 1) : buf.byteLength - 1;
  return new Response(buf.slice(start, end + 1), { status: 206, statusText: 'Partial Content', headers: {
    'Content-Range': `bytes ${start}-${end}/${buf.byteLength}`, 'Content-Length': String(end - start + 1),
    'Content-Type': cached.headers.get('Content-Type') || 'audio/mpeg', 'Accept-Ranges': 'bytes' } });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // الصوت: من المخزن إن وُجد، وإلا من الشبكة
  if (AUDIO_HOSTS.includes(url.hostname)) {
    e.respondWith((async () => {
      const c = await caches.open(AUDIO);
      const hit = await c.match(url.href);
      if (hit) return rangeResponse(req, hit);
      return fetch(req);
    })());
    return;
  }
  // واجهة بيانات الصوت (api.quran.com): الشبكة أولاً ثم المخزن
  if (url.hostname === 'api.quran.com') {
    e.respondWith((async () => {
      const c = await caches.open(API);
      try { const r = await fetch(req); if (r.ok) c.put(req, r.clone()); return r; }
      catch (err) { const hit = await c.match(req); if (hit) return hit; throw err; }
    })());
    return;
  }
  // المكتبات والخطوط الخارجية: من المخزن ثم تحديثه في الخلفية
  if (CDN_HOSTS.includes(url.hostname)) {
    e.respondWith((async () => {
      const c = await caches.open(CDN);
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()); return r; }).catch(() => null);
      return hit || (await net) || Response.error();
    })());
    return;
  }
  if (url.origin !== location.origin) return;

  // صفحة التطبيق: الشبكة أولاً (لتصل التحديثات) ثم المخزن
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try { const r = await fetch(req); const c = await caches.open(SHELL); c.put('index.html', r.clone()); return r; }
      catch (err) { return (await fromAnyCache(req)) || (await caches.match('index.html')) || (await caches.match('./')); }
    })());
    return;
  }
  // البيانات وخطوط الصفحات: من المخزن أولاً، ثم الشبكة مع التخزين
  e.respondWith((async () => {
    const hit = await fromAnyCache(req);
    if (hit) return hit;
    try {
      const r = await fetch(req);
      if (r.ok && (/\/Aya_Jason\/|\/woff2\/|\/icons\//.test(url.pathname))) (await caches.open(DATA)).put(req, r.clone());
      return r;
    } catch (err) { return new Response('', { status: 504 }); }
  })());
});
