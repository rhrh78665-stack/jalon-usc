import test from 'node:test'
import assert from 'node:assert/strict'
import { fijarCostos } from '../server/itinerarios.js'

test('CP-F025 rechaza rendimiento cero y peaje negativo', () => {
  assert.throws(() => fijarCostos([{ distanceToNextKm: 38, tollToNextCop: 2000 }], 0, 15000))
  assert.throws(() => fijarCostos([{ distanceToNextKm: 38, tollToNextCop: -1 }], 30, 15000))
})
