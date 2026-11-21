import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createHash, randomUUID } from 'node:crypto'
import { createApp } from '../server/app.js'
import { openDatabase } from '../server/db.js'
import { horaLocal } from '../server/itinerarios.js'

test('RF-011 a RF-017: itinerarios, búsqueda y gestión de viajes', async t => {
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

  await t.test('CP-F012 filtra cupos por todo el intervalo y las pendientes no ocupan', async () => {
    const day = nextDay()
    const trip = await publish(valid(day, { capacity: 1 }))
    await booking(trip, { start: 0, end: 1 })
    assert.equal((await request(searchPath(day))).data.total, 0)
    const available = await request(searchPath(day, { origin: 'lido' }))
    assert.equal(available.data.total, 1)
    assert.equal(available.data.items[0].availableSeats, 1)
    await booking(trip, { passenger: 'other', start: 1, end: 2, status: 'Pendiente' })
    assert.equal((await request(searchPath(day, { origin: 'lido' }))).data.total, 1)
    assert.equal((await request(searchPath(day, { origin: 'usc', destination: 'melendez' }))).data.total, 0)
    assert.equal((await request(detailPath(trip.id))).status, 409)
  })

  await t.test('CP-F012 pagina sin divulgar identidad, vehículo ni reservas', async () => {
    const day = nextDay()
    for (let i = 0; i < 3; i++) await publish(valid(day))
    const first = await request(searchPath(day, { pageSize: '2' }), { user: 'passenger' })
    const second = await request(searchPath(day, { pageSize: '2', page: '2' }), { user: 'passenger' })
    assert.equal(first.data.total, 3)
    assert.equal(first.data.items.length, 2)
    assert.equal(second.data.items.length, 1)
    assert.equal(new Set([...first.data.items, ...second.data.items].map(trip => trip.id)).size, 3)
    for (const trip of first.data.items) for (const field of ['driverId', 'vehicleId', 'passengerId', 'email', 'reservations']) assert.equal(field in trip, false)
    assert.equal((await request(searchPath(day, { page: '-1' }))).status, 400)
    assert.equal((await request(searchPath('2035-02-30'))).status, 400)
    assert.equal((await request(searchPath(day), { user: null })).status, 401)
  })

  await t.test('CP-F013 hacia USC acepta la ventana inclusiva y ordena por cercanía', async () => {
    const day = nextDay()
    const ids = {}
    for (const arrival of ['06:15', '06:20', '06:55', '07:00', '07:05']) {
      ids[arrival] = (await publish(valid(day, {
        route: ['melendez', 'usc'], stopTimes: [day + 'T06:00', day + 'T' + arrival],
      }))).id
    }
    const result = await request(searchPath(day, { time: '07:00' }))
    assert.deepEqual(result.data.items.map(trip => trip.id), [ids['07:00'], ids['06:55'], ids['06:20']])
  })

  await t.test('CP-F013 desde USC acepta 17:00 y 17:40, excluye 16:59 y 17:41', async () => {
    const day = nextDay()
    const ids = {}
    for (const departure of ['16:59', '17:00', '17:40', '17:41']) {
      ids[departure] = (await publish(valid(day, {
        departAt: day + 'T' + departure, route: ['usc', 'melendez'],
        stopTimes: [day + 'T' + departure, day + 'T18:00'],
      }))).id
    }
    const result = await request(searchPath(day, { origin: 'usc', destination: 'melendez', time: '17:00' }))
    assert.deepEqual(result.data.items.map(trip => trip.id), [ids['17:00'], ids['17:40']])
  })

  await t.test('CP-F014 devuelve aporte y máximo sin modificar el viaje', async () => {
    const trip = await publish(valid())
    await booking(trip, { start: 1, end: 2 })
    const result = await request(detailPath(trip.id), { user: 'passenger' })
    assert.equal(result.status, 200)
    assert.equal(result.data.maximumCop, 1250)
    assert.equal(result.data.estimatedCop, 1083)
    assert.equal(result.data.segments.length, 2)
    assert.equal((await request(detailPath(trip.id, 'usc', 'melendez'))).status, 400)
    assert.equal((await request(detailPath(trip.id), { user: null })).status, 401)
    const mine = await request('/api/trips/mine')
    assert.deepEqual(mine.data.find(item => item.id === trip.id), trip)
  })

  await t.test('CP-F015 edita el viaje propio, recalcula y lo refleja en búsqueda', async () => {
    const day = nextDay()
    const trip = await publish(valid(day))
    const body = valid(day, { fuelPriceCopPerGallon: 18000, departAt: day + 'T07:00', stopTimes: ['07:00', '07:20', '07:40'].map(time => day + 'T' + time) })
    const updated = await request(`/api/trips/${trip.id}`, { method: 'PUT', body })
    assert.equal(updated.status, 200, JSON.stringify(updated.data))
    assert.deepEqual(updated.data.itinerary.map(stop => stop.costToNextCop), [1800, 1200, null])
    const found = await request(searchPath(day, { time: '07:40' }))
    assert.equal(found.data.items[0].id, trip.id)
    assert.equal(found.data.items[0].boardAt, updated.data.departAt)
    assert.equal((await request(`/api/trips/${trip.id}`, { user: 'other', method: 'PUT', body })).status, 403)
  })

  await t.test('CP-F015 bloquea reservas pendientes y confirmadas sin guardar cambios', async () => {
    for (const status of ['Pendiente', 'Confirmada']) {
      const body = valid()
      const trip = await publish(body)
      await booking(trip, { status })
      assert.equal((await request(`/api/trips/${trip.id}`, { method: 'PUT', body: { ...body, capacity: 3 } })).status, 409)
      const { rows: [saved] } = await db.query('SELECT capacity FROM trips WHERE id = $1', [trip.id])
      assert.equal(saved.capacity, 2)
    }
  })

  await t.test('CP-F016 crea viajes independientes y revierte una serie con fecha pasada', async () => {
    const body = valid()
    const dates = [nextDay(), nextDay()]
    const created = await request('/api/trips/series', { method: 'POST', body: { ...body, dates } })
    assert.equal(created.status, 201, JSON.stringify(created.data))
    assert.equal(created.data.length, 2)
    assert.notEqual(created.data[0].id, created.data[1].id)
    assert.deepEqual(created.data.map(trip => horaLocal(trip.departAt).slice(0, 10)), dates)
    const { rows: [before] } = await db.query('SELECT COUNT(*)::int AS count FROM trips')
    const failed = await request('/api/trips/series', { method: 'POST', body: { ...body, dates: [nextDay(), '2000-01-01'] } })
    assert.equal(failed.status, 400)
    const { rows: [after] } = await db.query('SELECT COUNT(*)::int AS count FROM trips')
    assert.equal(after.count, before.count)
    assert.equal((await request('/api/trips/series', { method: 'POST', body: { ...body, dates: ['2035-02-30'] } })).status, 400)
    assert.equal((await request('/api/trips/series', { user: 'passenger', method: 'POST', body: { ...body, dates } })).status, 403)
  })

  await t.test('CP-F017 cancela viaje y reservas, desaparece de búsqueda y es idempotente', async () => {
    const day = nextDay()
    const trip = await publish(valid(day))
    await booking(trip)
    await booking(trip, { passenger: 'other', status: 'Pendiente' })
    const cancel = () => request(`/api/trips/${trip.id}/cancel`, { method: 'POST', body: { reason: 'Cambio de horario' } })
    assert.equal((await request(`/api/trips/${trip.id}/cancel`, { user: 'passenger', method: 'POST', body: { reason: 'Ajeno' } })).status, 403)
    const response = await cancel()
    assert.equal(response.status, 200)
    assert.equal(response.data.status, 'Cancelado')
    const { rows } = await db.query('SELECT status FROM reservations WHERE trip_id = $1', [trip.id])
    assert.deepEqual(rows.map(row => row.status), ['Cancelada', 'Cancelada'])
    assert.equal((await request(searchPath(day))).data.total, 0)
    assert.equal((await request(detailPath(trip.id))).status, 404)
    assert.deepEqual((await cancel()).data, response.data)
  })

  await t.test('CP-F017 rechaza viajes en curso o completados y motivos vacíos', async () => {
    for (const status of ['EnCurso', 'Completado']) {
      const trip = await publish(valid())
      await db.query('UPDATE trips SET status = $2 WHERE id = $1', [trip.id, status])
      assert.equal((await request(`/api/trips/${trip.id}/cancel`, { method: 'POST', body: { reason: 'Cambio' } })).status, 409)
    }
    const trip = await publish(valid())
    assert.equal((await request(`/api/trips/${trip.id}/cancel`, { method: 'POST', body: { reason: '  ' } })).status, 400)
  })

  await t.test('CP-F017 informa después del guardado solo a participantes autorizados', async () => {
    const trip = await publish(valid())
    await booking(trip)
    async function listen(user) {
      const controller = new AbortController()
      const response = await fetch(base + '/api/trips/events', { headers: { Cookie: cookies[user] }, signal: controller.signal })
      assert.equal(response.status, 200)
      const reader = response.body.getReader()
      const ready = new TextDecoder().decode((await reader.read()).value)
      assert.match(ready, /event: ready/)
      return { reader, controller }
    }
    const passenger = await listen('passenger')
    const outsider = await listen('outsider')
    try {
      const notice = passenger.reader.read()
      const unrelated = outsider.reader.read().catch(() => ({ value: undefined }))
      assert.equal((await request(`/api/trips/${trip.id}/cancel`, { method: 'POST', body: { reason: 'Evento de prueba' } })).status, 200)
      const chunk = await Promise.race([notice, new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error('No se recibió la cancelación')), 2000)
        timer.unref()
      })])
      assert.match(new TextDecoder().decode(chunk.value), /trip-cancelled/)
      const { rows: [saved] } = await db.query('SELECT status FROM trips WHERE id = $1', [trip.id])
      assert.equal(saved.status, 'Cancelado')
      const outcome = await Promise.race([unrelated.then(() => 'event'), new Promise(resolve => setTimeout(() => resolve('quiet'), 150))])
      assert.equal(outcome, 'quiet')
    } finally {
      passenger.controller.abort()
      outsider.controller.abort()
    }
  })
})
