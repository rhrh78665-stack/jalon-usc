import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createApp } from '../server/app.js'
import { hashPassword } from '../server/auth.js'
import { openDatabase } from '../server/db.js'

test('CP-F004 Revisar vinculación', async t => {
  const db = await openDatabase()
  const server = createApp(db).listen(0, '127.0.0.1')

  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await db.close()
  })

  await once(server, 'listening')

  const base = `http://127.0.0.1:${server.address().port}`
  const path = '/api/movilidad/solicitudes'
  const password = 'Jalon-Prueba-2026'
  const hash = await hashPassword(password)

  await db.query(
    `INSERT INTO users (id, email, password, status, mobility) VALUES
      ('admin', 'movilidad@usc.edu.co', $1, 'approved', true),
      ('member', 'miembro@usc.edu.co', $1, 'approved', false),
      ('pending-a', 'solicitud.a@usc.edu.co', $1, 'pending', false),
      ('pending-b', 'solicitud.b@usc.edu.co', $1, 'pending', false)`,
    [hash],
  )

  function request(route, cookie, data) {
    return fetch(base + route, {
      method: data ? 'POST' : 'GET',
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(data ? { 'Content-Type': 'application/json' } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    })
  }

  async function login(email) {
    const response = await request('/api/login', null, { email, password })
    assert.equal(response.status, 200)
    await response.json()
    return response.headers.get('set-cookie').split(';')[0]
  }

  const adminCookie = await login('movilidad@usc.edu.co')
  const memberCookie = await login('miembro@usc.edu.co')
  const approval = { code: '20260001', role: 'estudiante', decision: 'approved' }
  const review = (id, data, cookie = adminCookie) => request(path + '/' + id, cookie, data)

  assert.equal((await request(path)).status, 401)
  assert.equal((await request(path, memberCookie)).status, 403)
  assert.equal((await review('pending-a', approval, memberCookie)).status, 403)

  const pending = await request(path, adminCookie)
  assert.equal(pending.status, 200)
  assert.deepEqual((await pending.json()).map(user => user.id), ['pending-a', 'pending-b'])

  assert.equal((await review('pending-a', { ...approval, role: 'docente' })).status, 409)
  assert.equal((await request('/api/login', null, { email: 'solicitud.a@usc.edu.co', password })).status, 401)

  const accepted = await review('pending-a', approval)
  assert.equal(accepted.status, 200)
  assert.deepEqual(await accepted.json(), { status: 'approved' })
  await login('solicitud.a@usc.edu.co')

  assert.equal((await review('pending-b', approval)).status, 409)

  const rejected = await review('pending-b', { ...approval, decision: 'rejected' })
  assert.equal(rejected.status, 200)
  assert.deepEqual(await rejected.json(), { status: 'rejected' })
  assert.equal((await request('/api/login', null, { email: 'solicitud.b@usc.edu.co', password })).status, 401)

  const { rows } = await db.query(
    'SELECT user_id, reviewer_id, code, declared_role, decision FROM membership_reviews ORDER BY user_id',
  )

  assert.deepEqual(rows, [
    { user_id: 'pending-a', reviewer_id: 'admin', code: '20260001', declared_role: 'estudiante', decision: 'approved' },
    { user_id: 'pending-b', reviewer_id: 'admin', code: '20260001', declared_role: 'estudiante', decision: 'rejected' },
  ])
})
