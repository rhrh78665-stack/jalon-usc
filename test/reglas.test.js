import test from 'node:test'
import assert from 'node:assert/strict'
import { RuleError, requireRule, institutionalEmail } from '../server/rules.js'
import { calcularLiquidacion, verificarLiquidacion } from '../server/liquidacion.js'

test('RNF-025 reglas institucionales y errores de dominio', () => {
  assert.equal(institutionalEmail('  Nombre+uno@USC.EDU.CO '), 'nombre+uno@usc.edu.co')
  for (const email of [null, '', '@usc.edu.co', 'a@usc.edu.co@otro', 'a@otro.co', 'a'.repeat(65) + '@usc.edu.co']) assert.throws(() => institutionalEmail(email), RuleError)
  assert.equal(requireRule(true, 'ok'), undefined)
  assert.throws(() => requireRule(false, 'conflicto', 409), error => error instanceof RuleError && error.status === 409)
})

test('RNF-025 rechazo de costos y liquidaciones alteradas', () => {
  const trip = { itinerary: [{ stopId: 'a', costToNextCop: 101 }, { stopId: 'b', costToNextCop: null }] }
  const reservations = [{ id: 'a', attendance: 'Abordo', board_index: 0, alight_index: 1, maximum_cop: 60 }]
  const result = calcularLiquidacion(trip, reservations)
  verificarLiquidacion(result, trip, reservations)
  assert.throws(() => calcularLiquidacion({ itinerary: [] }, reservations), RuleError)
  assert.throws(() => calcularLiquidacion({ itinerary: [{ costToNextCop: -1 }, {}] }, reservations), RuleError)
  assert.throws(() => calcularLiquidacion(trip, [{ ...reservations[0], maximum_cop: 0 }]), RuleError)
  for (const mutate of [
    value => { value.tramos[0].costoCop++ }, value => { value.tramos[0].aportes.a = 90 },
    value => { value.tramos[0].aportes.ajeno = 0 }, value => { value.tramos[0].conductorCop++ },
    value => { value.totalCop++ }, value => { value.conductorCop++ }, value => { value.aportes.a++ },
    value => { value.tramos = [] },
  ]) { const changed = structuredClone(result); mutate(changed); assert.throws(() => verificarLiquidacion(changed, trip, reservations), RuleError) }
})
