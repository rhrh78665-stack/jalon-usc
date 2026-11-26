import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { openDatabase } from '../server/db.js'
import { seedDemo } from '../server/demo.js'
import { createApp } from '../server/app.js'
import { defaultFare } from '../shared/fare-policy.js'
import { tramos } from '../shared/paradas.js'
import { calcularLiquidacion, verificarLiquidacion } from '../server/liquidacion.js'
import { fijarCostos, crearItinerario, horaBogota } from '../server/itinerarios.js'

test('tarifa fija: respeta asistencia, topes y desglose sin alterar los costos históricos', () => {
  const route = ['melendez', 'lido', 'usc'], times = ['2035-01-01T08:00', '2035-01-01T08:20', '2035-01-01T08:40']
  const trip = { route, capacity: 3, ...fijarCostos(crearItinerario(route, times, horaBogota(times[0])), 30, 16339, defaultFare) }
  const bookings = [
    { id: 'a', board_index: 0, alight_index: 2, maximum_cop: 22000, attendance: 'Abordo' },
    { id: 'b', board_index: 1, alight_index: 2, maximum_cop: 11000, attendance: 'Abordo' },
    { id: 'c', board_index: 0, alight_index: 1, maximum_cop: 11000, attendance: 'Ausente' },
  ]
  const actual = calcularLiquidacion(trip, bookings)
  assert.deepEqual(actual.aportes, { a: 22000, b: 11000, c: 0 }); assert.equal(actual.totalCop, 33000)
  assert.deepEqual(actual.tramos.map(t => t.recaudoCop), [11000, 22000])
  assert.equal(actual.operatingCostCop, trip.pricing.totalCostCop)
  verificarLiquidacion(actual, trip, bookings)
  const forged = structuredClone(actual); forged.aportes.a++
  assert.throws(() => verificarLiquidacion(forged, trip, bookings), /no coincide/)
  assert.throws(() => calcularLiquidacion(trip, [{ ...bookings[0], maximum_cop: 21999 }]), /máximo/)
  assert.throws(() => calcularLiquidacion(trip, [{ ...bookings[0], alight_index: 99 }]), /tramo/)
  assert.equal(calcularLiquidacion(trip, bookings.map(r => ({ ...r, attendance: 'Ausente' }))).totalCop, 0)
})

