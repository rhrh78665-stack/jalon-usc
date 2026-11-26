import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { openDatabase } from '../server/db.js'
import { createApp } from '../server/app.js'
import { seedDemo } from '../server/demo.js'
import { horaLocal } from '../server/itinerarios.js'
import { demoVehiclePhoto } from '../shared/demo-vehicle.js'
import { demoFleet } from '../shared/demo-fleet.js'
import { vehicleDescription } from '../server/foto-vehiculo.js'

async function setup(t) {
  const db = await openDatabase()
  const tomorrow = await seedDemo(db)
  const cookies = {}
  for (const [index, id] of ['demo-driver', 'demo-passenger', 'demo-mobility'].entries()) {
    const token = String(index + 1).repeat(64)
    cookies[id] = 'jalon_session=' + token
    await db.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,NOW()+interval '1 day')", [createHash('sha256').update(token).digest('hex'), id])
  }
  const server = createApp(db, undefined, null).listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await db.close() })
  const base = 'http://127.0.0.1:' + server.address().port
  async function request(path, user = 'demo-passenger', body, method = 'GET') {
    return fetch(base + path, { method, headers: { ...(user && { Cookie: cookies[user] }), ...(body && { 'Content-Type': 'application/json' }) }, body: body ? JSON.stringify(body) : undefined })
  }
  return { db, request, tomorrow }
}

test('cartelera muestra todos los recorridos del día con conductor, carro y foto, placa visible y sin correos privados', async t => {
  const { db, request, tomorrow } = await setup(t)
  const path = '/api/journeys/available?date=' + tomorrow
  assert.equal((await request(path, null)).status, 401)
  const response = await request(path)
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.ok(result.items.length >= 2)
  for (const trip of result.items) {
    assert.ok(demoFleet.some(car => car.name === trip.driver.name && car.plate === trip.vehicle.plate))
    assert.ok(demoFleet.some(car => car.brand === trip.vehicle.brand))
    assert.match(trip.vehicle.plate, /^[A-Z]{3}[0-9]{3}$/)
    assert.ok(trip.vehicle.model && trip.vehicle.color)
    assert.ok(trip.estimatedCop >= 11000)
    assert.equal(trip.estimatedCop, trip.maximumCop)
    assert.ok(trip.vehicle.photoUrl)
    assert.ok(trip.availableSeats > 0)
    assert.equal(horaLocal(trip.boardAt).slice(0, 10), tomorrow)
    assert.ok(Date.parse(trip.departAt) > Date.now())
    const encoded = JSON.stringify(trip)
    assert.doesNotMatch(encoded, /@usc.edu.co|password|token_hash/)
    assert.equal(Object.hasOwn(trip, 'driverId'), false)
  }
  assert.equal((await request(path, 'demo-driver')).status, 403)
  const filtered = await (await request(path + '&origin=melendez&destination=usc')).json()
  assert.ok(filtered.items.every(trip => trip.origin === 'melendez' && trip.destination === 'usc'))
  assert.equal((await request('/api/journeys/available?date=2026-02-30')).status, 400)
  assert.equal((await request(path + '&origin=desconocido')).status, 400)
  assert.equal((await request(path + '&page=0')).status, 400)
  const today = horaLocal(new Date()).slice(0, 10)
  const todayResult = await (await request('/api/journeys/available?pageSize=50&date=' + today)).json()
  const expected = (await db.query("SELECT id FROM trips WHERE id LIKE 'demo-today-%' AND depart_at>clock_timestamp() AND (depart_at AT TIME ZONE 'America/Bogota')::date=$1::date", [today])).rows
  for (const row of expected) assert.ok(todayResult.items.some(trip => trip.id === row.id))
})

test('solo el dueño del carro puede actualizar su descripción y fotografía; la tarjeta usa esos datos', async t => {
  const { request, tomorrow } = await setup(t)
  const body = { brand: 'Toyota', model: 'Yaris LE 2013', color: 'Blanco', photoData: demoVehiclePhoto }
  const path = '/api/vehicles/demo-car/description'
  assert.equal((await request(path, 'demo-passenger', body, 'PATCH')).status, 403)
  assert.equal((await request(path, 'demo-mobility', body, 'PATCH')).status, 403)
  assert.equal((await request(path, null, body, 'PATCH')).status, 401)
  const response = await request(path, 'demo-driver', body, 'PATCH')
  assert.equal(response.status, 200)
  const saved = await response.json()
  assert.equal(saved.model, 'Yaris LE 2013')
  assert.equal(saved.hasPhoto, true)
  assert.equal(saved.photoReference, false)
  const photo = await request('/api/vehicles/demo-car/photo')
  assert.equal(photo.status, 200)
  assert.match(photo.headers.get('content-type'), /image\/jpeg/)
  assert.ok((await photo.arrayBuffer()).byteLength > 100)
  const board = await (await request('/api/journeys/available?date=' + tomorrow)).json()
  assert.ok(board.items.filter(trip => trip.vehicle.photoUrl === '/api/vehicles/demo-car/photo').every(trip => trip.vehicle.model === 'Yaris LE 2013' && !trip.vehicle.photoReference))
  const detail = await (await request('/api/trips/demo-search?origin=melendez&destination=usc')).json()
  assert.equal(detail.vehicle.model, 'Yaris LE 2013')
  assert.equal(detail.driver.name, 'Carlos Rivas')
  assert.equal((await request(path, 'demo-driver', { ...body, photoData: 'data:image/svg+xml;base64,PHN2Zz4=' }, 'PATCH')).status, 400)
})

test('las fotos rechazan formatos activos, contenido falso y tamaños excesivos', () => {
  for (const photoData of ['https://example.com/car.jpg', 'data:image/jpeg;base64,' + 'A'.repeat(32), 'x'.repeat(280001)]) {
    assert.throws(() => vehicleDescription({ photoData }))
  }
  assert.throws(() => vehicleDescription({ brand: '<script>' }))
  assert.equal(vehicleDescription({ brand: 'Toyota', photoData: demoVehiclePhoto }).brand, 'Toyota')
})

test('la sesión distingue los tres perfiles para mostrar las secciones correspondientes', async t => {
  const { request } = await setup(t)
  assert.equal((await (await request('/api/session', 'demo-driver')).json()).driver, true)
  assert.equal((await (await request('/api/session', 'demo-passenger')).json()).driver, undefined)
  assert.equal((await (await request('/api/session', 'demo-mobility')).json()).mobility, true)
  const login = await request('/api/login', null, { email: 'conductor.demo@usc.edu.co', password: 'JalonDemo-2026!' }, 'POST')
  assert.equal((await login.json()).driver, true)
})


test('la cartelera encuentra una recogida después de medianoche aunque el viaje salga el día anterior', async t => {
  const { request, tomorrow } = await setup(t)
  const nextDate = new Date(Date.parse(tomorrow + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10)
  const published = await request('/api/trips', 'demo-driver', {
    vehicleId: 'demo-car', capacity: 2, departAt: tomorrow + 'T23:50',
    route: ['usc', 'melendez', 'lido'],
    stopTimes: [tomorrow + 'T23:50', nextDate + 'T00:10', nextDate + 'T00:30'],
    fuelPriceCopPerGallon: 16339,
  }, 'POST')
  assert.equal(published.status, 201)
  const trip = await published.json()
  const result = await (await request('/api/journeys/available?' + new URLSearchParams({ date: nextDate, origin: 'melendez', destination: 'lido' }))).json()
  assert.ok(result.items.some(item => item.id === trip.id && horaLocal(item.boardAt).slice(0, 10) === nextDate))
})
