import test from 'node:test'
import assert from 'node:assert/strict'
import { calcularLiquidacion, verificarLiquidacion } from '../server/liquidacion.js'

function permutations(values) {
  if (!values.length) return [[]]
  return values.flatMap((value, index) => permutations(values.filter((_, i) => i !== index)).map(rest => [value, ...rest]))
}

test('RNF-016 reparto conserva cada peso y no depende del orden de reservas', () => {
  let checked = 0
  for (const cost of [0, 1, 2, 3, 7, 101, 1001, 2147483647]) {
    const trip = { itinerary: [
      { stopId: 'a', costToNextCop: cost }, { stopId: 'b', costToNextCop: cost + 1 }, { stopId: 'c', costToNextCop: null },
    ] }
    const reservations = [
      { id: 'a', attendance: 'Abordo', board_index: 0, alight_index: 2, maximum_cop: Number.MAX_SAFE_INTEGER },
      { id: 'b', attendance: 'Abordo', board_index: 0, alight_index: 1, maximum_cop: Number.MAX_SAFE_INTEGER },
      { id: 'c', attendance: 'Abordo', board_index: 1, alight_index: 2, maximum_cop: Number.MAX_SAFE_INTEGER },
      { id: 'd', attendance: 'Ausente', board_index: 0, alight_index: 2, maximum_cop: Number.MAX_SAFE_INTEGER },
    ]
    const expected = calcularLiquidacion(trip, reservations)
    for (const order of permutations(reservations)) {
      const result = calcularLiquidacion(trip, order)
      verificarLiquidacion(result, trip, order)
      assert.deepEqual(result, expected)
      assert.equal(result.conductorCop + Object.values(result.aportes).reduce((a, b) => a + b, 0), result.totalCop)
      assert.equal(result.aportes.d, 0)
      for (const segment of result.tramos) assert.equal(segment.conductorCop + Object.values(segment.aportes).reduce((a, b) => a + b, 0), segment.costoCop)
      checked++
    }
  }
  assert.equal(checked, 192)
})
