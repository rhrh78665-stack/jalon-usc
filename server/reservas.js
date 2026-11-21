import { randomUUID } from 'node:crypto'
import { cotizar, validarParadas } from './itinerarios.js'
import { registrarAdvertencia } from './advertencias.js'
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

async function actualizarDisponibilidad(tx, trip) {
  const quote = cotizar(trip, await confirmadas(tx, trip.id), trip.route[0], trip.route.at(-1))
  const status = quote.segments.every(segment => segment.availableSeats === 0) ? 'Lleno' : 'Programado'
  if (status !== trip.status) await tx.query('UPDATE trips SET status = $2 WHERE id = $1', [trip.id, status])
}

async function consultarReserva(tx, id) {
  const { rows: [booking] } = await tx.query(
    `SELECT ${campos} FROM reservations r JOIN trips t ON t.id = r.trip_id WHERE r.id = $1`, [id],
  )
  return booking
}

export async function expirarPendientes(db, minutes, informar) {
  if (!minutes) return
  const { rows } = await db.query(
    `UPDATE reservations r SET status = 'Vencida' FROM trips t
     WHERE r.trip_id = t.id AND r.status = 'Pendiente' AND t.status IN ('Programado', 'Lleno')
       AND LEAST(t.depart_at, r.requested_at + $1::int * interval '1 minute') <= clock_timestamp()
     RETURNING r.id, r.trip_id AS "tripId", r.status, r.passenger_id, t.driver_id`, [minutes],
  )
  await Promise.all(rows.map(({ passenger_id, driver_id, ...booking }) =>
    informar([passenger_id, driver_id], booking)))
}

