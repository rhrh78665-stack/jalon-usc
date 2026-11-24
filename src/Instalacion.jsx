import React, { useEffect, useState } from 'react'

export function registerApp() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  const entry = document.querySelector('script[type="module"][src]')?.getAttribute('src') || 'rf39'
  navigator.serviceWorker.register('/sw.js?v=' + encodeURIComponent(entry), { updateViaCache: 'none' })
    .catch(() => {})
}

export default function Instalacion() {
  const [online, setOnline] = useState(navigator.onLine)
  const [prompt, setPrompt] = useState(null)
  const [installed, setInstalled] = useState(
    window.matchMedia('(display-mode: standalone)').matches || Boolean(navigator.standalone),
  )
  useEffect(() => {
    const connected = () => setOnline(true)
    const disconnected = () => setOnline(false)
    const available = event => { event.preventDefault(); setPrompt(event) }
    const complete = () => { setInstalled(true); setPrompt(null) }
    window.addEventListener('online', connected)
    window.addEventListener('offline', disconnected)
    window.addEventListener('beforeinstallprompt', available)
    window.addEventListener('appinstalled', complete)
    return () => {
      window.removeEventListener('online', connected)
      window.removeEventListener('offline', disconnected)
      window.removeEventListener('beforeinstallprompt', available)
      window.removeEventListener('appinstalled', complete)
    }
  }, [])

  async function install() {
    if (!prompt) return
    await prompt.prompt()
    await prompt.userChoice
    setPrompt(null)
  }

  return (
    <div className="install-status">
      {!online && <p className="notice error" role="status">Sin conexión. Conéctate para consultar o guardar cambios.</p>}
      {!installed && (prompt
        ? <button type="button" className="secondary" onClick={install}>Instalar Jalón USC</button>
        : <details><summary>Instalar en este dispositivo</summary>
          <p>Abre el menú del navegador y elige Instalar aplicación o Añadir a pantalla de inicio.
            En Safari usa Compartir y Añadir a pantalla de inicio.</p>
        </details>)}
    </div>
  )
}
