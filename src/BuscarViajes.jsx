import React, { useEffect, useRef, useState } from 'react'
import { paradas } from '../shared/paradas.js'
import Itinerario, { api, nombreParada, horaLocal, pesos, fechaFormulario } from './Itinerario.jsx'

export default function BuscarViajes() {
  const [result, setResult] = useState(null)
  const [detail, setDetail] = useState(null)
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const [requesting, setRequesting] = useState(false)
  const [notice, setNotice] = useState(null)
  const searchRequest = useRef(null)
  const detailRequest = useRef(null)
  const lastQuery = useRef(null)

  async function buscar(query) {
    lastQuery.current = query
    setNotice(null)
    searchRequest.current?.abort()
    detailRequest.current?.abort()
    const controller = new AbortController()
    searchRequest.current = controller
    setBusy(true)
    setDetail(null)
    setMessage(null)
    try {
      const data = await api('/api/trips/search?' + new URLSearchParams(query), { signal: controller.signal })
      if (!controller.signal.aborted) setResult({ ...data, query })
    } catch (error) {
      if (!controller.signal.aborted) {
        setResult(null)
        setMessage(error.message)
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }

  useEffect(() => {
    const refresh = () => { if (lastQuery.current) buscar(lastQuery.current) }
    window.addEventListener('jalon-trips-update', refresh)
    return () => {
      window.removeEventListener('jalon-trips-update', refresh)
      searchRequest.current?.abort()
      detailRequest.current?.abort()
    }
  }, [])

  async function consultar(id) {
    detailRequest.current?.abort()
    const controller = new AbortController()
    detailRequest.current = controller
    setMessage(null)
    setDetail(null)
    try {
      const query = new URLSearchParams({ origin: result.query.origin, destination: result.query.destination })
      const data = await api(`/api/trips/${encodeURIComponent(id)}?${query}`, { signal: controller.signal })
      if (!controller.signal.aborted) setDetail(data)
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error.message)
    }
  }

  async function solicitar() {
    const { origin, destination } = result.query
    setRequesting(true)
    setMessage(null)
    try {
      await api(`/api/trips/${encodeURIComponent(detail.id)}/reservations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin, destination }),
      })
      setDetail(null)
      setNotice('Solicitud enviada. Quedó pendiente de confirmación.')
      window.dispatchEvent(new Event('jalon-reservas-update'))
    } catch (error) {
      setMessage(error.message)
    } finally {
      setRequesting(false)
    }
  }

  return (
    <section aria-labelledby="search-heading">
      <h2 id="search-heading">Buscar viajes</h2>
      <p className="demo-note">Demostración: las distancias y los parámetros de combustible son datos de prueba.</p>
      <form onSubmit={event => {
        event.preventDefault()
        buscar({ ...Object.fromEntries(new FormData(event.currentTarget)), page: '1', pageSize: '5' })
      }} aria-busy={busy}>
        <label htmlFor="search-origin">Parada de subida</label>
        <select id="search-origin" name="origin" defaultValue="" required>
          <option value="">Selecciona una parada</option>
          {paradas.map(stop => <option key={stop.id} value={stop.id}>{stop.nombre}</option>)}
        </select>
        <label htmlFor="search-destination">Parada de bajada</label>
        <select id="search-destination" name="destination" defaultValue="usc" required>
          {paradas.map(stop => <option key={stop.id} value={stop.id}>{stop.nombre}</option>)}
        </select>
        <label htmlFor="search-date">Fecha (hora de Cali)</label>
        <input id="search-date" type="date" name="date" defaultValue={fechaFormulario(new Date()).slice(0, 10)} required />
        <label htmlFor="search-time">Hora de llegada o disponibilidad (opcional)</label>
        <input id="search-time" type="time" name="time" aria-describedby="search-time-help" />
        <small id="search-time-help">Hacia la USC: llegar hasta 40 minutos antes de tu hora límite. Desde la USC: recoger desde tu hora disponible hasta 40 minutos después.</small>
        <button disabled={busy}>{busy ? 'Buscando…' : 'Buscar viajes'}</button>
      </form>
      {notice && <p role="status">{notice}</p>}
      {message && <p className="notice error" role="alert">{message}</p>}
      {result && (
        <div aria-live="polite" aria-busy={busy}>
          <p>{result.total ? `${result.total} viajes disponibles para tu recorrido.` : 'No hay viajes compatibles con esta búsqueda.'}</p>
          <ul className="trip-list" aria-label="Resultados de viajes">
            {result.items.map(trip => (
              <li key={trip.id}>
                <strong>{nombreParada[result.query.origin]} → {nombreParada[result.query.destination]}</strong>
                <p>Subida: {horaLocal.format(new Date(trip.boardAt))}<br />Bajada: {horaLocal.format(new Date(trip.alightAt))}</p>
                <p>{trip.availableSeats} cupos en todo tu recorrido</p>
                <button type="button" disabled={busy} onClick={() => consultar(trip.id)}>Ver detalle y aporte</button>
              </li>
            ))}
          </ul>
          {result.total > result.pageSize && (
            <nav aria-label="Páginas de viajes" className="actions">
              <button type="button" disabled={busy || result.page <= 1}
                onClick={() => buscar({ ...result.query, page: String(result.page - 1) })}>Anterior</button>
              <span>Página {result.page} de {Math.ceil(result.total / result.pageSize)}</span>
              <button type="button" disabled={busy || result.page * result.pageSize >= result.total}
                onClick={() => buscar({ ...result.query, page: String(result.page + 1) })}>Siguiente</button>
            </nav>
          )}
        </div>
      )}
      {detail && (
        <section className="trip-detail" aria-labelledby="detail-heading">
          <h3 id="detail-heading">Detalle del viaje</h3>
          <Itinerario trip={detail} />
          <p><strong>Aporte estimado: {pesos.format(detail.estimatedCop)}</strong><br />Máximo de tu recorrido: {pesos.format(detail.maximumCop)}</p>
          <p>El estimado considera la ocupación actual. El máximo se calcula con el conductor y un pasajero por tramo.</p>
          <ul>
            {detail.segments.map(segment => <li key={segment.from}>
              {nombreParada[segment.from]} → {nombreParada[segment.to]}: {segment.distanceKm} km · estimado {pesos.format(segment.estimatedCop)} · máximo {pesos.format(segment.maximumCop)}
            </li>)}
          </ul>
          <button type="button" disabled={requesting} onClick={solicitar}>Solicitar asiento</button>
          <button type="button" className="secondary" onClick={() => setDetail(null)}>Cerrar detalle</button>
        </section>
      )}
    </section>
  )
}
