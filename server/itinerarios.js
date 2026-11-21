import { paradas, tramos } from '../shared/paradas.js'
import { requireRule } from './rules.js'

const validStops = new Set(paradas.map(({ id }) => id))
const minute = 60 * 1000

export function horaBogota(value) {
  requireRule(
    typeof value === 'string' && /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value),
    'Indica una fecha y hora válidas (hora de Cali).',
  )
  const instant = new Date(value + ':00-05:00')
  requireRule(Number.isFinite(instant.getTime()), 'La fecha y hora no son válidas.')
  const local = new Date(instant.getTime() - 5 * 60 * minute)
  requireRule(local.toISOString().slice(0, 16) === value, 'La fecha y hora no son válidas.')
  return instant.toISOString()
}

export function horaLocal(value) {
  return new Date(new Date(value).getTime() - 5 * 60 * minute).toISOString().slice(0, 16)
}

export function validarParadas(origin, destination) {
  requireRule(validStops.has(origin) && validStops.has(destination) && origin !== destination,
    'Selecciona dos paradas distintas del catálogo.')
}

export function crearItinerario(route, stopTimes, departure, catalog = tramos) {
  requireRule(
    Array.isArray(route) && route.length >= 2 && route.length <= paradas.length &&
      new Set(route).size === route.length && route.every(id => validStops.has(id)) &&
      (route[0] === 'usc' || route.at(-1) === 'usc'),
    'Selecciona paradas distintas con la USC en un extremo.',
  )
  requireRule(Array.isArray(stopTimes) && stopTimes.length === route.length,
    'Indica una hora estimada para cada parada.')
  const times = stopTimes.map(horaBogota)
  requireRule(times[0] === departure, 'La hora del origen debe coincidir con la salida.')
  requireRule(times.every((value, index) => index === 0 || value > times[index - 1]),
    'Las horas de las paradas deben ser estrictamente crecientes.')

  return route.map((stopId, position) => {
    const next = route[position + 1]
    const segment = next && catalog.find(({ from, to, active }) => active &&
      ((from === stopId && to === next) || (to === stopId && from === next)))
    if (next) {
      requireRule(segment && Number.isFinite(segment.distanceKm) && segment.distanceKm > 0,
        'Cada tramo debe tener una distancia positiva en el catálogo vigente.')
      requireRule(Number.isSafeInteger(segment.tollCop) && segment.tollCop >= 0,
        'El peaje del tramo no es válido.')
    }
    return {
      position, stopId, estimatedAt: times[position],
      distanceToNextKm: next ? segment.distanceKm : null,
      tollToNextCop: next ? segment.tollCop : null,
      costToNextCop: null,
    }
  })
}

export function fijarCostos(itinerary, efficiency, fuelPriceCopPerGallon) {
  requireRule(Number.isFinite(efficiency) && efficiency > 0, 'El rendimiento del vehículo no es válido.')
  requireRule(Number.isSafeInteger(fuelPriceCopPerGallon) && fuelPriceCopPerGallon > 0,
    'Indica un precio del galón entero y mayor que cero.')
  const result = itinerary.map(stop => {
    if (stop.distanceToNextKm === null) return stop
    const cost = Math.round(stop.distanceToNextKm / efficiency * fuelPriceCopPerGallon + stop.tollToNextCop)
    requireRule(Number.isSafeInteger(cost) && cost >= 0 && cost <= 2147483647,
      'El costo del tramo supera el límite permitido.')
    return { ...stop, costToNextCop: cost }
  })
  return { itinerary: result, pricing: { currency: 'COP', efficiency, fuelPriceCopPerGallon } }
}

export function cotizar(trip, reservations, origin, destination) {
  const start = trip.route.indexOf(origin)
  const end = trip.route.indexOf(destination)
  requireRule(start >= 0 && end > start, 'La subida debe estar antes de la bajada en el viaje.')
  requireRule(trip.itinerary.length === trip.route.length,
    'Este viaje necesita completar sus horarios y distancias.')
  const segments = trip.itinerary.slice(start, end).map(stop => {
    const occupants = reservations.filter(booking => booking.status === 'Confirmada' &&
      booking.board_index <= stop.position && booking.alight_index > stop.position).length
    requireRule(Number.isSafeInteger(stop.costToNextCop) && stop.costToNextCop >= 0,
      'El viaje no tiene costos registrados para este tramo.')
    return {
      from: stop.stopId, to: trip.route[stop.position + 1],
      distanceKm: stop.distanceToNextKm, costCop: stop.costToNextCop,
      availableSeats: Math.max(0, trip.capacity - occupants),
      estimatedCop: Math.floor(stop.costToNextCop / (occupants + 2)),
      maximumCop: Math.floor(stop.costToNextCop / 2),
    }
  })
  return {
    boardAt: trip.itinerary[start].estimatedAt,
    alightAt: trip.itinerary[end].estimatedAt,
    availableSeats: Math.min(...segments.map(segment => segment.availableSeats)),
    estimatedCop: segments.reduce((sum, segment) => sum + segment.estimatedCop, 0),
    maximumCop: segments.reduce((sum, segment) => sum + segment.maximumCop, 0),
    segments,
  }
}
