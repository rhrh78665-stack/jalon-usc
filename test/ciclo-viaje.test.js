import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { createApp } from '../server/app.js'
import { openDatabase } from '../server/db.js'
import { fijarCostos, horaLocal } from '../server/itinerarios.js'
import { calcularLiquidacion, verificarLiquidacion } from '../server/liquidacion.js'
import { expirarPendientes } from '../server/reservas.js'
import { tramos } from '../shared/paradas.js'

test('RF-021 a RF-030: reservas, cierre y tarifas', async t => {
  const db = await openDatabase()
  const server = createApp(db).listen(0, '127.0.0.1')
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await db.close()
  })
  await once(server, 'listening')
  const base = 'http://127.0.0.1:' + server.address().port
  const cookies = {}
  for (const [index, id] of ['driver', 'passenger', 'other', 'outsider'].entries()) {
    const token = String(index + 1).repeat(64)
    await db.query("INSERT INTO users (id, email, password, status) VALUES ($1, $2, 'test-only', 'approved')", [id, id + '@usc.edu.co'])
    await db.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, CURRENT_TIMESTAMP + interval '1 day')",
      [createHash('sha256').update(token).digest('hex'), id])
    cookies[id] = 'jalon_session=' + token
  }
  await db.exec(`
    INSERT INTO driver_permissions (user_id, reviewer_id, license_expires_on)
      VALUES ('driver', 'other', CURRENT_DATE + 365);
    INSERT INTO vehicles (id, user_id, plate, seats, efficiency) VALUES ('car', 'driver', 'ABC123', 4, 30);
  `)
  let dayOffset = 2
  const nextDay = () => horaLocal(new Date(Date.now() + dayOffset++ * 86400000)).slice(0, 10)
  const valid = (date = nextDay(), changes = {}) => ({
    vehicleId: 'car', departAt: date + 'T06:00', capacity: 2,
    route: ['melendez', 'lido', 'usc'], stopTimes: ['06:00', '06:20', '06:40'].map(time => date + 'T' + time),
    fuelPriceCopPerGallon: 15000, ...changes,
  })
  async function request(path, { user = 'driver', method = 'GET', body } = {}) {
    const response = await fetch(base + path, {
      method, headers: { ...(user ? { Cookie: cookies[user] } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    return { status: response.status, data: await response.json() }
  }
  async function publish(body) {
    const result = await request('/api/trips', { method: 'POST', body })
    assert.equal(result.status, 201, JSON.stringify(result.data))
    return result.data
  }

  const solicitar = (trip, user = 'passenger', origin = 'melendez', destination = 'usc') =>
    request(`/api/trips/${trip.id}/reservations`, { user, method: 'POST', body: { origin, destination } })
  const decidir = (id, decision = 'confirmar', user = 'driver') =>
    request(`/api/reservations/${id}/decision`, { user, method: 'PATCH', body: { decision } })
  const bandeja = user => request('/api/reservations', { user })

  async function confirmar(trip, user = 'passenger', origin, destination) {
    const { status, data } = await solicitar(trip, user, origin, destination)
    assert.equal(status, 201, JSON.stringify(data))
    assert.equal((await decidir(data.id)).status, 200)
    return data
  }
  const post = (path, body, user = 'driver') => request(path, { method: 'POST', body, user })
  const close = (trip, asistencia, user) => post(`/api/trips/${trip.id}/finish`, { asistencia }, user)
  const cancelar = (id, user = 'passenger') => post(`/api/reservations/${id}/cancel`, undefined, user)
  const start = trip => post(`/api/trips/${trip.id}/start`)
  const compensation = (id, montoCop, user) => post(`/api/reservations/${id}/compensation`, { montoCop }, user)
  const rate = (id, user, review = 'Buen viaje.') => post(`/api/reservations/${id}/rating`, { stars: 5, review }, user)
  const state = async trip => (await db.query('SELECT status FROM trips WHERE id = $1', [trip.id])).rows[0].status
  async function started(trip) {
    await db.query("UPDATE trips SET depart_at = clock_timestamp() - interval '1 minute' WHERE id = $1", [trip.id])
    assert.equal((await start(trip)).status, 200)
  }

  await t.test('CP-F021 cancela una sola vez, restringe propiedad y registra tres advertencias', async () => {
    for (let n = 0; n < 3; n++) {
      const trip = await publish(valid(undefined, { capacity: 1 }))
      const booking = await confirmar(trip)
      await db.query(
        `UPDATE trips SET depart_at = clock_timestamp() + interval '45 minutes',
          itinerary = jsonb_set(itinerary, '{0,estimatedAt}', to_jsonb(clock_timestamp() + interval '45 minutes'))
         WHERE id = $1`, [trip.id],
      )
      assert.equal((await cancelar(booking.id, 'other')).status, 404)
      assert.equal((await cancelar(booking.id)).data.status, 'Cancelada')
      assert.equal((await cancelar(booking.id)).data.status, 'Cancelada')
      assert.equal(await state(trip), 'Programado')
    }
    assert.equal((await db.query("SELECT count(*)::int AS n FROM booking_warnings WHERE reason = 'cancelacion_tardia'")).rows[0].n, 3)
    const trip = await publish(valid())
    assert.equal((await solicitar(trip)).status, 403)
    await db.query("UPDATE users SET suspended_until = NULL WHERE id = 'passenger'")
  })

  await t.test('CP-F022 marca Lleno solo si todos los tramos están ocupados y reabre al cancelar', async () => {
    const trip = await publish(valid(undefined, { capacity: 1 }))
    const left = await confirmar(trip, 'passenger', 'melendez', 'lido')
    assert.equal(await state(trip), 'Programado')
    await confirmar(trip, 'other', 'lido', 'usc')
    assert.equal(await state(trip), 'Lleno')
    assert.equal((await cancelar(left.id)).status, 200)
    assert.equal(await state(trip), 'Programado')
  })

  await t.test('CP-F023 vence pendientes, requiere asistencia y persiste un cierre idempotente', async () => {
    const trip = await publish(valid())
    const booking = await confirmar(trip)
    const pending = (await solicitar(trip, 'other')).data
    assert.equal((await start(trip)).status, 409)
    await started(trip)
    assert.equal((await bandeja('other')).data.find(r => r.id === pending.id).status, 'Vencida')
    assert.equal((await cancelar(booking.id)).status, 409)
    assert.equal((await close(trip, [], 'other')).status, 403)
    assert.equal((await close(trip, [])).status, 409)
    assert.equal(await state(trip), 'EnCurso')
    const marks = [{ id: booking.id, attendance: 'Abordo' }]
    const closes = await Promise.all([close(trip, marks), close(trip, marks)])
    assert.ok(closes.every(result => result.status === 200))
    assert.deepEqual(closes[0].data, closes[1].data)
    assert.equal(await state(trip), 'Completado')
  })

  await t.test('CP-F024 usa el primer vencimiento y respeta la desactivación', async () => {
    const trip = await publish(valid())
    const early = (await solicitar(trip)).data
    const onDeparture = await publish(valid())
    const late = (await solicitar(onDeparture, 'other')).data
    await db.query("UPDATE reservations SET requested_at = NOW() - interval '1 hour' WHERE id = $1", [early.id])
    await db.query("UPDATE trips SET depart_at = NOW() - interval '1 minute' WHERE id = $1", [onDeparture.id])
    const messages = []
    const notify = async (ids, booking) => messages.push({ ids, booking })
    await expirarPendientes(db, 0, notify)
    assert.equal(messages.length, 0)
    await expirarPendientes(db, 30, notify)
    assert.deepEqual(messages.map(m => m.booking.id).filter(id => [early.id, late.id].includes(id)).sort(), [early.id, late.id].sort())
    assert.ok(messages.every(m => m.booking.status === 'Vencida' && m.ids.includes('driver')))
    const count = messages.length
    await expirarPendientes(db, 30, notify)
    assert.equal(messages.length, count)
  })

  await t.test('CP-F025 calcula $21.000 con 38 km, $15.000 por galón y $2.000 de peaje', () => {
    const result = fijarCostos([{ distanceToNextKm: 38, tollToNextCop: 2000 }], 30, 15000)
    assert.equal(result.itinerary[0].costToNextCop, 21000)
    assert.equal(result.pricing.totalCostCop, 21000)
  })

  let completed
  let member
  let absent
  await t.test('CP-F026 liquida solo a ocupantes reales y guarda el desglose por tramo', async () => {
    const ejemplo = calcularLiquidacion({
      itinerary: [
        { stopId: 'a', costToNextCop: 12000 },
        { stopId: 'b', costToNextCop: 9000 },
        { stopId: 'usc' },
      ],
    }, [
      { id: 'p1', board_index: 0, alight_index: 2, attendance: 'Abordo', maximum_cop: 10500 },
      { id: 'p2', board_index: 1, alight_index: 2, attendance: 'Ausente', maximum_cop: 4500 },
    ])
    assert.deepEqual(ejemplo.aportes, { p1: 10500, p2: 0 })
    assert.equal(ejemplo.conductorCop, 10500)
    completed = await publish(valid())
    member = await confirmar(completed)
    absent = await confirmar(completed, 'other', 'lido', 'usc')
    await started(completed)
    const result = await close(completed, [{ id: member.id, attendance: 'Abordo' }, { id: absent.id, attendance: 'Ausente' }])
    assert.equal(result.status, 200, JSON.stringify(result.data))
    const liquidation = result.data.liquidation
    assert.equal(liquidation.aportes[member.id], 11000)
    assert.equal(liquidation.aportes[absent.id], 0)
    assert.equal(liquidation.conductorCop, 0)
    assert.deepEqual(liquidation.tramos.map(t => t.costoCop), [1500, 1000])
    assert.equal((await bandeja('passenger')).data.find(r => r.id === member.id).aporteFinalCop, 11000)
    assert.equal((await bandeja('other')).data.find(r => r.id === absent.id).aporteFinalCop, 0)
    const retry = await close(completed, [])
    assert.deepEqual(retry.data.liquidation, liquidation)
    assert.equal((await db.query("SELECT count(*)::int AS n FROM booking_warnings WHERE reservation_id = $1 AND reason = 'ausencia'", [absent.id])).rows[0].n, 1)
  })

  await t.test('CP-F027 rechaza reparto inconsistente y revierte el cierre si supera el máximo registrado', async () => {
    const trip = await publish(valid())
    const booking = await confirmar(trip)
    await started(trip)
    const marks = [{ id: booking.id, attendance: 'Abordo' }]
    assert.equal((await post(`/api/trips/${trip.id}/finish`, { asistencia: marks, totalCop: 1 })).status, 400)
    assert.equal(await state(trip), 'EnCurso')
    await db.query('UPDATE reservations SET maximum_cop = 1 WHERE id = $1', [booking.id])
    assert.equal((await close(trip, [{ id: booking.id, attendance: 'Abordo' }])).status, 409)
    const { rows: [persisted] } = await db.query('SELECT status, liquidation FROM trips WHERE id = $1', [trip.id])
    assert.deepEqual(persisted, { status: 'EnCurso', liquidation: null })
    assert.equal((await db.query('SELECT attendance FROM reservations WHERE id = $1', [booking.id])).rows[0].attendance, null)
    const fixture = { itinerary: [{ stopId: 'a', costToNextCop: 3 }, { stopId: 'b' }] }
    const reservations = [{ id: 'r', board_index: 0, alight_index: 1, attendance: 'Abordo', maximum_cop: 1 }]
    const calculated = calcularLiquidacion(fixture, reservations)
    verificarLiquidacion(calculated, fixture, reservations)
    calculated.tramos[0].conductorCop = 1
    assert.throws(() => verificarLiquidacion(calculated, fixture, reservations), /conserva/)
  })

  await t.test('CP-F028 solo admite monto liquidado y confirma el pasajero correspondiente', async () => {
    assert.equal((await compensation(member.id, 22001)).status, 409)
    assert.equal((await compensation(absent.id, 1)).status, 409)
    assert.equal((await compensation(member.id, 1000, 'other')).status, 403)
    assert.equal((await compensation(member.id, 1000)).status, 201)
    assert.equal((await compensation(member.id, 1000)).status, 409)
    const path = `/api/reservations/${member.id}/compensation/confirm`
    assert.equal((await post(path, undefined, 'other')).status, 404)
    const first = await post(path, undefined, 'passenger')
    assert.equal(first.status, 200)
    assert.deepEqual((await post(path, undefined, 'passenger')).data, first.data)
  })

  await t.test('CP-F029 versiona precios y peajes sin aplicar la tarifa nueva a viajes anteriores', async () => {
    const prior = await publish(valid())
    await db.exec("UPDATE users SET mobility = true WHERE id = 'outsider'")
    const tolls = Object.fromEntries(tramos.map(({ from, to }) => [from + ':' + to, 300]))
    const configure = (fuelPriceCopPerGallon, user) => post('/api/movilidad/tarifas/nueva', { fuelPriceCopPerGallon, tolls }, user)
    assert.equal((await configure(20000, 'other')).status, 403)
    assert.equal((await configure(20000, 'outsider')).status, 201)
    const newTrip = await publish(valid())
    assert.equal(newTrip.pricing.tariff.version, 1)
    assert.equal(newTrip.itinerary[0].costToNextCop, 2300)
    assert.equal((await configure(25000, 'outsider')).status, 201)
    const later = await publish(valid())
    assert.equal(later.pricing.tariff.version, 2)
    assert.equal(later.itinerary[0].costToNextCop, 2800)
    assert.equal((await request('/api/trips/mine')).data.find(trip => trip.id === prior.id).pricing.fuelPriceCopPerGallon, 15000)
    const edited = await request(`/api/trips/${newTrip.id}`, { method: 'PUT', body: valid() })
    assert.equal(edited.status, 200)
    assert.equal(edited.data.itinerary[0].costToNextCop, 2300)
  })

  await t.test('CP-F030 registra ambas direcciones y rechaza duplicados, ausencias y plazo vencido', async () => {
    assert.equal((await rate(member.id, 'outsider')).status, 403)
    assert.equal((await rate(absent.id, 'other')).status, 409)
    assert.equal((await rate(member.id, 'passenger', 'x'.repeat(301))).status, 400)
    assert.equal((await rate(member.id, 'driver')).status, 201)
    assert.equal((await rate(member.id, 'passenger')).status, 201)
    assert.equal((await rate(member.id, 'driver')).status, 409)
    assert.equal((await bandeja('passenger')).data.find(r => r.id === member.id).misEstrellas, 5)
    assert.equal((await db.query('SELECT count(*)::int AS n FROM ratings WHERE trip_id = $1', [completed.id])).rows[0].n, 2)

    const expired = await publish(valid())
    const another = await confirmar(expired, 'other')
    await started(expired)
    assert.equal((await close(expired, [{ id: another.id, attendance: 'Abordo' }])).status, 200)
    await db.query("UPDATE trips SET completed_at = NOW() - interval '8 days' WHERE id = $1", [expired.id])
    assert.equal((await rate(another.id, 'other')).status, 409)
  })
})
