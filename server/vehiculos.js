import { randomUUID } from 'node:crypto'
import { requireRule } from './rules.js'

export async function requireDriver(db, userId) {
    const { rows: [permission] } = await db.query(
        `SELECT p.user_id FROM driver_permissions p
     JOIN users u ON u.id = p.user_id
     WHERE p.user_id = $1 AND u.status = 'approved' AND u.mobility = false
       AND p.license_expires_on >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')::date
     FOR SHARE OF p, u`,
        [userId],
    )
    requireRule(permission, 'Movilidad debe habilitarte como conductor con licencia vigente.', 403)
}

export function mountVehicles(app, db, approvedSession) {
    app.get('/api/vehicles', async (req, res) => {
        const { id } = await approvedSession(req)
        const vehicles = await db.transaction(async tx => {
            await requireDriver(tx, id)
            const { rows } = await tx.query(
                'SELECT id, plate, seats, efficiency FROM vehicles WHERE user_id = $1 ORDER BY plate',
                [id],
            )
            return rows
        })

        res.json(vehicles)
    })

    app.post('/api/vehicles', async (req, res) => {
        const { id } = await approvedSession(req)
        requireRule(req.is('application/json'), 'Envía un cuerpo JSON.', 415)

        const { plate: rawPlate, seats, efficiency } = req.body ?? {}
        const plate = typeof rawPlate === 'string' ? rawPlate.trim().toUpperCase() : ''
        requireRule(/^[A-Z]{3}[0-9]{3}$/.test(plate), 'Ingresa una placa de tres letras y tres números.')
        requireRule(
            Number.isInteger(seats) && seats > 0 && seats <= 2_147_483_647,
            'La cantidad de asientos debe ser un entero positivo.',
        )
        requireRule(Number.isFinite(efficiency) && efficiency > 0, 'El rendimiento debe ser mayor que cero.')

        const vehicle = await db.transaction(async tx => {
            await requireDriver(tx, id)
            const { rows: [saved] } = await tx.query(
                `INSERT INTO vehicles (id, user_id, plate, seats, efficiency)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (plate) DO NOTHING
         RETURNING id, plate, seats, efficiency`,
                [randomUUID(), id, plate, seats, efficiency],
            )
            requireRule(saved, 'Esa placa ya está registrada.', 409)
            return saved
        })

        res.status(201).json(vehicle)
    })
}