import test from 'node:test'
import { logRequestError } from '../server/registro.js'
import assert from 'node:assert/strict'
import { createServer as httpsServer, request as httpsRequest } from 'node:https'
import { readFile } from 'node:fs/promises'
import { once } from 'node:events'
import { createHash, randomBytes, argon2 } from 'node:crypto'
import { promisify } from 'node:util'
import { createApp } from '../server/app.js'
import { openDatabase } from '../server/db.js'
import { seedDemo } from '../test-support/demo.js'
import { hashPassword, verifyPassword } from '../server/auth.js'

test('Atributos de calidad del MVP', async t => {
  const db = await openDatabase()
  await seedDemo(db)
  const tokens = {}
  for (const id of ['demo-driver', 'demo-passenger', 'demo-second', 'demo-mobility']) {
    const token = randomBytes(32).toString('hex')
    tokens[id] = 'jalon_session=' + token
    await db.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, NOW() + interval '1 hour')",
      [createHash('sha256').update(token).digest('hex'), id])
  }
  const app = createApp(db, undefined, null)
  const server = app.listen(0, '127.0.0.1')
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await db.close() })
  await once(server, 'listening')
  const base = 'http://127.0.0.1:' + server.address().port
  async function request(path, { user = 'demo-passenger', method = 'GET', body, headers = {} } = {}) {
    const response = await fetch(base + path, {
      method, headers: { ...(user && { Cookie: tokens[user] }), ...(body && { 'Content-Type': 'application/json' }), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    })
    return { status: response.status, headers: response.headers, data: await response.json() }
  }

  await t.test('RNF-001 invalida resultados al confirmar cupos y mantiene la privacidad', async () => {
    const query = new URLSearchParams({ origin: 'melendez', destination: 'usc' })
    const trip = (await request('/api/trips/demo-search?' + query)).data
    const date = trip.boardAt.slice(0, 10)
    const url = '/api/trips/search?' + new URLSearchParams({ origin: 'melendez', destination: 'usc', date })
    const first = await request(url)
    assert.equal(first.status, 200)
    await db.exec("UPDATE trips SET capacity = 1 WHERE id = 'demo-search'")
    const next = await request(url)
    assert.equal(next.data.items.find(item => item.id === 'demo-search').availableSeats, 1)
    assert.equal((await request(url, { user: 'demo-driver' })).status, 403)
    assert.equal(next.data.items[0].driverId, undefined)
  })

await t.test('RNF-002 un evento autorizado conserva la fecha persistida y excluye a terceros', async () => {
    const controller = new AbortController()
    const response = await fetch(base + '/api/trips/events', { headers: { Cookie: tokens['demo-passenger'] }, signal: controller.signal })
    const reader = response.body.getReader()
    let buffer = ''
    async function nextEvent(name) {
      while (true) {
        const boundary = buffer.indexOf('\n\n')
        if (boundary >= 0) {
          const raw = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          if (raw.includes('event: ' + name)) return JSON.parse(raw.match(/data: (.*)/)[1])
        } else {
          const result = await reader.read()
          if (result.done) throw new Error('SSE cerrado')
          buffer += new TextDecoder().decode(result.value)
        }
      }
    }
    await nextEvent('ready')
    const body = { origin: 'melendez', destination: 'usc' }
    const created = await request('/api/trips/demo-search/reservations', { method: 'POST', body })
    assert.equal(created.status, 201)
    const event = await nextEvent('reservation-changed')
    const stored = (await db.query('SELECT changed_at FROM reservations WHERE id = $1', [created.data.id])).rows[0]
    assert.equal(new Date(event.persistedAt).getTime(), new Date(stored.changed_at).getTime())
    assert.ok(Date.now() - Date.parse(event.persistedAt) < 2000)
    controller.abort()
    await reader.cancel().catch(() => {})
  })

await t.test('RNF-003 producción exige HTTPS incluso con cabeceras falsificadas', async () => {
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    let secureApp
    try { secureApp = createApp(db, undefined, null) }
    finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous }
    const insecure = secureApp.listen(0, '127.0.0.1')
    await once(insecure, 'listening')
    try {
      const response = await fetch('http://127.0.0.1:' + insecure.address().port + '/api/session', {
        headers: { Cookie: tokens['demo-passenger'], 'X-Forwarded-Proto': 'https' },
      })
      assert.equal(response.status, 426)
    } finally { insecure.closeAllConnections(); await new Promise(resolve => insecure.close(resolve)) }
    const secure = httpsServer({
      key: await readFile(new URL('./tls-key.pem', import.meta.url)),
      cert: await readFile(new URL('./tls-cert.pem', import.meta.url)),
    }, secureApp).listen(0, '127.0.0.1')
    await once(secure, 'listening')
    try {
      const result = await new Promise((resolve, reject) => {
        const req = httpsRequest({
          host: '127.0.0.1', port: secure.address().port, path: '/api/session',
          rejectUnauthorized: false, headers: { Cookie: tokens['demo-passenger'] },
        }, response => { response.resume(); response.on('end', () => resolve(response)) })
        req.on('error', reject)
        req.end()
      })
      assert.equal(result.statusCode, 200)
      assert.match(result.headers['strict-transport-security'], /max-age=/)
      assert.equal(result.headers['x-content-type-options'], 'nosniff')
      const login = await new Promise((resolve, reject) => {
        const req = httpsRequest({ host: '127.0.0.1', port: secure.address().port, path: '/api/login',
          method: 'POST', rejectUnauthorized: false, headers: { 'Content-Type': 'application/json' },
        }, response => { response.resume(); response.on('end', () => resolve(response)) })
        req.on('error', reject)
        req.end(JSON.stringify({ email: 'pasajero.demo@usc.edu.co', password: 'JalonDemo-2026!' }))
      })
      assert.equal(login.statusCode, 200)
      const cookie = login.headers['set-cookie'][0]
      assert.match(cookie, /Secure/)
      assert.match(cookie, /HttpOnly/)
      assert.match(cookie, /SameSite=Lax/)

    } finally { secure.closeAllConnections(); await new Promise(resolve => secure.close(resolve)) }
  })

