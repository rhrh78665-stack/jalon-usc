import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { once } from 'node:events'
import { createRoadService, roadRoute, routeStops, mountRoadMap } from '../server/mapa-vial.js'

const stops = routeStops('melendez,usc')
const payload = {
  code: 'Ok',
  routes: [{ distance: 4946, duration: 556, geometry: { type: 'LineString', coordinates: [[-76.5485, 3.3775], [-76.5484, 3.4034]] }, legs: [{ distance: 4946, duration: 556 }] }],
  privateData: 'no devolver',
}

test('mapa vial valida el catálogo y no permite coordenadas ni destinos arbitrarios', () => {
  for (const value of [undefined, '', 'usc', 'usc,usc', 'usc,desconocido', 'https://example.com', ['usc', 'melendez']]) {
    assert.throws(() => routeStops(value))
  }
  assert.deepEqual(stops.map(stop => stop.id), ['melendez', 'usc'])
  assert.equal(roadRoute(payload, stops).distanceMeters, 4946)
  assert.equal(roadRoute(payload, stops).trafficIncluded, false)
  assert.equal(roadRoute(payload, stops).privateData, undefined)
  assert.throws(() => roadRoute({ ...payload, code: 'NoRoute' }, stops))
  const bad = structuredClone(payload)
  bad.routes[0].geometry.coordinates[0][0] = 0
  assert.throws(() => roadRoute(bad, stops))
})

test('mapa vial comparte peticiones concurrentes y reutiliza la ruta sin reenviar datos de sesión', async () => {
  let calls = 0
  const service = createRoadService({ fetcher: async (url, options) => {
    calls++
    assert.equal(url.hostname, 'router.project-osrm.org')
    assert.equal(url.searchParams.get('geometries'), 'geojson')
    assert.equal(options.headers.Cookie, undefined)
    assert.equal(options.headers.Authorization, undefined)
    return { ok: true, json: async () => payload }
  } })
  const [a, b] = await Promise.all([service(stops), service(stops)])
  assert.deepEqual(a, b)
  assert.deepEqual(await service(stops), a)
  assert.equal(calls, 1)
})

test('mapa vial conserva un error recuperable cuando el proveedor no responde', async () => {
  const service = createRoadService({ fetcher: async () => { throw new Error('secret-provider-error') } })
  await assert.rejects(service(stops), error => error.status === 503 && !error.message.includes('secret-provider-error'))
})

test('mapa vial autentica antes de consultar al proveedor y devuelve solo la ruta', async t => {
  const app = express()
  let calls = 0
  mountRoadMap(app, async req => {
    if (req.headers['x-test-session'] !== 'valid') throw Object.assign(new Error('Sesión no activa.'), { status: 401 })
  }, { fetcher: async () => { calls++; return { ok: true, json: async () => payload } } })
  app.use((error, req, res, next) => res.status(error.status || 500).json({ message: error.message }))
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  const url = 'http://127.0.0.1:' + server.address().port + '/api/map/route?stops=melendez,usc'
  assert.equal((await fetch(url)).status, 401)
  assert.equal(calls, 0)
  const response = await fetch(url, { headers: { 'x-test-session': 'valid' } })
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.distanceMeters, 4946)
  assert.equal(result.privateData, undefined)
  assert.equal(calls, 1)
})


test('la demostración y el formulario utilizan la misma referencia de gasolina de Cali', async t => {
  const { precioGalonDemo, referenciaGasolina } = await import('../shared/paradas.js')
  const { openDatabase } = await import('../server/db.js')
  const { seedDemo } = await import('../server/demo.js')
  assert.equal(precioGalonDemo, 16339)
  assert.equal(referenciaGasolina.vigenteDesde, '2026-10-02')
  const db = await openDatabase()
  t.after(() => db.close())
  await seedDemo(db)
  const { rows } = await db.query('SELECT itinerary, pricing FROM trips')
  assert.ok(rows.length > 0)
  for (const trip of rows) {
    assert.equal(trip.pricing.fuelPriceCopPerGallon, precioGalonDemo)
    for (const stop of trip.itinerary) {
      if (stop.distanceToNextKm === null) continue
      assert.equal(stop.costToNextCop, Math.round(stop.distanceToNextKm / 30 * precioGalonDemo + stop.tollToNextCop))
    }
  }
})
