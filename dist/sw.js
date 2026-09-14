self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  return self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Dummy fetch event to satisfy PWA install requirements on Android/Chrome
});
// Update cache version 2
// Update cache version 3
// Update cache version 4 (Perfect Centering)
// Update cache version 5 (Trimmed Opaque PNG)
// Update cache version 6 (Scaled up Logo)
