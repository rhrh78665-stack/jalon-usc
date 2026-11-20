import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { openDatabase } from '../server/db.js'
import { hashPassword } from '../server/auth.js'
import { createApp } from '../server/app.js'

test('CP-F002 Iniciar sesión', async (suite) => {
    const db = await openDatabase()
    const server = createApp(db).listen(0, '127.0.0.1')
    await once(server, 'listening')

    suite.after(async () => {
        server.closeAllConnections()
        await new Promise(resolve => server.close(resolve))
        await db.close()
    })

    const base = `http://127.0.0.1:${server.address().port}`
    const email = 'aprobada@usc.edu.co'
    const pending = 'pendiente@usc.edu.co'
    const password = 'Jalon-Prueba-2026'

    await db.query(
        `INSERT INTO users (id, email, password, status)
     VALUES ('u1', $1, $2, 'approved'), ('u2', $3, $4, 'pending')`,
        [email, await hashPassword(password), pending, await hashPassword(password)],
    )

    const login = (address, pass, cookie) => fetch(base + '/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: JSON.stringify({ email: address, password: pass }),
    })

    const session = cookie => fetch(base + '/api/session', {
        headers: { Cookie: cookie },
    })

    await suite.test('rechaza una cuenta pendiente y una contraseña incorrecta', async () => {
        for (const [address, pass] of [[pending, password], [email, 'Contraseña-incorrecta']]) {
            const response = await login(address, pass)
            assert.equal(response.status, 401)
            assert.equal(response.headers.get('set-cookie'), null)
            await response.json()
        }

        const { rows } = await db.query('SELECT token_hash FROM sessions')
        assert.equal(rows.length, 0)
    })

    await suite.test('autentica una cuenta aprobada y renueva el identificador', async () => {
        const first = await login(email, password)
        assert.equal(first.status, 200)
        assert.deepEqual(await first.json(), { email })

        const header = first.headers.get('set-cookie')
        assert.match(header, /HttpOnly/i)
        assert.match(header, /SameSite=Lax/i)
        const oldCookie = header.split(';')[0]

        const active = await session(oldCookie)
        assert.equal(active.status, 200)
        assert.deepEqual(await active.json(), { email })

        const second = await login(email, password, oldCookie)
        assert.equal(second.status, 200)
        await second.json()
        const newCookie = second.headers.get('set-cookie').split(';')[0]

        assert.notEqual(oldCookie, newCookie)
        assert.equal((await session(oldCookie)).status, 401)
        assert.equal((await session(newCookie)).status, 200)
    })
})