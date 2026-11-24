import React, { useEffect, useState } from 'react'
import { api, horaLocal } from './Itinerario.jsx'

export default function Avisos() {
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    api('/api/notifications', { signal: controller.signal }).then(setItems)
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message) })
    return () => controller.abort()
  }, [])
  return (
    <section aria-label="Entrega de avisos por correo">
      <h3>Avisos por correo</h3>
      <p>Actívalos en tu perfil y verifica tu correo para recibir cambios de tus reservas y viajes.</p>
      {error && <p role="alert">{error}</p>}
      {!items.length && <p>Aún no hay avisos registrados.</p>}
      <ul>{items.map(item => <li key={item.eventKey}>
        {item.subject} · {item.status} · {horaLocal.format(new Date(item.createdAt))}
      </li>)}</ul>
    </section>
  )
}
