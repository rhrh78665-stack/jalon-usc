import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { createApp } from '../server/app.js'
import { openDatabase } from '../server/db.js'
import { lateCancellation } from '../server/penalizaciones.js'
import { registrarAdvertencia } from '../server/advertencias.js'
import { nearbyStops } from '../shared/proximidad.js'
import { mapPoints } from '../shared/mapa.js'
import { paradas } from '../shared/paradas.js'
import { readFile } from 'node:fs/promises'
import { seedDemo } from '../test-support/demo.js'

test('RF-031 a RF-039: comunidad y acceso móvil', async t => {
  const db = await openDatabase()
  await seedDemo(db)
  await db.exec("INSERT INTO users (id, email, password, status) VALUES ('outsider', 'ajeno@usc.edu.co', 'test-only', 'approved')")
  const cookies = {}
  for (const [index, id] of ['demo-driver', 'demo-passenger', 'demo-second', 'demo-mobility', 'outsider'].entries()) {
    const token = String(index + 1).repeat(64)
    await db.query(
      "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, NOW() + interval '1 day')",
      [createHash('sha256').update(token).digest('hex'), id],
    )
    cookies[id] = 'jalon_session=' + token
  }
  let failDelivery = false
  const messages = []
  const app = createApp(db, undefined, { send: async (message, options) => { if (failDelivery) throw new Error('fallo simulado'); messages.push({ ...message, ...options }) }, origin: 'http://127.0.0.1' })
  const server = app.listen(0, '127.0.0.1')
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await db.close()
  })
  await once(server, 'listening')
  const base = 'http://127.0.0.1:' + server.address().port
  async function request(path, { user = 'demo-passenger', method = 'GET', body } = {}) {
    const response = await fetch(base + path, {
      method, headers: { ...(user && { Cookie: cookies[user] }), ...(body && { 'Content-Type': 'application/json' }) },
      body: body ? JSON.stringify(body) : undefined,
    })
    return { status: response.status, data: await response.json() }
  }
  let incident
  await t.test('CP-F031 reporta un participante y limita la bandeja al remitente y Movilidad', async () => {
    const body = { tripId: 'demo-close', category: 'conducta', description: 'Incidente de prueba para revisión.' }
    const created = await request('/api/incidents', { method: 'POST', body })
    assert.equal(created.status, 201)
    incident = created.data.id
    assert.equal((await request('/api/incidents', { user: 'demo-mobility' })).data.length, 1)
    assert.equal((await request('/api/incidents', { user: 'demo-driver' })).data.length, 0)
    assert.equal((await request('/api/incidents', { user: 'outsider', method: 'POST', body })).status, 403)
    assert.equal((await request('/api/incidents', { user: 'demo-second', method: 'POST', body })).status, 403)
    assert.equal((await request('/api/incidents', { user: null })).status, 401)
    assert.equal((await request('/api/incidents', { method: 'POST', body: { ...body, description: '' } })).status, 400)
  })

await t.test('CP-F032 solo Movilidad resuelve una vez y el remitente ve la decisión', async () => {
    const body = { decision: 'atendido', resolution: 'Se revisó el incidente y se registró la decisión.' }
    const path = '/api/incidents/' + incident + '/resolve'
    assert.equal((await request(path, { method: 'POST', body })).status, 403)
    const results = await Promise.all([1, 2].map(() => request(path, { user: 'demo-mobility', method: 'POST', body })))
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409])
    const report = (await request('/api/incidents')).data[0]
    assert.equal(report.status, 'Resuelto')
    assert.equal(report.resolution, body.resolution)
    assert.equal(report.reviewer, 'Coordinación de Movilidad')
  })

