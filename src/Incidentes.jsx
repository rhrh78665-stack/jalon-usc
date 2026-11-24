import React, { useEffect, useState } from 'react'
import { api, nombreParada, horaLocal } from './Itinerario.jsx'

export default function Incidentes({ mobility }) {
  const [trips, setTrips] = useState([])
  const [items, setItems] = useState([])
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    setError('')
    Promise.all([
      api('/api/incidents', { signal: controller.signal }),
      mobility ? Promise.resolve([]) : api('/api/incidents/trips', { signal: controller.signal }),
    ]).then(([reports, available]) => {
      if (!controller.signal.aborted) { setItems(reports); setTrips(available) }
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message) })
      return () => controller.abort()
  }, [mobility, revision])

  async function report(event) {
    event.preventDefault()
    const form = event.currentTarget
    const body = Object.fromEntries(new FormData(form))
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await api('/api/incidents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      form.reset()
      setRevision(value => value + 1)
      setNotice('Reporte recibido por Movilidad.')
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }


  async function resolve(event, id) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api('/api/incidents/' + encodeURIComponent(id) + '/resolve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
      })
      setRevision(value => value + 1)
      setNotice('Decisión registrada.')
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }

  return (
    <section aria-labelledby="incidents-title">
      <h2 id="incidents-title">{mobility ? 'Bandeja de incidentes' : 'Mis incidentes'}</h2>
      <p>Los reportes son privados y los revisa Movilidad.</p>
      {error && <p className="notice error" role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!mobility && trips.length > 0 && (
        <form onSubmit={report}>
          <label htmlFor="incident-trip">Viaje</label>
          <select id="incident-trip" name="tripId" defaultValue="" required>
            <option value="" disabled>Selecciona un viaje en el que participas</option>
            {trips.map(trip => <option key={trip.id} value={trip.id}>
              {trip.route.map(id => nombreParada[id]).join(' → ')} · {horaLocal.format(new Date(trip.departAt))}
            </option>)}
          </select>
          <label htmlFor="incident-category">Categoría</label>
          <select id="incident-category" name="category" required>
            <option value="seguridad">Seguridad</option><option value="conducta">Conducta</option>
            <option value="vehiculo">Vehículo</option><option value="otro">Otro</option>
          </select>
          <label htmlFor="incident-description">Descripción</label>
          <textarea id="incident-description" name="description" minLength={10} maxLength={2000} required />
          <button disabled={busy}>Enviar reporte</button>
        </form>
      )}
      {!mobility && !trips.length && <p>Podrás reportar un viaje propio o con una reserva confirmada.</p>}
      {!items.length && <p>No hay reportes en esta bandeja.</p>}
      <ul className="trip-list">{items.map(item => (
        <li key={item.id}>
          <strong>{item.route.map(id => nombreParada[id]).join(' → ')}</strong>
          <p>{item.category} · {item.status}</p>
          {item.resolution && <p>Decisión: {item.decision}. {item.resolution} · {item.reviewer || 'Movilidad'} · {horaLocal.format(new Date(item.resolvedAt))}</p>}
          {mobility && item.status === 'Recibido' && (
            <form onSubmit={event => resolve(event, item.id)}>
              <label>Decisión<select name="decision" required>
                <option value="atendido">Atendido</option><option value="descartado">Descartado</option>
              </select></label>
              <label>Motivo de resolución<textarea name="resolution" minLength={10} maxLength={2000} required /></label>
              <button disabled={busy}>Resolver reporte</button>
            </form>
          )}
          <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.description}</p>
        </li>
      ))}</ul>
    </section>
  )
}
