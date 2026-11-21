import { randomUUID } from 'node:crypto'
import { requireRule } from './rules.js'
import { requireDriver } from './vehiculos.js'
import { horaBogota, crearItinerario, fijarCostos } from './itinerarios.js'

const campos = `id, driver_id AS "driverId", vehicle_id AS "vehicleId",
  depart_at AS "departAt", capacity, route, status, itinerary, pricing`

function jsonBody(req) {
  requireRule(req.is('application/json'), 'Envía un cuerpo JSON.', 415)
  requireRule(req.body && typeof req.body === 'object' && !Array.isArray(req.body), 'Envía los datos del viaje.')
  return req.body
}

async function preparar(tx, driverId, body) {
  const { vehicleId, departAt, capacity, route, stopTimes, fuelPriceCopPerGallon } = body
  requireRule(typeof vehicleId === 'string' && vehicleId.length > 0, 'Selecciona tu vehículo.')
  requireRule(Number.isInteger(capacity) && capacity > 0, 'Indica una cantidad entera de cupos mayor que cero.')
  const departure = horaBogota(departAt)
  const ordered = crearItinerario(route, stopTimes, departure)
  await requireDriver(tx, driverId)
  const { rows: [vehicle] } = await tx.query(
    'SELECT seats, efficiency FROM vehicles WHERE id = $1 AND user_id = $2 FOR SHARE', [vehicleId, driverId],
  )
  requireRule(vehicle, 'Selecciona un vehículo propio.')
  requireRule(capacity <= vehicle.seats, 'Los cupos superan la capacidad del vehículo.')
  return { vehicleId, departure, capacity, route, ...fijarCostos(ordered, vehicle.efficiency, fuelPriceCopPerGallon) }
}

async function crearViaje(tx, driverId, body) {
  const trip = await preparar(tx, driverId, body)
  const { rows: [saved] } = await tx.query(
    `INSERT INTO trips (id, driver_id, vehicle_id, depart_at, capacity, route, itinerary, pricing)
     SELECT $1, $2, $3, $4::timestamptz, $5, $6::jsonb, $7::jsonb, $8::jsonb
     WHERE $4::timestamptz > clock_timestamp() RETURNING ${campos}`,
    [randomUUID(), driverId, trip.vehicleId, trip.departure, trip.capacity,
      JSON.stringify(trip.route), JSON.stringify(trip.itinerary), JSON.stringify(trip.pricing)],
  )
  requireRule(saved, 'Todas las salidas deben quedar en el futuro.')
  return saved
}

export function mountTrips(app, db, approvedSession) {
  app.get('/api/trips/mine', async (req, res) => {
    const { id } = await approvedSession(req)
    const { rows } = await db.query(`SELECT ${campos} FROM trips WHERE driver_id = $1 ORDER BY depart_at, id`, [id])
    res.json(rows)
  })

  app.post('/api/trips', async (req, res) => {
    const { id } = await approvedSession(req)
    const body = jsonBody(req)
    const trip = await db.transaction(tx => crearViaje(tx, id, body))
    res.status(201).json(trip)
  })


}
