const CACHE_NAME = 'bytebeat-v1';
const FILES_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './processor.js',
  './codemirror.min.css',
  './monokai.min.css',
  './codemirror.min.js',
  './javascript.min.js',
  './favicon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(FILES_TO_CACHE);
      })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200) {
          const responseToCache = response.clone();
          
          caches.open(CACHE_NAME).then(cache => {
            cache.delete(event.request)
              .then(() => {
                cache.put(event.request, responseToCache);
              });
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});