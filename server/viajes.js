import { randomUUID } from 'node:crypto'
import { paradas, tramos } from '../shared/paradas.js'
import { requireRule } from './rules.js'
import { requireDriver } from './vehiculos.js'

const paradasValidas = new Set(paradas.map(({ id }) => id))
const campos = 'id, vehicle_id AS "vehicleId", depart_at AS "departAt", capacity, route, status'

function horaBogota(value) {
  requireRule(
    typeof value === 'string' && /^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value),
    'Indica la fecha y hora de salida.',
  )
  const instant = new Date(value + ':00-05:00')
  const local = new Date(instant.getTime() - 5 * 60 * 60 * 1000)
  requireRule(
    Number.isFinite(instant.getTime()) && local.toISOString().slice(0, 16) === value,
    'La fecha y hora de salida no son válidas.',
  )
  return instant.toISOString()
}

function validarRuta(route) {
  requireRule(
    Array.isArray(route) && route.length >= 2 && route.length <= paradas.length &&
      new Set(route).size === route.length && route.every(id => paradasValidas.has(id)) &&
      (route[0] === 'usc' || route.at(-1) === 'usc'),
    'Selecciona paradas distintas con la USC en un extremo.',
  )

  requireRule(route.slice(1).every((end, i) => {
    const start = route[i]
    return tramos.some(([a, b]) => (a === start && b === end) || (a === end && b === start))
  }), 'Hay dos paradas consecutivas sin un tramo en el catálogo.')
}

export function mountTrips(app, db, approvedSession) {
  app.get('/api/trips/mine', async (req, res) => {
    const { id } = await approvedSession(req)
    const { rows } = await db.query(
      `SELECT ${campos} FROM trips WHERE driver_id = $1 ORDER BY depart_at, id`,
      [id],
    )
    res.json(rows)
  })

  app.post('/api/trips', async (req, res) => {
    const { id } = await approvedSession(req)
    requireRule(req.is('application/json'), 'Envía un cuerpo JSON.', 415)

    const { vehicleId, departAt, capacity, route } = req.body ?? {}
    requireRule(typeof vehicleId === 'string' && vehicleId.length > 0, 'Selecciona tu vehículo.')
    requireRule(Number.isInteger(capacity) && capacity > 0, 'Indica una cantidad entera de cupos mayor que cero.')
    const departure = horaBogota(departAt)
    validarRuta(route)

    const trip = await db.transaction(async tx => {
      await requireDriver(tx, id)
      const { rows: [vehicle] } = await tx.query(
        'SELECT seats FROM vehicles WHERE id = $1 AND user_id = $2 FOR SHARE',
        [vehicleId, id],
      )
      requireRule(vehicle, 'Selecciona un vehículo propio.')
      requireRule(capacity <= vehicle.seats, 'Los cupos superan la capacidad del vehículo.')

      const { rows: [created] } = await tx.query(
        `INSERT INTO trips (id, driver_id, vehicle_id, depart_at, capacity, route)
         SELECT $1, $2, $3, $4::timestamptz, $5, $6::jsonb
         WHERE $4::timestamptz > clock_timestamp()
         RETURNING ${campos}`,
        [randomUUID(), id, vehicleId, departure, capacity, JSON.stringify(route)],
      )
      requireRule(created, 'La salida debe quedar en el futuro.')
      return created
    })

    res.status(201).json(trip)
  })
}
