import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createHash, randomBytes, argon2 } from 'node:crypto'
import { promisify } from 'node:util'
import { createApp } from '../server/app.js'
import { openDatabase } from '../server/db.js'
import { seedDemo } from '../server/demo.js'
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
    assert.equal((await request(url, { user: 'demo-driver' })).data.items.length, 0)
    assert.equal(next.data.items[0].driverId, undefined)
  })

})
