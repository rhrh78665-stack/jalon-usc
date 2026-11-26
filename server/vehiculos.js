import { accountRole } from './roles.js'
import { vehicleDescription } from './foto-vehiculo.js'
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
    const fields = 'id, plate, seats, efficiency, brand, model, color, photo_data IS NOT NULL AS "hasPhoto", photo_reference AS "photoReference"'
    app.get('/api/vehicles/:id/photo', async (req, res) => {
        const user = await approvedSession(req)
        const { rows: [vehicle] } = await db.query('SELECT photo_data, user_id FROM vehicles WHERE id = $1', [req.params.id])
        requireRule(accountRole(user) !== 'conductor' || vehicle?.user_id === user.id, 'El conductor solo puede consultar las fotos de sus propios vehículos.', 403)
        requireRule(vehicle?.photo_data, 'Este vehículo todavía no tiene fotografía.', 404)
        const [header, data] = vehicle.photo_data.split(',')
        res.type(header.slice(5, header.indexOf(';'))).send(Buffer.from(data, 'base64'))
    })
    app.patch('/api/vehicles/:id/description', async (req, res) => {
        const user = await approvedSession(req)
        requireRule(req.is('application/json'), 'Envía un cuerpo JSON.', 415)
        const value = vehicleDescription(req.body || {})
        const saved = await db.transaction(async tx => {
            await requireDriver(tx, user.id)
            const { rows: [vehicle] } = await tx.query(
                `UPDATE vehicles SET brand=$1, model=$2, color=$3,
                  photo_data=CASE WHEN $4::boolean THEN $5 ELSE photo_data END,
                  photo_reference=CASE WHEN $4::boolean THEN false ELSE photo_reference END
                 WHERE id=$6 AND user_id=$7 RETURNING ${fields}`,
                [value.brand, value.model, value.color, Object.hasOwn(req.body, 'photoData'), value.photoData, req.params.id, user.id])
            requireRule(vehicle, 'Selecciona un vehículo propio.', 404)
            await tx.query("SELECT pg_notify('jalon_trip_search', '')")
            return vehicle
        })
        res.json(saved)
    })
    app.get('/api/vehicles', async (req, res) => {
        const { id } = await approvedSession(req)
        const vehicles = await db.transaction(async tx => {
            await requireDriver(tx, id)
            const { rows } = await tx.query(
                `SELECT ${fields} FROM vehicles WHERE user_id = $1 ORDER BY plate`,
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
        const description = vehicleDescription(req.body || {})
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
                `INSERT INTO vehicles (id, user_id, plate, seats, efficiency, brand, model, color, photo_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (plate) DO NOTHING
         RETURNING ${fields}`,
                [randomUUID(), id, plate, seats, efficiency, description.brand, description.model, description.color, description.photoData],
            )
            requireRule(saved, 'Esa placa ya está registrada.', 409)
            return saved
        })

        res.status(201).json(vehicle)
    })
}