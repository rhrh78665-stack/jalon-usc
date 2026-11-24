import React, { useEffect, useState } from 'react'
import MapaParadas from './MapaParadas.jsx'
import { paradas } from '../shared/paradas.js'

export const nombreParada = Object.fromEntries(paradas.map(({ id, nombre }) => [id, nombre]))
export const horaLocal = new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota',
})
export const pesos = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
export const fechaFormulario = value => new Date(new Date(value).getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 16)

export async function api(url, options) {
  if (options?.method && options.method !== 'GET' && !navigator.onLine) {
    throw new Error('Sin conexión. Conéctate para consultar o guardar cambios.')
  }
  const response = await fetch(url, options)
  const result = await response.json()
  if (!response.ok) throw new Error(result.message || 'No se pudo completar la solicitud.')
  return result
}

export default function Itinerario({ trip }) {
  if (!trip.itinerary?.length) {
    return <p>{trip.route.map(id => nombreParada[id] ?? id).join(' → ')}. Edita el viaje para completar sus horarios.</p>
  }
  const total = trip.itinerary.reduce((sum, stop) => sum + (stop.costToNextCop ?? 0), 0)
  return (
    <>
      <MapaParadas stops={trip.itinerary.map(stop => stop.stopId)} />
      <ol className="itinerary" aria-label="Itinerario del viaje">
        {trip.itinerary.map(stop => (
          <li key={stop.stopId}>
            <strong>{nombreParada[stop.stopId]}</strong> · {horaLocal.format(new Date(stop.estimatedAt))}
            {stop.distanceToNextKm !== null && (
              <small>Costo del tramo {pesos.format(stop.costToNextCop)}</small>
            )}
          </li>
        ))}
      </ol>
      <p>Costo de operación del viaje: {pesos.format(total)}</p>
    </>
  )
}

export function AvisosViajes() {
  const [notice, setNotice] = useState('')
  useEffect(() => {
    let events
    let fallback = null
    const refresh = event => window.dispatchEvent(new CustomEvent('jalon-trips-update', {
      detail: event?.data ? JSON.parse(event.data) : null,
    }))
    const refreshAll = () => {
      if (!navigator.onLine) return
      window.dispatchEvent(new CustomEvent('jalon-trips-update', { detail: { source: 'recovery' } }))
      window.dispatchEvent(new CustomEvent('jalon-reservas-update', { detail: { source: 'recovery' } }))
    }
    const startFallback = () => {
      if (!fallback) fallback = setInterval(refreshAll, 3000)
    }
    const connect = () => {
      events?.close()
      events = new EventSource('/api/trips/events')
      events.addEventListener('error', startFallback)
      events.addEventListener('ready', () => {
        clearInterval(fallback)
        fallback = null
        refreshAll()
      })
      events.addEventListener('reservation-changed', event => {
        const { status } = JSON.parse(event.data)
        if (['Confirmada', 'Cancelada'].includes(status)) refresh(event)
        else window.dispatchEvent(new CustomEvent('jalon-reservas-update', { detail: JSON.parse(event.data) }))
      })
      events.addEventListener('trip-state-changed', refresh)
      events.addEventListener('trip-cancelled', event => {
        const change = JSON.parse(event.data)
        setNotice('Se canceló un viaje en el que participas. Motivo: ' + change.reason)
        refresh(event)
      })
    }
    const online = () => { startFallback(); refreshAll(); connect() }
    const offline = () => { events?.close(); startFallback() }
    const visible = () => { if (!document.hidden) refreshAll() }
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    document.addEventListener('visibilitychange', visible)
    connect()
    return () => {
      clearInterval(fallback)
      events?.close()
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [])
  return notice && <p className="notice" role="status">{notice}</p>
}
