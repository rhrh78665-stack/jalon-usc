import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { createHash } from 'node:crypto'
import { cpus, totalmem, platform, arch } from 'node:os'
import { createApp } from '../server/app.js'
import { openDatabase } from '../server/db.js'
import { seedDemo } from '../server/demo.js'
import { report } from './report.mjs'

const full = process.argv.includes('--full')
const users = full ? 500 : 20
const tripCount = full ? 2000 : 100
const thinkMilliseconds = Number(process.env.JALON_LOAD_THINK_MS ?? 1000)
if (!Number.isFinite(thinkMilliseconds) || thinkMilliseconds < 0) throw new Error('Pausa inválida.')
const seconds = full ? 300 : Number(process.env.JALON_LOAD_SECONDS || 30)
if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Duración inválida.')
const db = await openDatabase()
let server
try {
  const date = await seedDemo(db)
  await db.exec("DELETE FROM reservations; DELETE FROM trips WHERE id <> 'demo-search';")
  await db.query(`INSERT INTO trips (id, driver_id, vehicle_id, depart_at, capacity, route, status, itinerary, pricing)
    SELECT 'load-' || n, driver_id, vehicle_id, depart_at, capacity, route, status, itinerary, pricing
    FROM trips CROSS JOIN generate_series(1, $1::int) n WHERE id = 'demo-search'`, [tripCount - 1])
  const cookies = []
  for (let index = 0; index < users; index++) {
    const id = 'load-user-' + index
    const token = createHash('sha256').update(id).digest('hex')
    await db.query("INSERT INTO users (id, email, password, status) VALUES ($1, $2, 'synthetic', 'approved')", [id, id + '@usc.edu.co'])
    await db.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, NOW() + interval '1 hour')",
      [createHash('sha256').update(token).digest('hex'), id])
    cookies.push('jalon_session=' + token)
  }
  server = createApp(db, undefined, null).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const url = 'http://127.0.0.1:' + server.address().port + '/api/trips/search?' +
    new URLSearchParams({ origin: 'melendez', destination: 'usc', date })
  const warmup = await fetch(url, { headers: { Cookie: cookies[0] } })
  if (!warmup.ok) throw new Error('No se pudo preparar la búsqueda.')
  await warmup.json()
  const latencies = []
  let errors = 0
  const errorTypes = {}
  const fail = type => { errors++; errorTypes[type] = (errorTypes[type] || 0) + 1 }
  const started = performance.now()
  const deadline = started + seconds * 1000
  await Promise.all(cookies.map(async cookie => {
    while (performance.now() < deadline) {
      const start = performance.now()
      try {
        const response = await fetch(url, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(15000) })
        const body = await response.json()
        if (!response.ok) fail('http-' + response.status)
        else if (body.total !== tripCount || !Array.isArray(body.items)) fail('invalid-result')
      } catch (error) { fail(error.cause?.code || error.name) }
      latencies.push(performance.now() - start)
      if (thinkMilliseconds) await delay(Math.min(thinkMilliseconds, Math.max(0, deadline - performance.now())))
    }
  }))
  latencies.sort((a, b) => a - b)
  const p95 = latencies[Math.max(0, Math.ceil(latencies.length * .95) - 1)]
  const errorRate = errors / latencies.length
  const passed = p95 < 1500 && errorRate <= .01
  await report(full ? 'rnf001-full' : 'rnf001-mvp', {
    criterion: 'RNF-001', profile: full ? '500 usuarios / 2000 viajes / 5 min' : 'MVP 20 usuarios / 100 viajes',
    users, trips: tripCount, thinkMilliseconds, configuredSeconds: seconds, elapsedSeconds: (performance.now() - started) / 1000,
    requests: latencies.length, errors, errorTypes, errorRate, p95Milliseconds: p95, passed,
    machine: { platform: platform(), architecture: arch(), cpus: cpus().length, memoryBytes: totalmem() },
  })
  if (!passed) process.exitCode = 1
} finally {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  await db.close()
}
