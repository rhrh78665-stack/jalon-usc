import test from 'node:test'
import assert from 'node:assert/strict'
import { crearItinerario, horaBogota } from '../server/itinerarios.js'

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
