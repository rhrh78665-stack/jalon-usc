import test from 'node:test'
import assert from 'node:assert/strict'
import { crearItinerario, fijarCostos, cotizar, horaBogota } from '../server/itinerarios.js'

test('CP-F011 rechaza distancias ausentes, inválidas y tramos inactivos', () => {
  const route = ['melendez', 'usc']
  const times = ['2035-01-01T06:00', '2035-01-01T06:20']
  for (const distanceKm of [undefined, null, 0, -1, Infinity, NaN, '3']) {
    assert.throws(() => crearItinerario(route, times, horaBogota(times[0]), [
      { from: 'melendez', to: 'usc', distanceKm, tollCop: 0, active: true },
    ]), /distancia positiva/)
  }
  assert.throws(() => crearItinerario(route, times, horaBogota(times[0]), [
    { from: 'melendez', to: 'usc', distanceKm: 3, tollCop: 0, active: false },
  ]), /distancia positiva/)
})

test('CP-F014 cotización usa costos fijos y ocupación por tramo, con máximo estable', () => {
  const route = ['melendez', 'lido', 'usc']
  const times = ['2035-01-01T06:00', '2035-01-01T06:20', '2035-01-01T06:40']
  const catalog = [
    { from: 'melendez', to: 'lido', distanceKm: 20, tollCop: 2000, active: true },
    { from: 'lido', to: 'usc', distanceKm: 18, tollCop: 0, active: true },
  ]
  const fixed = fijarCostos(crearItinerario(route, times, horaBogota(times[0]), catalog), 30, 15000)
  const trip = { route, capacity: 2, ...fixed }
  const empty = cotizar(trip, [], 'melendez', 'usc')
  assert.equal(empty.maximumCop, 10500)
  assert.equal(empty.estimatedCop, 10500)
  const occupied = cotizar(trip, [{ status: 'Confirmada', board_index: 1, alight_index: 2 }], 'melendez', 'usc')
  assert.equal(occupied.maximumCop, 10500)
  assert.equal(occupied.estimatedCop, 9000)
  assert.equal(occupied.availableSeats, 1)
  assert.throws(() => cotizar(trip, [], 'usc', 'melendez'), /subida/)
  assert.throws(() => fijarCostos(fixed.itinerary, 0, 15000), /rendimiento/)
  assert.throws(() => fijarCostos(fixed.itinerary, 30, -1), /precio/)
})