export function mountReservations(app, db, approvedSession, informar) {
  const minutes = Number(process.env.JALON_RESPONSE_MINUTES ?? 0)
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 10080) {
    throw new Error('JALON_RESPONSE_MINUTES debe estar entre 0 y 10080.')
  }
  const expirar = () => expirarPendientes(db, minutes, informar)
  app.locals.expirarReservas = expirar

  app.get('/api/reservations', async (req, res) => {
    const { id } = await approvedSession(req)
    await expirar()
    const { rows } = await db.query(
      `SELECT ${campos}, (t.driver_id = $1) AS "canDecide",
              (r.passenger_id = $1 AND r.status IN ('Pendiente', 'Confirmada')
               AND t.status IN ('Programado', 'Lleno') AND t.depart_at > clock_timestamp()) AS "canCancel"
       FROM reservations r JOIN trips t ON t.id = r.trip_id
       WHERE r.passenger_id = $1 OR t.driver_id = $1
       ORDER BY t.depart_at, r.id`, [id],
    )
    res.json(rows)
  })

  app.post('/api/trips/:id/reservations', async (req, res) => {
    const { id } = await approvedSession(req)
    requireRule(req.is('application/json'), 'Envía un cuerpo JSON.', 415)
    await expirar()
    const { origin, destination } = req.body ?? {}
    validarParadas(origin, destination)

    const { booking, driverId } = await db.transaction(async tx => {
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
      return { booking: await consultarReserva(tx, saved.id), driverId: trip.driverId }
    })
    await informar([id, driverId], booking)
    res.status(201).json(booking)
  })

  app.post('/api/reservations/:id/cancel', async (req, res) => {
    const { id } = await approvedSession(req)
    await expirar()
    const result = await db.transaction(async tx => {
      const { rows: [reference] } = await tx.query(
        'SELECT trip_id FROM reservations WHERE id = $1 AND passenger_id = $2', [req.params.id, id],
      )
      requireRule(reference, 'No se encontró una reserva propia.', 404)
      const trip = await cargarViaje(tx, reference.trip_id)
      const { rows: [booking] } = await tx.query('SELECT * FROM reservations WHERE id = $1 FOR UPDATE', [req.params.id])
      if (booking.cancelled_by_passenger) return { booking: await consultarReserva(tx, booking.id) }
      verificarApertura(trip)
      requireRule(['Pendiente', 'Confirmada'].includes(booking.status), 'La reserva ya no está activa.', 409)
      const { rows: [cancelled] } = await tx.query(
        `UPDATE reservations SET status = 'Cancelada', cancelled_by_passenger = true
         WHERE id = $1 AND (SELECT depart_at FROM trips WHERE id = $2) > clock_timestamp()
         RETURNING id`, [booking.id, trip.id],
      )
      requireRule(cancelled, 'La postulación del viaje está cerrada.', 409)
      if (booking.status === 'Confirmada') {
        await actualizarDisponibilidad(tx, trip)
        const pickup = trip.itinerary[booking.board_index]?.estimatedAt
        if (pickup) {
          const { rows: [window] } = await tx.query(
            "SELECT $1::timestamptz - clock_timestamp() < interval '60 minutes' AS late", [pickup],
          )
          if (window.late) {
            await tx.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [id])
            await registrarAdvertencia(tx, booking, 'cancelacion_tardia')
          }
        }
      }
      return { booking: await consultarReserva(tx, booking.id), driverId: trip.driverId }
    })
    if (result.driverId) await informar([id, result.driverId], result.booking)
    res.json(result.booking)
  })

  app.patch('/api/reservations/:id/decision', async (req, res) => {
    const { id } = await approvedSession(req)
    requireRule(req.is('application/json'), 'Envía un cuerpo JSON.', 415)
    await expirar()
    const { decision } = req.body ?? {}
    requireRule(['confirmar', 'rechazar'].includes(decision), 'Selecciona confirmar o rechazar.')

    const { booking: result, passengerId } = await db.transaction(async tx => {
      const { rows: [reference] } = await tx.query(
        'SELECT trip_id FROM reservations WHERE id = $1', [req.params.id],
      )
      requireRule(reference, 'No se encontró la reserva.', 404)
      const trip = await cargarViaje(tx, reference.trip_id)
      requireRule(trip.driverId === id, 'Solo el conductor propietario puede decidir.', 403)
      const { rows: [booking] } = await tx.query(
        'SELECT * FROM reservations WHERE id = $1 FOR UPDATE', [req.params.id],
      )
      requireRule(booking?.status === 'Pendiente', 'La reserva ya fue decidida o cerrada.', 409)
      const status = decision === 'confirmar' ? 'Confirmada' : 'Rechazada'

      if (status === 'Confirmada') {
        verificarApertura(trip)
        await habilitarPasajero(tx, booking.passenger_id)
        const current = await confirmadas(tx, trip.id)
        const quote = cotizar(trip, current, trip.route[booking.board_index], trip.route[booking.alight_index])
        requireRule(quote.availableSeats > 0, 'No hay cupo en todos los tramos solicitados.', 409)
        const { rows } = await tx.query(
          `SELECT 1 FROM reservations r JOIN trips t ON t.id = r.trip_id
           WHERE r.passenger_id = $1 AND r.status = 'Confirmada' AND t.id <> $2
             AND (t.itinerary -> r.board_index ->> 'estimatedAt')::timestamptz < $4::timestamptz
             AND (t.itinerary -> r.alight_index ->> 'estimatedAt')::timestamptz > $3::timestamptz
           LIMIT 1`,
          [booking.passenger_id, trip.id, quote.boardAt, quote.alightAt],
        )
        requireRule(!rows.length, 'El pasajero tiene otra reserva confirmada en ese horario.', 409)
        const { rows: [open] } = await tx.query(
          `SELECT id FROM trips WHERE id = $1 AND depart_at > clock_timestamp()
           AND ($2::int = 0 OR $3::timestamptz + $2::int * interval '1 minute' > clock_timestamp())`,
          [trip.id, minutes, booking.requested_at],
        )
        requireRule(open, 'La postulación del viaje está cerrada.', 409)

      }

      await tx.query('UPDATE reservations SET status = $2 WHERE id = $1', [booking.id, status])
      if (status === 'Confirmada') await actualizarDisponibilidad(tx, trip)
      return { booking: await consultarReserva(tx, booking.id), passengerId: booking.passenger_id }
    })
    await informar([id, passengerId], result)
    res.json(result)
  })
}
