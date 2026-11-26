import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createApp } from '../server/app.js'
import { hashPassword } from '../server/auth.js'
import { openDatabase } from '../server/db.js'

test('CP-F006 Registrar vehículo', async t => {
    const db = await openDatabase()
    const server = createApp(db).listen(0, '127.0.0.1')

    t.after(async () => {
        server.closeAllConnections()
        await new Promise(resolve => server.close(resolve))
        await db.close()
    })

    await once(server, 'listening')
    const base = 'http://127.0.0.1:' + server.address().port
    const path = '/api/vehicles'
    const password = 'Jalon-Prueba-2026'

    await db.query(
        `INSERT INTO users (id, email, password, status, mobility) VALUES
      ('admin', 'movilidad@usc.edu.co', $1, 'approved', true),
      ('driver-a', 'conductor.a@usc.edu.co', $1, 'approved', false),
      ('driver-b', 'conductor.b@usc.edu.co', $1, 'approved', false),
      ('member', 'miembro@usc.edu.co', $1, 'approved', false)`,
        [await hashPassword(password)],
    )
    await db.exec(`
    INSERT INTO driver_permissions (user_id, reviewer_id, license_expires_on)
    SELECT id, 'admin', (CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')::date + 1
    FROM users WHERE id IN ('driver-a', 'driver-b');
  `)

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

    const a = await login('conductor.a@usc.edu.co')
    const b = await login('conductor.b@usc.edu.co')
    const member = await login('miembro@usc.edu.co')
    const valid = { plate: ' abc123 ', seats: 4, efficiency: 42.5 }

    assert.equal((await request(path, null, valid)).status, 401)
    assert.equal((await request(path, member, valid)).status, 403)
    assert.equal((await request(path, member)).status, 403)

    for (const changes of [
        { plate: 'ABC' }, { seats: 0 }, { seats: 2.5 }, { seats: 2147483648 },
        { efficiency: 0 }, { efficiency: null }, { efficiency: '42.5' },
    ]) {
        assert.equal((await request(path, a, { ...valid, ...changes })).status, 400)
    }

    const attempts = await Promise.all([
        request(path, a, { ...valid, userId: 'driver-b' }),
        request(path, a, valid),
    ])
    assert.deepEqual(attempts.map(response => response.status).sort(), [201, 409])
    const vehicle = await attempts.find(response => response.status === 201).json()
    assert.ok(vehicle.id)
    assert.deepEqual(vehicle, { id: vehicle.id, plate: 'ABC123', seats: 4, efficiency: 42.5, brand: '', model: '', color: '', hasPhoto: false, photoReference: false })

    assert.equal((await request(path, b, valid)).status, 409)
    assert.deepEqual(await (await request(path, a)).json(), [vehicle])
    assert.deepEqual(await (await request(path, b)).json(), [])
    assert.deepEqual((await db.query('SELECT user_id, plate FROM vehicles')).rows, [
        { user_id: 'driver-a', plate: 'ABC123' },
    ])

    await db.exec(`
    UPDATE driver_permissions
    SET license_expires_on = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')::date - 1
    WHERE user_id = 'driver-a';
  `)
    assert.equal((await request(path, a, { ...valid, plate: 'DEF456' })).status, 403)
})