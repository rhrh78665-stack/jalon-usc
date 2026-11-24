import React, { useEffect, useState } from 'react'
import { api, horaLocal, nombreParada } from './Itinerario.jsx'

export default function Penalizaciones() {
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try { setResult(await api('/api/penalties', { signal: controller.signal })); setError('') }
      catch (failure) { if (!controller.signal.aborted) setError(failure.message) }
    }
    load()
    window.addEventListener('jalon-trips-update', load)
    return () => { controller.abort(); window.removeEventListener('jalon-trips-update', load) }
  }, [])
  return (
    <section aria-label="Advertencias y reservas">
      <h3>Advertencias y reservas</h3>
      <p>Una ausencia o una cancelación propia de una reserva confirmada con menos de 60 minutos
        de anticipación genera una advertencia. Tres advertencias en 30 días suspenden nuevas solicitudes durante siete días.</p>
      <p>Las cancelaciones del conductor no generan advertencias al pasajero.</p>
      {error && <p role="alert">{error}</p>}
      {result && <>
        <p>Advertencias en los últimos 30 días: <strong>{result.activeWarnings}</strong></p>
        {result.suspended && <p role="status">Nuevas solicitudes suspendidas hasta {horaLocal.format(new Date(result.suspendedUntil))}.</p>}
        {!result.suspended && <p>Sin suspensión vigente para nuevas solicitudes.</p>}
        <ul>{result.warnings.map(item => <li key={item.reservationId + item.reason}>
          {item.reason === 'ausencia' ? 'Ausencia' : 'Cancelación tardía'} · {item.route.map(id => nombreParada[id]).join(' → ')}
          {' · '}{horaLocal.format(new Date(item.createdAt))}{item.active ? '' : ' · fuera de la ventana de 30 días'}
        </li>)}</ul>
      </>}
    </section>
  )
}
