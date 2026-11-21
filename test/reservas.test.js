import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { createApp } from '../server/app.js'
import { openDatabase } from '../server/db.js'
import { horaLocal } from '../server/itinerarios.js'

test('RF-018 a RF-020: solicitudes y decisiones de reserva', async t => {
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
  const bandeja = user => request('/api/reservations', { user })

  await t.test('CP-F018 guarda el máximo, bloquea duplicados y conserva los cupos pendientes', async () => {
    const trip = await publish(valid(undefined, { capacity: 1 }))
    const requests = await Promise.all([solicitar(trip), solicitar(trip)])
    assert.deepEqual(requests.map(r => r.status).sort(), [201, 409])
    const saved = requests.find(r => r.status === 201).data
    assert.equal(saved.status, 'Pendiente')
    assert.equal(saved.maximumCop, trip.itinerary.slice(0, -1)
      .reduce((sum, stop) => sum + Math.floor(stop.costToNextCop / 2), 0))
    assert.equal(saved.origin, 'melendez')
    const query = new URLSearchParams({ origin: 'melendez', destination: 'usc' })
    assert.equal((await request(`/api/trips/${trip.id}?${query}`, { user: 'other' })).data.availableSeats, 1)
    assert.deepEqual((await bandeja('outsider')).data, [])
    assert.equal((await bandeja('passenger')).data[0].canDecide, false)
    assert.equal((await bandeja('driver')).data[0].canDecide, true)
    assert.equal((await solicitar(trip, 'driver')).status, 403)
    assert.equal((await solicitar(trip, 'other', 'usc', 'lido')).status, 400)
    assert.equal((await solicitar(trip, null)).status, 401)
    await db.exec("UPDATE users SET suspended_until = NOW() + interval '1 day' WHERE id = 'other'")
    assert.equal((await solicitar(trip, 'other')).status, 403)
    await db.exec("UPDATE users SET suspended_until = NULL WHERE id = 'other'")
    await db.query("UPDATE trips SET depart_at = NOW() - interval '1 minute' WHERE id = $1", [trip.id])
    assert.equal((await solicitar(trip, 'other')).status, 409)
  })
})
