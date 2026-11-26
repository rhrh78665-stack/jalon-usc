import React, { useEffect, useState } from 'react'
import { api, horaLocal, nombreParada, pesos } from './Itinerario.jsx'
import { pointName } from '../shared/route-points.js'
import VehicleSummary from './VehicleSummary.jsx'

export default function Historial({initialFilter='',navigationId,role='pasajero'}) {
  const driver=role==='conductor'
  const [filter, setFilter] = useState(initialFilter)
  useEffect(()=>{setFilter(initialFilter);setPage(1)},[initialFilter,navigationId])
  const [page, setPage] = useState(1)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let controller
    async function load() {
      controller?.abort()
      const current = new AbortController(); controller = current
      setLoading(true); setError('')
      try {
        const data = await api('/api/journeys/history?' + new URLSearchParams({ status: filter, page }), { signal: current.signal })
        if (!current.signal.aborted) setResult(data)
      } catch (failure) { if (!current.signal.aborted) setError(failure.message) }
      finally { if (!current.signal.aborted) setLoading(false) }
    }
    load()
    window.addEventListener('jalon-trips-update', load)
    window.addEventListener('jalon-reservas-update', load)
    return () => { controller?.abort(); window.removeEventListener('jalon-trips-update', load); window.removeEventListener('jalon-reservas-update', load) }
  }, [filter, page])
  return <section aria-labelledby="history-heading">
    <header className="page-heading"><div><span className="card-eyebrow">{driver?'Las carreras que ofreciste':'Tus recorridos'}</span><h2 id="history-heading">{driver?'Historial de carreras':'Historial de viajes'}</h2>
      <p>{driver?'Consulta las carreras que condujiste, sus estados y el total liquidado.':'Cada recorrido tiene su historia. Consulta tus viajes anteriores, su estado y el valor final.'}</p></div></header>
    <div className="history-filters" aria-label="Filtrar historial">{[['', 'Todos'], ['Completado', 'Finalizados'], ['Cancelado', 'Cancelados']].map(([value, label]) =>
      <button type="button" key={value} aria-pressed={filter === value} className="secondary" onClick={() => { setFilter(value); setPage(1) }}>{label}</button>)}</div>
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">Cargando tus viajes…</p>}
    {result && !loading && !result.total && <p className="empty-results">Todavía no tienes viajes en este filtro. Aquí aparecerán cuando terminen o se cancelen.</p>}
    <ul className="history-list" aria-live="polite" aria-busy={loading}>
      {result?.items.map(trip => <li key={trip.entryId} data-history-trip-id={trip.id}>
        <VehicleSummary trip={trip} showDriver={!driver} />
        <div className="history-record">
          <div className="history-record-top"><span className="card-eyebrow">{trip.asDriver ? 'Carrera ofrecida' : 'Como pasajero'}</span><span className="booking-status" data-status={trip.status}>{trip.status === 'Completado' ? 'Finalizado' : trip.status === 'EnCurso' ? 'En curso' : trip.status}</span></div>
          <h3>{pointName(trip, trip.origin)} <span aria-hidden="true">→</span> {pointName(trip, trip.destination)}</h3>
          <time dateTime={trip.departAt}>{horaLocal.format(new Date(trip.departAt))}</time>
          {trip.reservationStatus && <p>Reserva: {trip.reservationStatus}</p>}
          {trip.cancelReason && <p>Motivo: {trip.cancelReason}</p>}
          {trip.settledCop != null ? <p className="history-value">{trip.asDriver ? 'Total liquidado' : 'Valor final'} <strong>{pesos.format(trip.settledCop)}</strong></p>
            : trip.maximumCop != null && <p>Valor reservado: {pesos.format(trip.maximumCop)}</p>}
        </div>
      </li>)}
    </ul>
    {result?.total > result?.pageSize && <nav className="actions" aria-label="Páginas de historial">
      <button type="button" className="secondary" disabled={loading || page === 1} onClick={() => setPage(page - 1)}>Anterior</button>
      <span>Página {page} de {Math.ceil(result.total/result.pageSize)}</span>
      <button type="button" className="secondary" disabled={loading || page * result.pageSize >= result.total} onClick={() => setPage(page + 1)}>Siguiente</button>
    </nav>}
  </section>
}