await t.test('RNF-004 Argon2id con sales individuales y verificación de claves históricas', async () => {
    const password = 'Prueba-Hash-Calidad-2026'
    const first = await hashPassword(password)
    const second = await hashPassword(password)
    assert.notEqual(first, second)
    const [salt, digest] = first.split(':')
    const expected = await promisify(argon2)('argon2id', {
      message: Buffer.from(password), nonce: Buffer.from(salt, 'hex'), parallelism: 1,
      tagLength: 32, memory: 19456, passes: 2,
    })
    assert.equal(expected.toString('hex'), digest)
    assert.equal(await verifyPassword(password, first), true)
    assert.equal(await verifyPassword(password + 'x', first), false)
    assert.equal(await verifyPassword('short', first), false)
    assert.equal(await verifyPassword(null, first), false)
    assert.equal(await verifyPassword(password, null), false)
    assert.equal(await verifyPassword(password, 'corrupto'), false)
    await assert.rejects(hashPassword('corta'))
    await assert.rejects(hashPassword('x'.repeat(129)))
    await assert.rejects(hashPassword(null))
  })

await t.test('RNF-005 matriz de escrituras protegidas sin sesión, rol o propiedad', async () => {
    const cases = [
      ['/api/vehicles', { plate: 'XXX987', seats: 3, efficiency: 40 }],
      ['/api/movilidad/solicitudes/inexistente', { decision: 'approved', code: '20260001', role: 'estudiante' }],
      ['/api/trips/demo-search/cancel', { reason: 'Cambio de horario para la prueba' }],
      ['/api/incidents/inexistente/resolve', { resolution: 'Resuelto sin permiso' }],
    ]
    const snapshot = async () => JSON.stringify((await db.query("SELECT id, status, capacity FROM trips ORDER BY id")).rows)
    const before = await snapshot()
    for (const [path, body] of cases) {
      assert.equal((await request(path, { user: null, method: 'POST', body })).status, 401)
      const denied = await request(path, { user: 'demo-passenger', method: 'POST', body })
      assert.ok([403, 404].includes(denied.status), path + ': ' + denied.status)
    }
    assert.equal(await snapshot(), before)
  })

