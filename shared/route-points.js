import { paradas } from './paradas.js'

export function localPoint(point) {
  return point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude) &&
    point.latitude >= 3.28 && point.latitude <= 3.52 && point.longitude >= -76.65 && point.longitude <= -76.43
}
export function pointName(trip, id) {
  return trip?.itinerary?.find(stop => stop.stopId === id)?.name || paradas.find(stop => stop.id === id)?.nombre || 'Punto de encuentro'
}
export function itineraryPoints(trip) {
  return (trip?.itinerary || []).map(stop => {
    const known = paradas.find(point => point.id === stop.stopId)
    return known || { id: stop.stopId, nombre: stop.name, latitude: stop.latitude, longitude: stop.longitude }
  })
}
