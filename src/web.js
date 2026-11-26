export async function retireOfflineShell() {
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations()
    await Promise.all(registrations.filter(registration => {
      const script = registration.active?.scriptURL || registration.waiting?.scriptURL || registration.installing?.scriptURL
      return script && new URL(script).origin === location.origin && new URL(script).pathname === '/sw.js'
    }).map(registration => registration.unregister()))
  }
  if ('caches' in window) {
    const keys = await caches.keys()
    await Promise.all(keys.filter(key => key.startsWith('jalon-shell-')).map(key => caches.delete(key)))
  }
}
