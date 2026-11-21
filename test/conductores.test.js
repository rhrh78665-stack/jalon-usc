import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createApp } from '../server/app.js'
import { hashPassword } from '../server/auth.js'
import { openDatabase } from '../server/db.js'

test('CP-F005 Habilitar conductor', async t => {
    const db = await openDatabase()
    const server = createApp(db).listen(0, '127.0.0.1')

    t.after(async () => {
        server.closeAllConnections()
        await new Promise(resolve => server.close(resolve))
        await db.close()
    })

    await once(server, 'listening')

    const base = `http://127.0.0.1:${server.address().port}`
    const path = '/api/movilidad/conductores'
    const password = 'Jalon-Prueba-2026'
    const hash = await hashPassword(password)

    await db.query(
        `INSERT INTO users (id, email, password, status, mobility) VALUES
      ('admin', 'movilidad@usc.edu.co', $1, 'approved', true),
      ('member', 'conductor@usc.edu.co', $1, 'approved', false),
      ('pending', 'pendiente@usc.edu.co', $1, 'pending', false)`,
        [hash],
    )

    function request(route, cookie, body) {
        return fetch(base + route, {
            method: body ? 'POST' : 'GET',
            headers: {
                ...(cookie ? { Cookie: cookie } : {}),
                ...(body ? { 'Content-Type': 'application/json' } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
        })
    }

    async function login(email) {
        const response = await request('/api/login', null, { email, password })
        assert.equal(response.status, 200)
        await response.json()
        return response.headers.get('set-cookie').split(';')[0]
    }

    const admin = await login('movilidad@usc.edu.co')
    const member = await login('conductor@usc.edu.co')
    const { rows: [dates] } = await db.query(
        `SELECT to_char((CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')::date + 1, 'YYYY-MM-DD') AS valid,
            to_char((CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')::date - 1, 'YYYY-MM-DD') AS expired`,
    )

    assert.equal((await request(path)).status, 401)
    assert.equal((await request(path + '/member', member, { expiresOn: dates.valid })).status, 403)
    assert.equal((await request(path + '/pending', admin, { expiresOn: dates.valid })).status, 409)
    assert.equal((await request(path + '/member', admin, { expiresOn: '2025-02-29' })).status, 400)
    assert.equal((await request(path + '/member', admin, { expiresOn: dates.expired })).status, 409)
    assert.equal((await db.query('SELECT user_id FROM driver_permissions')).rows.length, 0)

    const response = await request(path + '/member', admin, { expiresOn: dates.valid })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { id: 'member', expiresOn: dates.valid, enabled: true })

    assert.equal((await request(path + '/member', admin, { expiresOn: dates.expired })).status, 409)

    const listing = await request(path, admin)
    assert.equal(listing.status, 200)
    assert.deepEqual(await listing.json(), [
        { id: 'member', email: 'conductor@usc.edu.co', expiresOn: dates.valid, enabled: true },
    ])

    const { rows } = await db.query('SELECT user_id, reviewer_id FROM driver_permissions')
    assert.deepEqual(rows, [{ user_id: 'member', reviewer_id: 'admin' }])

    await db.query(
        "UPDATE driver_permissions SET license_expires_on = $1::date WHERE user_id = 'member'",
        [dates.expired],
    )

    const expiredListing = await request(path, admin)
    assert.equal(expiredListing.status, 200)
    assert.equal((await expiredListing.json())[0].enabled, false)
})