import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { createApp } from '../server/app.js'
import { openDatabase } from '../server/db.js'
import { horaLocal } from '../server/itinerarios.js'

test('RNF-015 capacidad y horarios bajo concurrencia', async t => {
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


  await t.test('veinte carreras por el último cupo sin sobreventa', async () => {
    for (let i = 0; i < 20; i++) {
      const trip = await publish(valid(undefined, { capacity: 1 }))
      const a = (await solicitar(trip)).data
      const b = (await solicitar(trip, 'other')).data
      const results = await Promise.all([decidir(a.id), decidir(b.id)])
      assert.deepEqual(results.map(r => r.status).sort(), [200, 409])
      assert.equal((await db.query("SELECT count(*)::int AS n FROM reservations WHERE trip_id = $1 AND status = 'Confirmada'", [trip.id])).rows[0].n, 1)
    }
  })
  await t.test('veinte carreras por reservas de un pasajero con horario solapado', async () => {
    for (let i = 0; i < 20; i++) {
      const date = nextDay()
      const first = await publish(valid(date))
      const second = await publish(valid(date))
      const a = (await solicitar(first)).data
      const b = (await solicitar(second)).data
      const results = await Promise.all([decidir(a.id), decidir(b.id)])
      assert.deepEqual(results.map(r => r.status).sort(), [200, 409])
      assert.equal((await db.query("SELECT count(*)::int AS n FROM reservations WHERE id = ANY($1::text[]) AND status = 'Confirmada'", [[a.id, b.id]])).rows[0].n, 1)
    }
  })
})
