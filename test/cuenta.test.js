import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { createApp } from '../server/app.js'
import { hashPassword } from '../server/auth.js'
import { openDatabase } from '../server/db.js'

test('Cuenta RF-007 a RF-009', async t => {
  const db = await openDatabase()
  const sent = new Map()
  const mail = {
    origin: 'https://jalon.example',
    async send(message) { sent.set(message.subject, message) },
  }
  const server = createApp(db, undefined, mail).listen(0, '127.0.0.1')
  t.after(async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await db.close()
  })
  await once(server, 'listening')

  const base = 'http://127.0.0.1:' + server.address().port
  const oldPassword = 'Jalon-Prueba-2026'
  const newPassword = 'Jalon-Nueva-2026'
  const email = 'titular@usc.edu.co'
  await db.query(
    `INSERT INTO users (id, email, password, status) VALUES
     ('a', $1, $2, 'approved'),
     ('b', 'pendiente@usc.edu.co', $2, 'pending')`,
    [email, await hashPassword(oldPassword)],
  )

  function request(path, { cookie, body, method = body ? 'POST' : 'GET' } = {}) {
    return fetch(base + '/api/' + path, {
      method,
      headers: {
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  }

  const login = password => request('login', { body: { email, password } })
  const response = await login(oldPassword)
  assert.equal(response.status, 200)
  const cookie = response.headers.get('set-cookie').split(';')[0]

  async function requestLink(action, target, subject) {
    sent.delete(subject)
    const response = await request('account/' + action + '/request', { body: { email: target } })
    assert.equal(response.status, 202)

    for (let attempt = 0; !sent.has(subject) && attempt < 100; attempt++) await delay(20)
    const message = sent.get(subject)
    assert.ok(message)
    assert.deepEqual(message.to, [target])
    const url = new URL(message.text.split('\n').at(-1))
    assert.equal(url.origin, mail.origin)
    const params = new URLSearchParams(url.hash.slice(1))
    assert.equal(params.get('action'), action)
    return params.get('token')
  }

  await t.test('CP-F008 Gestionar perfil', async () => {
    const body = { alias: 'Lina', tripEmailOptIn: true }
    assert.equal((await request('profile', { method: 'PUT', body })).status, 401)
    const forbidden = await request('profile', { cookie, method: 'PUT', body: { ...body, id: 'b' } })
    assert.equal(forbidden.status, 400)
    const save = await request('profile', { cookie, method: 'PUT', body })
    assert.equal(save.status, 200)
    assert.deepEqual(await (await request('profile', { cookie })).json(), { email, ...body })
    const { rows } = await db.query("SELECT alias FROM users WHERE id = 'b'")
    assert.equal(rows[0].alias, '')
  })

  await t.test('CP-F009 Verificar correo', async () => {
    const token = await requestLink('verify', 'pendiente@usc.edu.co', 'Verificación de correo en Jalón USC')
    assert.equal((await request('account/recover/confirm', { body: { token, password: newPassword } })).status, 400)
    const confirm = () => request('account/verify/confirm', { body: { token } })
    assert.equal((await confirm()).status, 200)
    assert.equal((await confirm()).status, 400)
    const { rows: [user] } = await db.query("SELECT status, email_verified_at FROM users WHERE id = 'b'")
    assert.equal(user.status, 'pending')
    assert.ok(user.email_verified_at)
  })

  await t.test('CP-F007 Recuperar acceso', async () => {
    const subject = 'Recuperación de acceso a Jalón USC'
    const expired = await requestLink('recover', email, subject)
    await db.exec(`
      UPDATE account_links
      SET expires_at = CURRENT_TIMESTAMP - interval '1 minute',
          issued_at = CURRENT_TIMESTAMP - interval '2 minutes'
      WHERE purpose = 'recover';
    `)
    const reset = token => request('account/recover/confirm', { body: { token, password: newPassword } })
    assert.equal((await reset(expired)).status, 400)
    assert.equal((await login(oldPassword)).status, 200)

    const token = await requestLink('recover', email, subject)
    const attempts = await Promise.all([reset(token), reset(token)])
    assert.deepEqual(attempts.map(response => response.status).sort(), [200, 400])
    assert.equal((await request('session', { cookie })).status, 401)
    assert.equal((await login(oldPassword)).status, 401)
    assert.equal((await login(newPassword)).status, 200)
  })
})
