import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { demoFleet } from '../shared/demo-fleet.js'
import { seedDemo } from '../server/demo.js'
import { openDatabase } from '../server/db.js'
import { createApp } from '../server/app.js'

test('la demostración conserva los tres accesos principales y agrega conductores sin crear un perfil invitado', async t => {
  const db = await openDatabase()
  const server = createApp(db, undefined, null).listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await db.close()
  })
  await seedDemo(db)
  const { rows } = await db.query('SELECT id, email, mobility FROM users ORDER BY id')
  assert.equal(rows.length, 66)
  assert.deepEqual(rows.filter(row => ['demo-driver','demo-passenger','demo-mobility'].includes(row.id)), [
    { id: 'demo-driver', email: 'conductor.demo@usc.edu.co', mobility: false },
    { id: 'demo-mobility', email: 'movilidad.demo@usc.edu.co', mobility: true },
    { id: 'demo-passenger', email: 'pasajero.demo@usc.edu.co', mobility: false },
  ])
  const drivers = (await db.query('SELECT user_id FROM driver_permissions ORDER BY user_id')).rows
  assert.deepEqual(drivers.map(row => row.user_id).sort(), demoFleet.map(car => car.user).sort())
  const bookings = (await db.query('SELECT DISTINCT passenger_id FROM reservations')).rows
  assert.deepEqual(bookings, [{ passenger_id: 'demo-passenger' }])
  const base = 'http://127.0.0.1:' + server.address().port
  for (const email of rows.filter(row => ['demo-driver','demo-passenger','demo-mobility'].includes(row.id)).map(row => row.email)) {
    const response = await fetch(base + '/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'JalonDemo-2026!' }),
    })
    assert.equal(response.status, 200)
    await response.json()
  }
  const invited = await fetch(base + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'invitado.demo@usc.edu.co', password: 'JalonDemo-2026!' }),
  })
  assert.equal(invited.status, 401)
  await invited.json()
})
