import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { createApp } from '../server/app.js'
import { openDatabase } from '../server/db.js'
import { seedDemo } from '../server/demo.js'

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
  const messages = []
  const app = createApp(db, undefined, { send: async message => messages.push(message), origin: 'http://127.0.0.1' })
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
    assert.equal(report.reviewer, 'Movilidad Demo')
  })

})
