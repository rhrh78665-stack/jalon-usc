import { requireRule } from './rules.js'

export function calcularLiquidacion(trip, reservas) {
  requireRule(trip.itinerary.length >= 2, 'Completa el itinerario antes de cerrar.', 409)
  const aportes = Object.fromEntries(reservas.map(r => [r.id, 0]))
  let conductorCop = 0
  let totalCop = 0
  for (const [position, stop] of trip.itinerary.slice(0, -1).entries()) {
    const costo = stop.costToNextCop
    requireRule(Number.isSafeInteger(costo) && costo >= 0, 'Falta el costo fijado de un tramo.', 409)
    const presentes = reservas.filter(r => r.attendance === 'Abordo' &&
      r.board_index <= position && r.alight_index > position)
    const cuota = Math.floor(costo / (presentes.length + 1))
    for (const reserva of presentes) aportes[reserva.id] += cuota
    conductorCop += costo - presentes.length * cuota
    totalCop += costo
  }
  requireRule(reservas.every(r => aportes[r.id] <= r.maximum_cop), 'Un aporte supera el máximo de su reserva.', 409)
  return { totalCop, conductorCop, aportes }
}
