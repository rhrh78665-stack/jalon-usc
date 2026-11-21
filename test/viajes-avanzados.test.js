import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createHash, randomUUID } from 'node:crypto'
import { createApp } from '../server/app.js'
import { openDatabase } from '../server/db.js'
import { horaLocal } from '../server/itinerarios.js'

test('RF-011 a RF-011: itinerarios, búsqueda y gestión de viajes', async t => {
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
  async function booking(trip, { passenger = 'passenger', start = 0, end = 2, status = 'Confirmada' } = {}) {
    await db.query('INSERT INTO reservations (id, trip_id, passenger_id, board_index, alight_index, status, maximum_cop) VALUES ($1, $2, $3, $4, $5, $6, 1250)',
      [randomUUID(), trip.id, passenger, start, end, status])
  }
  const searchPath = (date, extra = {}) => '/api/trips/search?' + new URLSearchParams({ origin: 'melendez', destination: 'usc', date, ...extra })
  const detailPath = (id, origin = 'melendez', destination = 'usc') => `/api/trips/${id}?` + new URLSearchParams({ origin, destination })

  await t.test('CP-F011 guarda posiciones, horas, distancias y costos del servidor', async () => {
    const body = valid()
    const trip = await publish({ ...body, itinerary: [{ distanceToNextKm: 999, costToNextCop: 0 }] })
    assert.deepEqual(trip.itinerary.map(stop => stop.position), [0, 1, 2])
    assert.deepEqual(trip.itinerary.map(stop => stop.distanceToNextKm), [3, 2, null])
    assert.deepEqual(trip.itinerary.map(stop => stop.costToNextCop), [1500, 1000, null])
    assert.equal(trip.itinerary[0].estimatedAt, new Date(body.departAt + ':00-05:00').toISOString())
    const { rows: [saved] } = await db.query('SELECT itinerary FROM trips WHERE id = $1', [trip.id])
    assert.deepEqual(saved.itinerary, trip.itinerary)
  })

  await t.test('CP-F011 rechaza duplicados, saltos, horas ausentes, iguales o decrecientes', async () => {
    const body = valid()
    const date = body.departAt.slice(0, 10)
    const { rows: [before] } = await db.query('SELECT COUNT(*)::int AS count FROM trips')
    for (const changes of [
      { route: ['melendez', 'melendez', 'usc'] },
      { route: ['usc', 'lido', 'unicentro'] },
      { route: ['unknown', 'lido', 'usc'] },
      { stopTimes: undefined }, { stopTimes: [] },
      { stopTimes: [date + 'T06:00', date + 'T06:00', date + 'T06:40'] },
      { stopTimes: [date + 'T06:00', date + 'T05:50', date + 'T06:40'] },
      { stopTimes: [date + 'T05:55', date + 'T06:20', date + 'T06:40'] },
      { stopTimes: [date + 'T06:00', '2035-02-30T06:20', date + 'T06:40'] },
      { fuelPriceCopPerGallon: -1 }, { fuelPriceCopPerGallon: '15000' },
    ]) {
      const result = await request('/api/trips', { method: 'POST', body: { ...body, ...changes } })
      assert.equal(result.status, 400, JSON.stringify(changes))
    }
    const { rows: [after] } = await db.query('SELECT COUNT(*)::int AS count FROM trips')
    assert.equal(after.count, before.count)
  })
})
