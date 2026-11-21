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
  const decidir = (id, decision = 'confirmar', user = 'driver') =>
    request(`/api/reservations/${id}/decision`, { user, method: 'PATCH', body: { decision } })
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

  await t.test('CP-F019 solo confirma un cupo concurrente y permite rechazar después', async () => {
    const trip = await publish(valid(undefined, { capacity: 1 }))
    const a = (await solicitar(trip)).data
    const b = (await solicitar(trip, 'other')).data
    assert.equal((await decidir(a.id, 'rechazar', 'outsider')).status, 403)
    const attempts = await Promise.all([decidir(a.id), decidir(b.id)])
    assert.deepEqual(attempts.map(r => r.status).sort(), [200, 409])
    const winner = attempts.find(r => r.status === 200).data
    const loser = winner.id === a.id ? b : a
    assert.equal(winner.status, 'Confirmada')
    assert.equal((await decidir(winner.id)).status, 409)
    assert.equal((await decidir(loser.id, 'rechazar')).data.status, 'Rechazada')
    const { rows: [status] } = await db.query('SELECT status FROM trips WHERE id = $1', [trip.id])
    assert.equal(status.status, 'Lleno')
  })

  await t.test('CP-F019 admite tramos sin cruce y bloquea traslape en viajes distintos', async () => {
    const date = nextDay()
    const first = await publish(valid(date, { capacity: 1 }))
    const second = await publish(valid(date, { capacity: 1 }))
    const left = (await solicitar(first, 'passenger', 'melendez', 'lido')).data
    const right = (await solicitar(first, 'other', 'lido', 'usc')).data
    const overlap = (await solicitar(second, 'passenger')).data
    assert.equal((await decidir(left.id)).status, 200)
    assert.equal((await db.query('SELECT status FROM trips WHERE id = $1', [first.id])).rows[0].status, 'Programado')
    assert.equal((await decidir(right.id)).status, 200)
    const conflict = await decidir(overlap.id)
    assert.equal(conflict.status, 409)
    assert.match(conflict.data.message, /otra reserva.*horario/)
    assert.equal((await bandeja('passenger')).data.find(item => item.id === overlap.id).status, 'Pendiente')
  })

  await t.test('CP-F020 informa a participantes y lee el estado vigente al reconectar', async () => {
    assert.equal((await fetch(base + '/api/trips/events')).status, 401)
    const controllers = []
    async function connect(user) {
      const controller = new AbortController()
      controllers.push(controller)
      const response = await fetch(base + '/api/trips/events', {
        headers: { Cookie: cookies[user] }, signal: controller.signal,
      })
      assert.equal(response.status, 200)
      const reader = response.body.getReader()
      assert.match(new TextDecoder().decode((await reader.read()).value), /event: ready/)
      return { reader, controller }
    }

    try {
      const trip = await publish(valid())
      const driver = await connect('driver')
      const outsider = await connect('outsider')
      const passenger = await connect('passenger')
      function next(reader) {
        return Promise.race([reader.read(), new Promise((_, reject) => {
          const timer = setTimeout(() => reject(new Error('No llegó el evento de reserva.')), 2500)
          timer.unref()
        })]).then(data => new TextDecoder().decode(data.value))
      }
      const fetchDriver = next(driver.reader)
      const fetchPassenger = next(passenger.reader)
      const outside = outsider.reader.read().then(() => 'event', () => 'closed')
      const saved = (await solicitar(trip)).data
      assert.match(await fetchDriver, /reservation-changed[\s\S]*Pendiente/)
      assert.match(await fetchPassenger, /reservation-changed[\s\S]*Pendiente/)
      assert.equal((await bandeja('driver')).data.find(item => item.id === saved.id).status, 'Pendiente')
      passenger.controller.abort()

      const fetchDecision = next(driver.reader)
      assert.equal((await decidir(saved.id)).status, 200)
      assert.match(await fetchDecision, /reservation-changed[\s\S]*Confirmada/)
      await connect('passenger')
      assert.equal((await bandeja('passenger')).data.find(item => item.id === saved.id).status, 'Confirmada')
      assert.equal(await Promise.race([outside, new Promise(resolve => setTimeout(resolve, 120, 'quiet'))]), 'quiet')
    } finally {
      controllers.forEach(controller => controller.abort())
    }
  })
})
