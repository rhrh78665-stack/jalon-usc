const version = new URL(self.location.href).searchParams.get('v') || 'rf39'
const cacheName = 'jalon-shell-' + version
const baseFiles = ['/', '/manifest.webmanifest', '/jalon-logo.webp', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const response = await fetch('/', { cache: 'reload' })
    if (!response.ok) throw new Error('No se pudo cargar la aplicación.')
    const html = await response.clone().text()
    const assets = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)].map(match => match[1])
    const cache = await caches.open(cacheName)
    await cache.addAll([...baseFiles.slice(1), ...new Set(assets)])
    await cache.put('/', response)
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter(key => key.startsWith('jalon-shell-') && key !== cacheName).map(key => caches.delete(key)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request).catch(() => Response.json({
      message: 'Sin conexión. Conéctate para consultar o guardar cambios.',
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } })))
    return
  }
  if (request.method !== 'GET') return
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(cacheName)
      return (await cache.match('/')) || new Response('Conéctate para abrir Jalón USC.', { status: 503 })
    }))
    return
  }
  if (url.pathname.startsWith('/assets/') || baseFiles.includes(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(cacheName)
      return (await cache.match(request)) || fetch(request)
    })())
  }
})