await t.test('RNF-006 cookies de sesión y revocación tras cierre', async () => {
    const login = await request('/api/login', { user: null, method: 'POST', body: {
      email: 'invitado.demo@usc.edu.co', password: 'JalonDemo-2026!',
    } })
    assert.equal(login.status, 200)
    const cookie = login.headers.get('set-cookie')
    assert.match(cookie, /HttpOnly/i)
    assert.match(cookie, /SameSite=Lax/i)
    assert.match(cookie, /Path=\//)
    const token = cookie.split(';')[0]
    const closed = await fetch(base + '/api/logout', { method: 'POST', headers: {
      Cookie: token, 'Content-Type': 'application/json',
    }, body: '{}' })
    assert.equal(closed.status, 204)
    assert.match(closed.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/i)
    assert.equal((await fetch(base + '/api/session', { headers: { Cookie: token } })).status, 401)
  })

await t.test('RNF-007 cinco fallos bloquean quince minutos y el vencimiento permite acceso', async () => {
    const body = { email: 'invitado.demo@usc.edu.co', password: 'incorrecta-2026' }
    for (let i = 0; i < 4; i++) assert.equal((await request('/api/login', { user: null, method: 'POST', body })).status, 401)
    assert.equal((await request('/api/login', { user: null, method: 'POST', body })).status, 429)
    body.password = 'JalonDemo-2026!'
    assert.equal((await request('/api/login', { user: null, method: 'POST', body })).status, 429)
    const digest = createHash('sha256').update(body.email).digest('hex')
    const blocked = (await db.query('SELECT blocked_until > NOW() + interval \'14 minutes\' AS valid FROM login_attempts WHERE account_hash = $1', [digest])).rows[0]
    assert.equal(blocked.valid, true)
    await db.query("UPDATE login_attempts SET blocked_until = NOW() - interval '1 second' WHERE account_hash = $1", [digest])
    assert.equal((await request('/api/login', { user: null, method: 'POST', body })).status, 200)
    assert.equal((await db.query('SELECT * FROM login_attempts WHERE account_hash = $1', [digest])).rows.length, 0)
  })

await t.test('RNF-008 la identificación del vehículo no expone correos ni credenciales', async () => {
    const detail = await request('/api/trips/demo-search?origin=melendez&destination=usc')
    const date = detail.data.boardAt.slice(0, 10)
    const search = await request('/api/trips/search?' + new URLSearchParams({ origin: 'melendez', destination: 'usc', date }))
    const forbidden = new Set(['email', 'phone', 'telephone', 'code', 'password', 'token_hash', 'driverId', 'user_id'])
    function inspect(value) {
      if (!value || typeof value !== 'object') return
      for (const [key, child] of Object.entries(value)) {
        assert.equal(forbidden.has(key), false, 'Dato privado: ' + key)
        inspect(child)
      }
    }
    inspect(detail.data); inspect(search.data)
    assert.doesNotMatch(JSON.stringify(search.data), /@usc\.edu\.co/)
  })

await t.test('RNF-009 demostración aislada con identidades sintéticas', async () => {
    const users = (await db.query('SELECT id, email FROM users')).rows
    assert.ok(users.length >= 4)
    assert.ok(users.every(user => user.id.startsWith('demo-') && user.email.endsWith('.demo@usc.edu.co')))
    const plates = (await db.query('SELECT plate FROM vehicles')).rows
    assert.ok(plates.every(row => /^[A-Z]{3}[0-9]{3}$/.test(row.plate)))
  })

await t.test('RNF-010 registro de errores sin claves, cookies ni texto de incidentes', () => {
    const saved = console.error
    const messages = []
    console.error = value => messages.push(value)
    try {
      logRequestError({ code: '23505', message: 'clave-privada', cookie: 'jalon_session=secreto', incident: 'texto privado' })
      logRequestError({ code: 'texto privado' })
    } finally { console.error = saved }
    assert.equal(JSON.parse(messages[0]).code, '23505')
    assert.equal(JSON.parse(messages[1]).code, 'INTERNAL')
    assert.doesNotMatch(messages.join(''), /clave-privada|secreto|texto privado|cookie|incident/)
  })

await t.test('RNF-023 veinte cierres simultáneos guardan una liquidación y una advertencia por ausencia', async () => {
    const start = await request('/api/trips/demo-close/start', { user: 'demo-driver', method: 'POST', body: {} })
    assert.equal(start.status, 200)
    const options = { user: 'demo-driver', method: 'POST', body: { asistencia: [{ id: 'demo-b-close', attendance: 'Ausente' }] } }
    const responses = await Promise.all(Array.from({ length: 20 }, () => request('/api/trips/demo-close/finish', options)))
    assert.ok(responses.every(result => result.status === 200), JSON.stringify(responses))
    for (const response of responses) assert.deepEqual(response.data, responses[0].data)
    const stored = (await db.query("SELECT liquidation, status FROM trips WHERE id = 'demo-close'")).rows[0]
    assert.equal(stored.status, 'Completado')
    assert.deepEqual(stored.liquidation, responses[0].data.liquidation)
    const warnings = (await db.query("SELECT count(*)::int AS n FROM booking_warnings WHERE reservation_id = 'demo-b-close' AND reason = 'ausencia'")).rows[0]
    assert.equal(warnings.n, 1)
  })

})
