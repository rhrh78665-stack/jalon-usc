import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createApp } from '../server/app.js'
import { hashPassword } from '../server/auth.js'
import { openDatabase } from '../server/db.js'

test('CP-F003 Cerrar sesión', async t => {
  const db = await openDatabase()
  const server = createApp(db).listen(0, '127.0.0.1')

  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await db.close()
  })

  await once(server, 'listening')

  const base = `http://127.0.0.1:${server.address().port}`
  const email = 'salida@usc.edu.co'
  const password = 'Jalon-Prueba-2026'

  await db.query(
    "INSERT INTO users (id, email, password, status) VALUES ('logout-user', $1, $2, 'approved')",
    [email, await hashPassword(password)],
  )

  const login = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })

  assert.equal(login.status, 200)
  await login.json()

  const cookieHeader = login.headers.get('set-cookie')
  assert.ok(cookieHeader)

  const cookie = cookieHeader.split(';')[0]
  const session = () => fetch(base + '/api/session', {
    headers: { Cookie: cookie },
  })

  const active = await session()
  assert.equal(active.status, 200)
  assert.deepEqual(await active.json(), { email })

  const logout = () => fetch(base + '/api/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: '{}',
  })

  const closed = await logout()
  assert.equal(closed.status, 204)

  const cleared = closed.headers.get('set-cookie')
  assert.match(cleared, /^jalon_session=;/)
  assert.match(cleared, /Expires=Thu, 01 Jan 1970 00:00:00 GMT/i)

  const reused = await session()
  assert.equal(reused.status, 401)
  await reused.json()

  const repeated = await logout()
  assert.equal(repeated.status, 204)
})
