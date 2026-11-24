import test from 'node:test'
import assert from 'node:assert/strict'
import { summarize } from '../quality/availability.mjs'
test('RNF-021 los minutos sin muestra cuentan como indisponibles y no se inventan treinta días', () => {
  assert.equal(summarize([{ slot: 0, ok: true }], 0, 60000).passed, null)
  const samples = Array.from({ length: 43200 }, (_, slot) => ({ slot, ok: slot >= 100 }))
  assert.equal(summarize(samples, 0, 30 * 86400000).passed, true)
  assert.equal(summarize(samples.slice(300), 0, 30 * 86400000).passed, false)
  assert.equal(summarize(samples.slice(300), 0, 30 * 86400000).missing, 300)
})
