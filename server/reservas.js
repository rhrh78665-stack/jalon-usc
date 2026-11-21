import { randomUUID } from 'node:crypto'
import { cotizar, validarParadas } from './itinerarios.js'
import { requireRule } from './rules.js'

const campos = `r.id, r.trip_id AS "tripId", r.status, r.maximum_cop AS "maximumCop",
  t.route -> r.board_index AS origin, t.route -> r.alight_index AS destination,
  t.itinerary -> r.board_index ->> 'estimatedAt' AS "boardAt",
  t.itinerary -> r.alight_index ->> 'estimatedAt' AS "alightAt"`

async function cargarViaje(tx, id) {
  const { rows: [trip] } = await tx.query(
    `SELECT id, driver_id AS "driverId", status, route, itinerary, capacity,
       depart_at > clock_timestamp() AS open
     FROM trips WHERE id = $1 FOR UPDATE`, [id],
  )
  requireRule(trip, 'No se encontró el viaje.', 404)
  return trip
}

function verificarApertura(trip) {
  requireRule(trip.open && ['Programado', 'Lleno'].includes(trip.status),
    'La postulación del viaje está cerrada.', 409)
}

async function habilitarPasajero(tx, id) {
  const { rows: [passenger] } = await tx.query(
    `SELECT status, mobility, suspended_until > clock_timestamp() AS suspended
     FROM users WHERE id = $1 FOR UPDATE`, [id],
  )
  requireRule(passenger?.status === 'approved' && !passenger.mobility && !passenger.suspended,
    'La cuenta del pasajero no está habilitada para reservar.', 403)
}

async function confirmadas(tx, tripId) {
  const { rows } = await tx.query(
    "SELECT * FROM reservations WHERE trip_id = $1 AND status = 'Confirmada'", [tripId],
  )
  return rows
}

async function consultarReserva(tx, id) {
  const { rows: [booking] } = await tx.query(
    `SELECT ${campos} FROM reservations r JOIN trips t ON t.id = r.trip_id WHERE r.id = $1`, [id],
  )
  return booking
}

export function mountReservations(app, db, approvedSession) {
  app.get('/api/reservations', async (req, res) => {
    const { id } = await approvedSession(req)
    const { rows } = await db.query(
      `SELECT ${campos}, (t.driver_id = $1) AS "canDecide"
       FROM reservations r JOIN trips t ON t.id = r.trip_id
       WHERE r.passenger_id = $1 OR t.driver_id = $1
       ORDER BY t.depart_at, r.id`, [id],
    )
    res.json(rows)
  })

  app.post('/api/trips/:id/reservations', async (req, res) => {
    const { id } = await approvedSession(req)
    requireRule(req.is('application/json'), 'Envía un cuerpo JSON.', 415)
    const { origin, destination } = req.body ?? {}
    validarParadas(origin, destination)

    const booking = await db.transaction(async tx => {
      const trip = await cargarViaje(tx, req.params.id)
      verificarApertura(trip)
      requireRule(trip.driverId !== id, 'No puedes solicitar un asiento en tu propio viaje.', 403)
      await habilitarPasajero(tx, id)
      const quote = cotizar(trip, await confirmadas(tx, trip.id), origin, destination)
      requireRule(quote.availableSeats > 0, 'No hay cupo en todos los tramos solicitados.', 409)

      const { rows: [saved] } = await tx.query(
        `INSERT INTO reservations (id, trip_id, passenger_id, board_index, alight_index, maximum_cop)
         SELECT $1, $2, $3, $4, $5, $6 FROM trips WHERE id = $2 AND depart_at > clock_timestamp()
         ON CONFLICT (trip_id, passenger_id) WHERE status IN ('Pendiente', 'Confirmada')
         DO NOTHING RETURNING id`,
        [randomUUID(), trip.id, id, trip.route.indexOf(origin), trip.route.indexOf(destination), quote.maximumCop],
      )
      requireRule(saved, 'Ya tienes una solicitud activa o la postulación cerró.', 409)
      return consultarReserva(tx, saved.id)
    })
    res.status(201).json(booking)
  })
}
