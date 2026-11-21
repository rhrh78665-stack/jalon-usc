import React, { useEffect, useState } from 'react'
import { paradas } from '../shared/paradas.js'

export const nombreParada = Object.fromEntries(paradas.map(({ id, nombre }) => [id, nombre]))
export const horaLocal = new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota',
})
export const pesos = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
export const fechaFormulario = value => new Date(new Date(value).getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 16)

export async function api(url, options) {
  const response = await fetch(url, options)
  const result = await response.json()
  if (!response.ok) throw new Error(result.message || 'No se pudo completar la solicitud.')
  return result
}

export default function Itinerario({ trip }) {
  if (!trip.itinerary?.length) {
    return <p>{trip.route.map(id => nombreParada[id] ?? id).join(' → ')}. Edita el viaje para completar sus horarios.</p>
  }
  return (
    <ol className="itinerary" aria-label="Itinerario del viaje">
      {trip.itinerary.map(stop => (
        <li key={stop.stopId}>
          <strong>{nombreParada[stop.stopId]}</strong> · {horaLocal.format(new Date(stop.estimatedAt))}
          {stop.distanceToNextKm !== null && <small> · {stop.distanceToNextKm} km hasta la siguiente parada</small>}
        </li>
      ))}
    </ol>
  )
}

export function AvisosViajes() {
  const [notice, setNotice] = useState('')
  useEffect(() => {
    const events = new EventSource('/api/trips/events')
    const refresh = () => window.dispatchEvent(new Event('jalon-trips-update'))
    events.addEventListener('ready', refresh)
    events.addEventListener('trip-cancelled', event => {
      const change = JSON.parse(event.data)
      setNotice(`Se canceló un viaje en el que participas. Motivo: ${change.reason}`)
      refresh()
    })
    return () => events.close()
  }, [])
  return notice && <p className="notice" role="status">{notice}</p>
}
