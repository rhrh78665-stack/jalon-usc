import React, { useEffect, useRef, useState } from 'react'
import { paradas } from '../shared/paradas.js'
import { api, nombreParada, horaLocal, fechaFormulario } from './Itinerario.jsx'

export default function BuscarViajes() {
  const [result, setResult] = useState(null)
  const [message, setMessage] = useState(null)
  const [busy, setBusy] = useState(false)
  const searchRequest = useRef(null)
  const lastQuery = useRef(null)

  async function buscar(query) {
    lastQuery.current = query
    searchRequest.current?.abort()
    const controller = new AbortController()
    searchRequest.current = controller
    setBusy(true)
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
    }
  }, [])

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

    </section>
  )
}
