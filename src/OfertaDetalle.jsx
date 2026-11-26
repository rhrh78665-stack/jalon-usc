import React, { useEffect, useRef, useState } from 'react'
import VehicleSummary from './VehicleSummary.jsx'
import MapaParadas from './MapaParadas.jsx'
import Reputacion from './Reputacion.jsx'
import { api, pesos } from './Itinerario.jsx'
import { itineraryPoints, pointName } from '../shared/route-points.js'

const time = new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' })
export default function OfertaDetalle({ trip, requesting, onClose, onRequest }) {
  const dialog = useRef(null)
  const [origin, setOrigin] = useState(trip.origin)
  const [destination, setDestination] = useState(trip.destination)
  const [quote, setQuote] = useState(trip)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  useEffect(() => { const element = dialog.current; element.showModal(); return () => element.close() }, [])
  useEffect(() => { const refresh = () => setRevision(value => value + 1); window.addEventListener('jalon-trips-update', refresh); return () => window.removeEventListener('jalon-trips-update', refresh) }, [])
  useEffect(() => {
    if (revision === 0 && origin === trip.origin && destination === trip.destination) { setQuote(trip); setLoading(false); setError(''); return }
    const controller = new AbortController()
    setLoading(true); setQuote(null); setError('')
    api('/api/trips/' + encodeURIComponent(trip.id) + '?' + new URLSearchParams({ origin, destination }), { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setQuote(value) })
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [origin, destination, trip, revision])
  return <dialog ref={dialog} className="offer-dialog" aria-labelledby="offer-detail-title" onCancel={event => { event.preventDefault(); if (!requesting) onClose() }} onClick={event => { if (event.target === dialog.current && !requesting) onClose() }}>
    <div className="offer-dialog-content">
      <header className="offer-dialog-heading"><div><span className="card-eyebrow">Recorrido publicado</span><h3 id="offer-detail-title">Recorrido de {trip.driver?.name || 'tu conductor'}</h3></div><button type="button" className="secondary icon-button" aria-label="Cerrar detalle del viaje" disabled={requesting} onClick={onClose}>×</button></header>
      <div className="offer-dialog-grid"><div className="offer-dialog-trip"><VehicleSummary trip={trip} /><Reputacion tripId={trip.id} />
        <ol className="offer-stop-list" aria-label="Paradas del conductor">{trip.itinerary.map((stop, index) => <li key={stop.stopId} className={stop.stopId === origin || stop.stopId === destination ? 'chosen-stop' : ''}><span aria-hidden="true">{index + 1}</span><div><strong>{pointName(trip, stop.stopId)}</strong><small>{index === 0 ? 'Salida' : index === trip.itinerary.length - 1 ? 'Llegada' : 'Punto de encuentro'}</small></div><time dateTime={stop.estimatedAt}>{time.format(new Date(stop.estimatedAt))}</time></li>)}</ol>
      </div><div className="offer-dialog-map"><MapaParadas snapshot={trip.roadMap} selectedOrigin={origin} selectedDestination={destination} stops={trip.route} points={itineraryPoints(trip)} title="Este es el recorrido del conductor" /></div></div>
      <div className="seat-selection"><div><span className="card-eyebrow">Reserva dentro de esta ruta</span><h4>Elige tus paradas.</h4><p>La ruta permanece igual. Selecciona la subida y la bajada entre las paradas publicadas.</p></div><div className="seat-selection-inputs">
        <label>Subida en esta ruta<select value={origin} disabled={requesting} onChange={event => { const id = event.target.value; setOrigin(id); if (trip.route.indexOf(destination) <= trip.route.indexOf(id)) setDestination(trip.route.at(-1)) }}>{trip.route.slice(0,-1).map(id => <option key={id} value={id}>{pointName(trip,id)}</option>)}</select></label>
        <label>Bajada en esta ruta<select value={destination} disabled={requesting} onChange={event => setDestination(event.target.value)}>{trip.route.slice(trip.route.indexOf(origin)+1).map(id => <option key={id} value={id}>{pointName(trip,id)}</option>)}</select></label>
      </div></div>
      {error && <p className="notice error" role="alert">{error}</p>}
      <footer className="offer-booking-bar"><div><span>Por tu asiento</span><strong>{quote ? pesos.format(quote.maximumCop) : 'Consultando…'} <small>COP</small></strong><p>{quote ? `${quote.availableSeats} cupos disponibles en tu tramo` : 'Comprobando disponibilidad'}</p></div><button type="button" disabled={requesting || loading || !quote || !quote.availableSeats} onClick={async () => { setError(''); try { await onRequest({ ...trip, ...quote, origin, destination }) } catch (failure) { setError(failure.message) } }}>{requesting ? 'Enviando solicitud…' : 'Reservar asiento'} <span aria-hidden="true">↗</span></button></footer>
    </div>
  </dialog>
}