await t.test('CP-F033 guarda el evento con la transacción y entrega una vez con reintentos', async () => {
    await db.exec("UPDATE users SET trip_email_opt_in = true WHERE id = 'demo-passenger'")
    await db.exec("UPDATE reservations SET status = 'Rechazada' WHERE id = 'demo-b-start'")
    assert.equal((await db.query('SELECT count(*)::int AS n FROM trip_notifications')).rows[0].n, 0)
    await db.exec("UPDATE reservations SET status = 'Rechazada' WHERE id = 'demo-b-expire'")
    failDelivery = true
    await app.locals.procesarAvisos()
    assert.equal(messages.length, 0)
    assert.equal((await request('/api/notifications')).data[0].status, 'Pendiente')
    failDelivery = false
    await db.exec("UPDATE trip_notifications SET next_attempt_at = NOW()")
    await Promise.all([app.locals.procesarAvisos(), app.locals.procesarAvisos()])
    assert.equal(messages.length, 1)
    assert.ok(messages[0].idempotencyKey.startsWith('jalon/'))
    await db.exec("UPDATE reservations SET status = 'Rechazada' WHERE id = 'demo-b-expire'")
    await app.locals.procesarAvisos()
    assert.equal(messages.length, 1)
    assert.equal((await request('/api/notifications', { user: 'outsider' })).data.length, 0)
    await assert.rejects(db.transaction(async tx => {
      await tx.exec("UPDATE reservations SET status = 'Cancelada' WHERE id = 'demo-b-cancel'")
      throw new Error('rollback')
    }))
    assert.equal((await db.query('SELECT count(*)::int AS n FROM trip_notifications')).rows[0].n, 1)
    await db.exec("UPDATE reservations SET status = 'Cancelada' WHERE id = 'demo-b-cancel'")
    await db.exec("UPDATE users SET trip_email_opt_in = false WHERE id = 'demo-passenger'")
    await app.locals.procesarAvisos()
    assert.equal(messages.length, 1)
    assert.ok((await request('/api/notifications')).data.some(n => n.status === 'Omitido'))
    await db.exec("UPDATE reservations SET status = 'Confirmada' WHERE id = 'demo-b-cancel'")
  })

await t.test('CP-F034 el catálogo conserva coordenadas y el esquema mantiene una lista ordenada', async () => {
    assert.ok(paradas.every(stop => Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude)))
    const ordered = mapPoints(['usc', 'melendez', 'lido'])
    assert.deepEqual(ordered.map(stop => stop.id), ['usc', 'melendez', 'lido'])
    assert.ok(ordered.every(stop => stop.x >= 80 && stop.x <= 560 && stop.y >= 60 && stop.y <= 220))
    assert.deepEqual(mapPoints(['unknown', 'usc']), [])
    assert.equal(mapPoints(['melendez', 'usc']).length, 2)
  })

await t.test('CP-F035 radio inclusivo con Haversine y acceso autenticado', async () => {
    const latitude = meters => meters / 6371000 * 180 / Math.PI
    const stops = [
      { id: 'edge', latitude: latitude(800), longitude: 0 },
      { id: 'outside', latitude: latitude(801), longitude: 0 },
    ]
    assert.deepEqual(nearbyStops(stops, { latitude: 0, longitude: 0 }, 800).map(s => s.id), ['edge'])
    const query = new URLSearchParams({ latitude: paradas[0].latitude, longitude: paradas[0].longitude, radius: '800' })
    const result = await request('/api/stops/nearby?' + query)
    assert.equal(result.status, 200)
    assert.equal(result.data[0].id, 'melendez')
    assert.ok(result.data.every(stop => stop.distanceMeters <= 800 + 1e-7))
    assert.equal((await request('/api/stops/nearby?' + query, { user: null })).status, 401)
    assert.equal((await request('/api/stops/nearby?latitude=&longitude=0&radius=800')).status, 400)
    assert.equal((await request('/api/stops/nearby?latitude=91&longitude=0&radius=800')).status, 400)
  })

await t.test('CP-F036 persiste asistencia antes del cierre y bloquea reservas o actores inválidos', async () => {
    const path = '/api/trips/demo-close/attendance'
    const body = { asistencia: [{ id: 'demo-b-close', attendance: 'Abordo' }] }
    assert.equal((await request(path, { user: 'demo-driver', method: 'PATCH', body })).status, 409)
    assert.equal((await request('/api/trips/demo-close/start', { user: 'demo-driver', method: 'POST' })).status, 200)
    assert.equal((await request(path, { user: 'outsider', method: 'PATCH', body })).status, 403)
    assert.equal((await request(path, { user: 'demo-driver', method: 'PATCH', body: {
      asistencia: [{ id: 'demo-b-start', attendance: 'Abordo' }],
    } })).status, 400)
    assert.equal((await request(path, { user: 'demo-driver', method: 'PATCH', body })).status, 200)
    const saved = await request('/api/trips/demo-close/cierre', { user: 'demo-driver' })
    assert.equal(saved.data.reservas[0].attendance, 'Abordo')
    assert.equal((await request('/api/trips/demo-close/finish', {
      user: 'demo-driver', method: 'POST', body: { asistencia: [] },
    })).status, 200)
    assert.equal((await request(path, { user: 'demo-driver', method: 'PATCH', body })).status, 409)
  })

