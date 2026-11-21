import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createApp } from '../server/app.js'
import { hashPassword } from '../server/auth.js'
import { openDatabase } from '../server/db.js'

test('CP-F010 Publicar viaje', async t => {
  const db = await openDatabase()
  const server = createApp(db).listen(0, '127.0.0.1')
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await db.close()
  })

  await once(server, 'listening')
  const base = 'http://127.0.0.1:' + server.address().port
  const password = 'Jalon-Prueba-2026'

  await db.query(
    `INSERT INTO users (id, email, password, status) VALUES
       ('a', 'conductor@usc.edu.co', $1, 'approved'),
       ('b', 'miembro@usc.edu.co', $1, 'approved')`,
    [await hashPassword(password)],
  )
  await db.exec(`
    INSERT INTO driver_permissions (user_id, reviewer_id, license_expires_on)
    VALUES ('a', 'b', (CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')::date + 2);

    INSERT INTO vehicles (id, user_id, plate, seats, efficiency) VALUES
      ('vehicle-a', 'a', 'ABC123', 4, 42.5),
      ('vehicle-b', 'b', 'DEF456', 4, 40);
  `)

  async function request(path, cookie, body) {
    return fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  async function login(email) {
    const response = await request('/api/login', null, { email, password })
    assert.equal(response.status, 200)
    return response.headers.get('set-cookie').split(';')[0]
  }

  const driver = await login('conductor@usc.edu.co')
  const member = await login('miembro@usc.edu.co')
  const departAt = new Date(Date.now() + 19 * 60 * 60 * 1000).toISOString().slice(0, 16)
  const valid = { vehicleId: 'vehicle-a', departAt, capacity: 4, route: ['melendez', 'lido', 'usc'] }
  const publish = (cookie, body) => request('/api/trips', cookie, body)

  assert.equal((await publish(null, valid)).status, 401)
  assert.equal((await publish(member, valid)).status, 403)
  for (const changes of [
    { vehicleId: 'vehicle-b' },
    { capacity: 5 },
    { departAt: '2000-01-01T10:00' },
    { departAt: '2099-02-30T10:00' },
    { route: ['melendez', 'lido'] },
    { route: ['usc', 'lido', 'unicentro'] },
    { route: ['usc', 'lido', 'usc'] },
  ]) {
    assert.equal((await publish(driver, { ...valid, ...changes })).status, 400)
  }

  const response = await publish(driver, valid)
  assert.equal(response.status, 201)
  const trip = await response.json()
  assert.ok(trip.id)
  assert.deepEqual(trip, {
    ...valid,
    id: trip.id,
    departAt: new Date(departAt + ':00-05:00').toISOString(),
    status: 'Programado',
  })
  assert.deepEqual(await (await request('/api/trips/mine', driver)).json(), [trip])
  assert.deepEqual(await (await request('/api/trips/mine', member)).json(), [])
})
