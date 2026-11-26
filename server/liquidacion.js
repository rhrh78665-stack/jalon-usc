import { distanceFare, distributeFare } from './precio-recorrido.js'
import { isDeepStrictEqual } from 'node:util'
import { requireRule, validSegmentContribution } from './rules.js'

export function calcularLiquidacion(trip, reservas) {
  requireRule(trip.itinerary.length >= 2, 'Completa el itinerario antes de cerrar.', 409)
  if (trip.itinerary[0]?.fareModel === 'distance-v2') return liquidarDistancia(trip,reservas)
  if (trip.itinerary.some(stop => stop.fareToNextCop != null)) return liquidarTarifa(trip, reservas)
  const aportes = Object.fromEntries(reservas.map(r => [r.id, 0]))
  const tramos = []
  let conductorCop = 0
  let totalCop = 0
  for (const [position, stop] of trip.itinerary.slice(0, -1).entries()) {
    const costo = stop.costToNextCop
    requireRule(Number.isSafeInteger(costo) && costo >= 0, 'Falta el costo fijado de un tramo.', 409)
    const presentes = reservas.filter(r => r.attendance === 'Abordo' &&
      r.board_index <= position && r.alight_index > position)
    const cuota = Math.floor(costo / (presentes.length + 1))
    for (const reserva of presentes) aportes[reserva.id] += cuota
    const resto = costo - presentes.length * cuota
    conductorCop += resto
    tramos.push({
      desde: stop.stopId, hasta: trip.itinerary[position + 1].stopId, costoCop: costo, conductorCop: resto,
      aportes: Object.fromEntries(presentes.map(r => [r.id, cuota])),
    })
    totalCop += costo
  }
  requireRule(reservas.every(r => aportes[r.id] <= r.maximum_cop), 'Un aporte supera el máximo de su reserva.', 409)
  return { totalCop, conductorCop, aportes, tramos }
}

export function verificarLiquidacion(liquidacion, trip, reservas) {
  if (trip.itinerary[0]?.fareModel === 'distance-v2') {
    requireRule(isDeepStrictEqual(liquidacion, liquidarDistancia(trip,reservas)), 'La liquidación no coincide con el valor reservado.',409)
    return
  }
  if (trip.itinerary.some(stop => stop.fareToNextCop != null)) {
    requireRule(isDeepStrictEqual(liquidacion, liquidarTarifa(trip, reservas)), 'La liquidación no coincide con la tarifa reservada.', 409)
    return
  }
  const sumas = new Map(reservas.map(r => [r.id, 0]))
  let total = 0
  let conductor = 0
  for (const [position, tramo] of liquidacion.tramos.entries()) {
    const { costoCop } = tramo
    requireRule(costoCop === trip.itinerary[position]?.costToNextCop, 'El costo del tramo no coincide.', 409)
    let suma = tramo.conductorCop
    for (const [id, monto] of Object.entries(tramo.aportes)) {
      requireRule(sumas.has(id) && validSegmentContribution(monto, costoCop), 'Un aporte supera el tope del tramo.', 409)
      suma += monto
      sumas.set(id, sumas.get(id) + monto)
    }
    requireRule(suma === costoCop && tramo.conductorCop >= 0, 'El reparto no conserva el costo del tramo.', 409)
    total += costoCop
    conductor += tramo.conductorCop
  }
  requireRule(liquidacion.tramos.length === trip.itinerary.length - 1 &&
    total === liquidacion.totalCop && conductor === liquidacion.conductorCop,
    'El desglose de la liquidación está incompleto.', 409)
  requireRule(reservas.every(r => sumas.get(r.id) === liquidacion.aportes[r.id] && sumas.get(r.id) <= r.maximum_cop),
    'Un aporte supera el máximo de su reserva.', 409)
}

function liquidarTarifa(trip, reservas) {
  requireRule(reservas.every(r => Number.isSafeInteger(r.board_index) && Number.isSafeInteger(r.alight_index) &&
    r.board_index >= 0 && r.alight_index > r.board_index && r.alight_index < trip.itinerary.length &&
    ['Abordo', 'Ausente'].includes(r.attendance)), 'La asistencia o el tramo de una reserva no es válido.', 409)
  const aportes = Object.fromEntries(reservas.map(r => [r.id, 0]))
  let totalCop = 0, operatingCostCop = 0
  const tramos = trip.itinerary.slice(0, -1).map((stop, position) => {
    requireRule(Number.isSafeInteger(stop.fareToNextCop) && stop.fareToNextCop >= 11000 &&
      Number.isSafeInteger(stop.costToNextCop) && stop.costToNextCop >= 0, 'La tarifa del tramo está incompleta.', 409)
    const presentes = reservas.filter(r => r.attendance === 'Abordo' && r.board_index <= position && r.alight_index > position)
    const segmento = Object.fromEntries(presentes.map(r => [r.id, stop.fareToNextCop]))
    for (const r of presentes) aportes[r.id] += stop.fareToNextCop
    const recaudoCop = presentes.length * stop.fareToNextCop
    totalCop += recaudoCop
    operatingCostCop += stop.costToNextCop
    return { desde: stop.stopId, hasta: trip.itinerary[position + 1].stopId,
      costoCop: stop.costToNextCop, tarifaCop: stop.fareToNextCop, recaudoCop, conductorCop: 0, aportes: segmento }
  })
  requireRule(Number.isSafeInteger(totalCop) && reservas.every(r => Number.isSafeInteger(aportes[r.id]) && aportes[r.id] <= r.maximum_cop),
    'Un valor supera el máximo de su reserva.', 409)
  return { mode: 'fixed-fare', totalCop, conductorCop: 0, operatingCostCop, aportes, tramos }
}

function liquidarDistancia(trip, reservas) {
  const aportes = Object.fromEntries(reservas.map(r => [r.id,0]))
  const tramos = trip.itinerary.slice(0,-1).map((s,i) => ({ desde:s.stopId,hasta:trip.itinerary[i+1].stopId,
    costoCop:s.costToNextCop,tarifaCop:s.fareToNextCop,recaudoCop:0,conductorCop:0,aportes:{} }))
  for (const r of reservas) {
    requireRule(Number.isSafeInteger(r.board_index) && Number.isSafeInteger(r.alight_index) && r.board_index >= 0 &&
      r.alight_index > r.board_index && r.alight_index < trip.itinerary.length && ['Abordo','Ausente'].includes(r.attendance),
      'La asistencia o el tramo de una reserva no es válido.',409)
    if (r.attendance !== 'Abordo') continue
    const amount = distanceFare(trip.itinerary,r.board_index,r.alight_index)
    requireRule(amount <= r.maximum_cop, 'Un valor supera el máximo de su reserva.',409)
    aportes[r.id] = amount
    const values = distributeFare(amount,trip.itinerary.slice(r.board_index,r.alight_index))
    values.forEach((value,i) => { const t=tramos[r.board_index+i];t.aportes[r.id]=value;t.recaudoCop+=value })
  }
  const totalCop = Object.values(aportes).reduce((a,b)=>a+b,0)
  requireRule(Number.isSafeInteger(totalCop), 'El total de la liquidación no es válido.',409)
  return { mode:'distance-v2',totalCop,conductorCop:0,operatingCostCop:tramos.reduce((a,t)=>a+t.costoCop,0),aportes,tramos }
}
