import React, { useEffect, useRef, useState } from 'react'
import { paradas } from '../shared/paradas.js'
import Itinerario, { api, nombreParada, horaLocal, pesos, fechaFormulario } from './Itinerario.jsx'

function fechaViajes(days = 0) {
  return fechaFormulario(new Date(Date.now() + days * 86400000)).slice(0, 10)
}

export default function BuscarViajes() {
  const [filters, setFilters] = useState(() => ({ origin: 'melendez', destination: 'usc', date: fechaViajes(), time: '', page: '1', pageSize: '5' }))
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
    buscar(lastQuery.current ?? filters)
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

  function cambiarFiltro(event) {
    const { name, value } = event.target
    setFilters(current => ({ ...current, [name]: value, page: '1' }))
  }

  function buscarSinHora(date) {
    const next = { ...result.query, date, time: '', page: '1' }
    setFilters(next)
    buscar(next)
  }

  return (
    <section aria-labelledby="search-heading">
      <header className="search-heading">
        <h2 id="search-heading">Buscar viajes</h2>
        <p>Encuentra un trayecto compartido hacia o desde el campus.</p>
      </header>
      <form className="search-form" onSubmit={event => {
        event.preventDefault()
        buscar(filters)
      }} aria-busy={busy}>
        <div><label htmlFor="search-origin">Parada de subida</label>
        <select id="search-origin" name="origin" value={filters.origin} onChange={cambiarFiltro} required>
          <option value="">Selecciona una parada</option>
          {paradas.map(stop => <option key={stop.id} value={stop.id}>{stop.nombre}</option>)}
        </select></div>
        <div><label htmlFor="search-destination">Parada de bajada</label>
        <select id="search-destination" name="destination" value={filters.destination} onChange={cambiarFiltro} required>
          {paradas.map(stop => <option key={stop.id} value={stop.id}>{stop.nombre}</option>)}
        </select></div>
        <div><label htmlFor="search-date">Fecha (hora de Cali)</label>
        <input id="search-date" type="date" name="date" value={filters.date} onChange={cambiarFiltro} required /></div>
        <div><label htmlFor="search-time">Hora de referencia (opcional)</label>
        <input id="search-time" type="time" name="time" value={filters.time} onChange={cambiarFiltro} aria-describedby="search-time-help" /></div>
        <small id="search-time-help">Hacia la USC, filtramos por llegada hasta 40 min antes. Desde la USC, por recogida hasta 40 min después.</small>
        <button disabled={busy}>{busy ? 'Buscando…' : 'Buscar viajes'}</button>
      </form>
      {notice && <p role="status">{notice}</p>}
      {message && <p className="notice error" role="alert">{message}</p>}
      {result && (
        <div aria-live="polite" aria-busy={busy}>
          {!result.total && !busy && (
            <div className="empty-results">
              <strong>No hay viajes compatibles</strong>
              <p>Cambia la fecha o amplía la búsqueda.</p>
              <div className="actions">
                {result.query.time && <button type="button" className="secondary" onClick={() => buscarSinHora(result.query.date)}>Buscar sin hora</button>}
                {result.query.date !== fechaViajes(1) && <button type="button" className="secondary" onClick={() => buscarSinHora(fechaViajes(1))}>Ver viajes de mañana</button>}
              </div>
            </div>
          )}
          {result.total > 0 && <p>{result.total === 1 ? '1 viaje disponible' : `${result.total} viajes disponibles`}</p>}
          <ul className="trip-list search-results" aria-label="Resultados de viajes">
            {result.items.map(trip => (
              <li key={trip.id}>
                <div className="result-route">
                  <div><strong>{nombreParada[result.query.origin]}</strong><time dateTime={trip.boardAt}>{horaLocal.format(new Date(trip.boardAt))}</time></div>
                  <div><strong>{nombreParada[result.query.destination]}</strong><time dateTime={trip.alightAt}>{horaLocal.format(new Date(trip.alightAt))}</time></div>
                </div>
                <div className="result-footer">
                  <p className="seat-count">{trip.availableSeats} {trip.availableSeats === 1 ? 'cupo disponible' : 'cupos disponibles'}</p>
                  <button type="button" className="secondary" disabled={busy} onClick={() => consultar(trip.id)}>Ver detalle y aporte</button>
                </div>
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
              {nombreParada[segment.from]} → {nombreParada[segment.to]}: estimado {pesos.format(segment.estimatedCop)} · máximo {pesos.format(segment.maximumCop)}
            </li>)}
          </ul>
          <button type="button" disabled={requesting} onClick={solicitar}>Solicitar asiento</button>
          <button type="button" className="secondary" onClick={() => setDetail(null)}>Cerrar detalle</button>
        </section>
      )}
    </section>
  )
}
