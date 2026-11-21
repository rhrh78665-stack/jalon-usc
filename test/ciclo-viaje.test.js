import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { createApp } from '../server/app.js'
import { openDatabase } from '../server/db.js'
import { fijarCostos, horaLocal } from '../server/itinerarios.js'
import { expirarPendientes } from '../server/reservas.js'

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
})
