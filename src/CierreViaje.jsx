import React, { useEffect, useState } from 'react'
import { api, pesos } from './Itinerario.jsx'

export default function CierreViaje({ trip }) {
  const [cierre, setCierre] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const visible = ['EnCurso', 'Completado'].includes(trip.status)
  const url = `/api/trips/${encodeURIComponent(trip.id)}`

  useEffect(() => {
    if (!visible) return
    const controller = new AbortController()
    api(url + '/cierre', { signal: controller.signal })
      .then(setCierre)
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message) })
    return () => controller.abort()
  }, [url, visible, trip.status])

  async function cambiar(action, asistencia) {
    setBusy(true)
    setError('')
    try {
      await api(url + '/' + action, {
        method: 'POST',
        ...(asistencia && { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ asistencia }) }),
      })
      window.dispatchEvent(new Event('jalon-trips-update'))
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      {error && <p role="alert">{error}</p>}
      {['Programado', 'Lleno'].includes(trip.status) && (
        <button type="button" disabled={busy} onClick={() => cambiar('start')}>Iniciar viaje</button>
      )}
      {trip.status === 'EnCurso' && cierre && (
        <form onSubmit={event => {
          event.preventDefault()
          const data = new FormData(event.currentTarget)
          cambiar('finish', cierre.reservas.map(r => ({ id: r.id, attendance: data.get(r.id) })))
        }}>
          {cierre.reservas.map(r => (
            <label key={r.id}>
              Asistencia de {r.alias}
              <select name={r.id} defaultValue={r.attendance ?? ''} required>
                <option value="">Selecciona asistencia</option>
                <option value="Abordo">Abordó</option>
                <option value="Ausente">No se presentó</option>
              </select>
            </label>
          ))}
          <button disabled={busy}>Finalizar y liquidar</button>
        </form>
      )}
      {trip.status === 'Completado' && cierre?.liquidation && (
        <p>Costo total: {pesos.format(cierre.liquidation.totalCop)} · Aporte conductor: {pesos.format(cierre.liquidation.conductorCop)}</p>
      )}
    </div>
  )
}