test('historial privado y ciclo completo con tarifa reservada', async t => {
  const db = await openDatabase(), tomorrow = await seedDemo(db), cookies = {}
  for (const id of ['demo-driver', 'demo-passenger', 'demo-mobility']) {
    const token = createHash('sha256').update('session/' + id).digest('hex'); cookies[id] = 'jalon_session=' + token
    await db.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,NOW()+interval '1 day')", [createHash('sha256').update(token).digest('hex'), id])
  }
  const server = createApp(db, undefined, null).listen(0, '127.0.0.1'); await once(server, 'listening')
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await db.close() })
  const base = 'http://127.0.0.1:' + server.address().port
  async function request(path, user = 'demo-passenger', method = 'GET', body) {
    const r = await fetch(base + path, { method, headers: { ...(user && { Cookie: cookies[user] }), ...(body && { 'Content-Type': 'application/json' }) }, ...(body && { body: JSON.stringify(body) }) })
    return { status: r.status, data: await r.json() }
  }
  await t.test('cada usuario ve únicamente su historial, con filtros y paginación', async () => {
    assert.equal((await request('/api/journeys/history', null)).status, 401)
    const passenger = await request('/api/journeys/history?user=demo-driver')
    assert.equal(passenger.status, 200)
    assert.equal(passenger.data.items.filter(r => r.status === 'Completado').length, 3)
    assert.ok(passenger.data.items.every(r => !r.asDriver))
    assert.ok(passenger.data.items.filter(r => r.status === 'Completado').every(r => r.settledCop >= 11000))
    assert.equal((await request('/api/journeys/history', 'demo-mobility')).data.total, 0)
    const driver = (await request('/api/journeys/history', 'demo-driver')).data
    assert.ok(driver.items.every(r => r.asDriver)); assert.ok(driver.items.some(r => r.status === 'Completado'))
    assert.ok(driver.items.some(r => r.status === 'Cancelado')); assert.ok(!driver.items.some(r => r.id === 'demo-history-1'))
    assert.doesNotMatch(JSON.stringify(driver), /password|token_hash|@usc.edu.co/)
    assert.ok((await request('/api/journeys/history?status=Completado')).data.items.every(r => r.status === 'Completado'))
    const last = (await request('/api/journeys/history?page=999')).data
    assert.equal(last.total, passenger.data.total); assert.equal(last.items.length, 0)
    assert.equal((await request('/api/journeys/history?page=0')).status, 400)
    await db.exec(`INSERT INTO reservations (id,trip_id,passenger_id,board_index,alight_index,status,maximum_cop)
      VALUES ('history-cancelled-1','demo-return','demo-passenger',0,1,'Cancelada',11000),
             ('history-cancelled-2','demo-return','demo-passenger',0,1,'Cancelada',11000)`)
    const cancelled = (await request('/api/journeys/history?status=Cancelado')).data
    assert.equal(cancelled.items.filter(r => r.id === 'demo-return').length, 2)
    assert.equal(new Set(cancelled.items.map(r => r.entryId)).size, cancelled.items.length)
  })
  await t.test('nombre, marca, placa y foto corresponden a conductores diferentes', async () => {
    const board = (await request('/api/journeys/available?pageSize=100&date=' + tomorrow)).data
    for (const values of [board.items.map(r => r.driver.name), board.items.map(r => r.vehicle.plate)]) assert.equal(new Set(values).size, 64)
    assert.ok(new Set(board.items.map(r => r.vehicle.brand)).size >= 7)
    const photos = new Set()
    for (const item of board.items) {
      const stored = (await db.query(`SELECT u.alias,v.plate FROM trips t JOIN users u ON u.id=t.driver_id JOIN vehicles v ON v.id=t.vehicle_id WHERE t.id=$1`, [item.id])).rows[0]
      assert.equal(item.driver.name, stored.alias); assert.equal(item.vehicle.plate, stored.plate)
      const response = await fetch(base + item.vehicle.photoUrl, { headers: { Cookie: cookies['demo-passenger'] } })
      assert.equal(response.status, 200); photos.add(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'))
    }
    assert.equal(photos.size, 64)
  })
  let reservation, accepted
  await t.test('Movilidad administra la tarifa sin cambiar un valor ya reservado', async () => {
    accepted = (await request('/api/trips/demo-search?origin=melendez&destination=usc')).data.maximumCop
    assert.ok(accepted >= 11000)
    const created = await request('/api/trips/demo-search/reservations', 'demo-passenger', 'POST', { origin: 'melendez', destination: 'usc' })
    assert.equal(created.status, 201); reservation = created.data; assert.equal(reservation.maximumCop, accepted)
    const tariff = { fuelPriceCopPerGallon: 16339, tolls: Object.fromEntries(tramos.map(s => [s.from + ':' + s.to, s.tollCop])), fare: { minimumCop: 15000, perKmCop: 3500 } }
    assert.equal((await request('/api/movilidad/tarifas/nueva', 'demo-driver', 'POST', tariff)).status, 403)
    assert.equal((await request('/api/movilidad/tarifas/nueva', 'demo-mobility', 'POST', { ...tariff, fare: { minimumCop: 1000, perKmCop: 3500 } })).status, 400)
    assert.equal((await request('/api/movilidad/tarifas/nueva', 'demo-mobility', 'POST', { ...tariff, fare: { minimumCop: 25001, perKmCop: 3500 } })).status, 400)
    assert.equal((await request('/api/movilidad/tarifas/nueva', 'demo-mobility', 'POST', tariff)).status, 201)
    assert.equal((await request('/api/trips/demo-search?origin=melendez&destination=usc')).data.maximumCop, accepted)
    const published = await request('/api/trips', 'demo-driver', 'POST', { vehicleId: 'demo-car', capacity: 2, departAt: tomorrow + 'T18:00', route: ['melendez', 'usc'], stopTimes: [tomorrow + 'T18:00', tomorrow + 'T18:20'], fuelPriceCopPerGallon: 1 })
    assert.equal(published.status, 201); assert.equal(published.data.itinerary[0].fareToNextCop, 14000)
    assert.equal(published.data.pricing.fuelPriceCopPerGallon, 16339)
    assert.equal((await request('/api/trips/'+published.data.id+'?origin=melendez&destination=usc')).data.maximumCop,15000)
  })
  await t.test('confirmar, cerrar, reintentar, pagar e incorporar el viaje al historial', async () => {
    assert.equal((await request('/api/reservations/' + reservation.id + '/decision', 'demo-driver', 'PATCH', { decision: 'confirmar' })).status, 200)
    await db.query("UPDATE trips SET depart_at=NOW()-interval '1 minute' WHERE id='demo-search'")
    assert.equal((await request('/api/trips/demo-search/start', 'demo-driver', 'POST')).status, 200)
    const finished = await request('/api/trips/demo-search/finish', 'demo-driver', 'POST', { asistencia: [{ id: reservation.id, attendance: 'Abordo' }] })
    assert.equal(finished.status, 200); assert.equal(finished.data.liquidation.aportes[reservation.id], accepted)
    assert.deepEqual((await request('/api/trips/demo-search/finish', 'demo-driver', 'POST', {})).data.liquidation, finished.data.liquidation)
    assert.equal((await request('/api/reservations/' + reservation.id + '/compensation', 'demo-driver', 'POST', { montoCop: accepted + 1 })).status, 409)
    assert.equal((await request('/api/reservations/' + reservation.id + '/compensation', 'demo-driver', 'POST', { montoCop: accepted })).status, 201)
    assert.equal((await request('/api/reservations/' + reservation.id + '/compensation/confirm', 'demo-passenger', 'POST')).status, 200)
    assert.equal((await request('/api/journeys/history')).data.items.find(item => item.id === 'demo-search').settledCop, accepted)
  })
})