await t.test('CP-F037 distingue 59 y 60 minutos, no duplica y aplica suspensión por tres advertencias', async () => {
    const now = Date.now()
    assert.equal(lateCancellation(new Date(now + 59 * 60000), now), true)
    assert.equal(lateCancellation(new Date(now + 60 * 60000), now), false)
    assert.equal(lateCancellation(undefined, now), false)
    await db.transaction(async tx => {
      for (const id of ['demo-b-cancel', 'demo-b-close', 'demo-b-expire']) {
        await registrarAdvertencia(tx, { id, passenger_id: 'demo-passenger' }, 'ausencia')
      }
      await registrarAdvertencia(tx, { id: 'demo-b-close', passenger_id: 'demo-passenger' }, 'ausencia')
    })
    const report = (await request('/api/penalties')).data
    assert.equal(report.activeWarnings, 3)
    assert.equal(report.suspended, true)
    assert.equal(report.warnings.length, 3)
    assert.equal((await request('/api/penalties', { user: 'outsider' })).data.warnings.length, 0)
    assert.equal((await request('/api/trips/demo-search/reservations', {
      method: 'POST', body: { origin: 'melendez', destination: 'usc' },
    })).status, 403)
    await db.exec("UPDATE booking_warnings SET created_at = NOW() - interval '31 days'")
    await db.exec("UPDATE users SET suspended_until = NOW() - interval '1 minute' WHERE id = 'demo-passenger'")
    assert.equal((await request('/api/penalties')).data.activeWarnings, 0)
    assert.equal((await request('/api/penalties')).data.suspended, false)
  })

await t.test('CP-F038 promedio con un decimal, cantidad, perfil sin notas y privacidad', async () => {
    await db.exec("UPDATE reservations SET status = 'Confirmada', attendance = 'Abordo' WHERE id = 'demo-b-start'")
    const rate = (user, stars) => request('/api/reservations/' +
      (user === 'demo-passenger' ? 'demo-b-close' : 'demo-b-start') + '/rating', {
      user, method: 'POST', body: { stars, review: 'Reseña para comprobar el promedio.' },
    })
    assert.equal((await rate('demo-passenger', 4)).status, 201)
    assert.equal((await rate('demo-second', 5)).status, 201)
    const result = (await request('/api/reputation/demo-driver')).data
    assert.equal(result.average, 4.5)
    assert.equal(result.count, 2)
    assert.equal(result.email, undefined)
    const empty = (await request('/api/reputation/mine', { user: 'outsider' })).data
    assert.equal(empty.count, 0)
    assert.equal(empty.average, null)
    assert.equal((await request('/api/reputation/demo-driver', { user: null })).status, 401)
    assert.equal((await request('/api/reputation/no-existe')).status, 404)
    const query = new URLSearchParams({ origin: 'melendez', destination: 'usc' })
    assert.equal((await request('/api/trips/demo-search?' + query)).data.driverId, undefined)
    const tripSummary = (await request('/api/trips/demo-search/reputation')).data
    assert.deepEqual(tripSummary, { count: 2, average: 4.5 })
  })

await t.test('sitio web sin manifest, instalación ni caché de aplicación', async () => {
    const html = await readFile(new URL('../index.html', import.meta.url), 'utf8')
    const main = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8')
    assert.doesNotMatch(html, /rel="manifest"|apple-mobile-web-app-capable|apple-touch-icon/)
    assert.doesNotMatch(main, /Instalacion|registerApp|beforeinstallprompt/)
    const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8')
    assert.match(source, /registration\.unregister/)
    assert.doesNotMatch(source, /addEventListener\('fetch'/)
    const response = await fetch(base + '/api/session', { headers: { Cookie: cookies['demo-passenger'] } })
    assert.match(response.headers.get('cache-control'), /no-store/)
    await response.json()
  })

})
