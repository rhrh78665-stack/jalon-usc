import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createApp } from '../server/app.js'
import { openDatabase } from '../server/db.js'

test('CP-F001 Registro de una cuenta', async (suite) => {
    const db = await openDatabase()
    const server = createApp(db).listen(0, '127.0.0.1')
    await once(server, 'listening')

    suite.after(async () => {
        server.closeAllConnections()
        await new Promise((resolve) => server.close(resolve))
        await db.close()
    })

    const endpoint = `http://127.0.0.1:${server.address().port}/api/register`
    const password = 'Campus-De-Prueba-24'

    function register(email, candidatePassword = password) {
        return fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password: candidatePassword }),
        })
    }

    await suite.test('normaliza el correo y persiste una cuenta pendiente con hash', async () => {
        const response = await register('  Prueba@USC.EDU.CO  ')

        assert.equal(response.status, 201)
        assert.deepEqual(await response.json(), { status: 'pending' })

        const { rows: [user] } = await db.query('SELECT email, status, password FROM users')
        assert.equal(user.email, 'prueba@usc.edu.co')
        assert.equal(user.status, 'pending')
        assert.match(user.password, /^[a-f0-9]{32}:[a-f0-9]{64}$/)
        assert.notEqual(user.password, password)
    })

    await suite.test('rechaza dominios externos y contraseña corta sin crear cuentas', async () => {
        const [outside, short] = await Promise.all([
            register('prueba@usc.edu.co.example.com'),
            register('otra@usc.edu.co', 'corta'),
        ])

        assert.equal(outside.status, 400)
        assert.equal(short.status, 400)

        const { rows } = await db.query('SELECT email FROM users')
        assert.deepEqual(rows, [{ email: 'prueba@usc.edu.co' }])
    })

    await suite.test('el mismo correo solo se puede registrar una vez', async () => {
        const responses = await Promise.all([
            register('segunda@usc.edu.co'),
            register('SEGUNDA@USC.EDU.CO'),
        ])

        assert.deepEqual(responses.map(({ status }) => status).sort(), [201, 409])

        const { rows } = await db.query('SELECT email FROM users ORDER BY email')
        assert.deepEqual(rows, [
            { email: 'prueba@usc.edu.co' },
            { email: 'segunda@usc.edu.co' },
        ])
    })
})