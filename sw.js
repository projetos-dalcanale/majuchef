// Service worker do MajuChef: deixa o app abrir sem internet.
// - Página (index.html): tenta a rede primeiro (sempre a versão mais nova) e cai no cache se estiver offline.
// - Arquivos estáticos, fontes, bibliotecas e fotos: respondem do cache na hora e atualizam em segundo plano.
// Os dados (Firestore) não passam por aqui: o próprio Firebase guarda uma cópia offline.

const SHELL_CACHE = 'majuchef-shell-v1';   // troque o número ao mudar a lista de arquivos abaixo
const RUNTIME_CACHE = 'majuchef-runtime-v1';
const PHOTO_CACHE = 'majuchef-photos-v1';
const MAX_PHOTOS = 150;
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png'];
const KEEP = [SHELL_CACHE, RUNTIME_CACHE, PHOTO_CACHE];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

const networkFirst = async (request) => {
    const cache = await caches.open(SHELL_CACHE);
    try {
        const response = await Promise.race([
            fetch(request),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000))
        ]);
        if (response && response.ok) cache.put('index.html', response.clone());
        return response;
    } catch (err) {
        return (await cache.match('index.html')) || (await cache.match('./')) || Response.error();
    }
};

const trim = async (cacheName, max) => {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
};

const staleWhileRevalidate = async (request, cacheName, limit) => {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    const update = fetch(request).then((response) => {
        if (response && (response.ok || response.type === 'opaque')) {
            cache.put(request, response.clone()).then(() => limit && trim(cacheName, limit));
        }
        return response;
    }).catch(() => null);
    return cached || (await update) || Response.error();
};

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);

    if (request.mode === 'navigate') {
        event.respondWith(networkFirst(request));
        return;
    }
    if (url.origin === self.location.origin) {
        if (/\.(png|webmanifest|svg|ico)$/.test(url.pathname)) event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
        return;
    }
    if (url.hostname === 'res.cloudinary.com') {
        event.respondWith(staleWhileRevalidate(request, PHOTO_CACHE, MAX_PHOTOS));
        return;
    }
    const cdn = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname)
        || (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/'));
    if (cdn) event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
});
