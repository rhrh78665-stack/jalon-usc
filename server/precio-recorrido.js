import { maximumFareCop } from '../shared/fare-policy.js'
import { requireRule } from './rules.js'

export function distanceFare(itinerary, start, end) {
  requireRule(Number.isSafeInteger(start) && Number.isSafeInteger(end) && start>=0 && end>start && end<itinerary.length, 'El tramo no es válido.',409)
  const segments = itinerary.slice(start, end)
  const minimum = itinerary[0]?.minimumFareCop
  requireRule(segments.length && segments.every(s => s.fareModel === 'distance-v2' && Number.isSafeInteger(s.fareToNextCop) && s.fareToNextCop >= 0) &&
    Number.isSafeInteger(minimum) && minimum >= 11000, 'La tarifa del recorrido está incompleta.', 409)
  const perKm = itinerary[0]?.farePerKmCop
  requireRule(Number.isSafeInteger(perKm) && perKm > 0 && segments.every(s=>s.farePerKmCop===perKm && Number.isFinite(s.distanceToNextKm) && s.distanceToNextKm>0), 'La distancia o la tarifa del recorrido no es válida.',409)
  const amount = Math.max(minimum, Math.ceil((segments.reduce((sum,s) => sum+s.distanceToNextKm,0)*perKm-1e-7)/500)*500)
  requireRule(Number.isSafeInteger(amount) && amount <= 2147483647, 'La tarifa supera el límite permitido.', 409)
  return Math.min(maximumFareCop, amount)
}

export function distributeFare(amount, segments) {
  const total = segments.reduce((sum,s) => sum+s.distanceToNextKm,0)
  requireRule(Number.isFinite(total) && total > 0, 'El recorrido no tiene distancia válida.', 409)
  let assigned = 0
  return segments.map((s,i) => {
    const value = i === segments.length-1 ? amount-assigned : Math.floor(amount*s.distanceToNextKm/total)
    assigned += value
    return value
  })
}
