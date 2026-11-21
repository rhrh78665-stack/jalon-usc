import { randomUUID } from 'node:crypto'
import { requireRule } from './rules.js'
import { requireDriver } from './vehiculos.js'
import { horaBogota, crearItinerario, fijarCostos, horaLocal, validarParadas, cotizar, diferenciaHorario, fechasSerie } from './itinerarios.js'

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

function vistaPublica(trip, quote) {
  return {
    id: trip.id, departAt: trip.departAt, route: trip.route, itinerary: trip.itinerary,
    status: trip.status, ...quote,
  }
}

function enteroConsulta(value, fallback, max) {
  if (value === undefined) return fallback
  requireRule(typeof value === 'string' && /^[1-9]\d*$/.test(value) &&
    Number.isSafeInteger(Number(value)) && Number(value) <= max, 'La paginación no es válida.')
  return Number(value)
}

export function mountTrips(app, db, approvedSession) {
  app.get('/api/trips/mine', async (req, res) => {
    const { id } = await approvedSession(req)
    const { rows } = await db.query(`SELECT ${campos} FROM trips WHERE driver_id = $1 ORDER BY depart_at, id`, [id])
    res.json(rows)
  })

  app.get('/api/trips/search', async (req, res) => {
    await approvedSession(req)
    const { origin, destination, date, time } = req.query
    validarParadas(origin, destination)
    requireRule(typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date), 'Selecciona una fecha válida.')
    horaBogota(date + 'T00:00')
    const hasTime = time !== undefined && time !== ''
    if (hasTime) requireRule(typeof time === 'string' && /^\d{2}:\d{2}$/.test(time), 'Indica una hora válida.')
    const target = hasTime ? new Date(horaBogota(date + 'T' + time)).getTime() : null
    const page = enteroConsulta(req.query.page, 1, 1000000)
    const pageSize = enteroConsulta(req.query.pageSize, 10, 50)
    const result = await db.transaction(async tx => {
      const { rows: trips } = await tx.query(
        `SELECT ${campos} FROM trips WHERE status IN ('Programado', 'Lleno')
         AND depart_at > clock_timestamp() AND jsonb_array_length(itinerary) >= 2`,
      )
      const { rows: bookings } = await tx.query("SELECT * FROM reservations WHERE status = 'Confirmada'")
      const matches = []
      for (const trip of trips) {
        if (trip.route.indexOf(origin) < 0 || trip.route.indexOf(destination) <= trip.route.indexOf(origin)) continue
        const quote = cotizar(trip, bookings.filter(booking => booking.trip_id === trip.id), origin, destination)
        if (quote.availableSeats < 1) continue
        if (!target && horaLocal(quote.boardAt).slice(0, 10) !== date) continue
        const difference = diferenciaHorario(trip, quote, target)
        if (difference === null) continue
        matches.push({ trip, quote, difference })
      }
      matches.sort((a, b) => a.difference - b.difference ||
        new Date(a.trip.departAt).getTime() - new Date(b.trip.departAt).getTime() || a.trip.id.localeCompare(b.trip.id))
      return {
        page, pageSize, total: matches.length,
        items: matches.slice((page - 1) * pageSize, page * pageSize).map(({ trip, quote }) => vistaPublica(trip, quote)),
      }
    })
    res.json(result)
  })

  app.get('/api/trips/:id', async (req, res) => {
    await approvedSession(req)
    const { origin, destination } = req.query
    validarParadas(origin, destination)
    const result = await db.transaction(async tx => {
      const { rows: [trip] } = await tx.query(
        `SELECT ${campos} FROM trips WHERE id = $1 AND status IN ('Programado', 'Lleno')
         AND depart_at > clock_timestamp()`, [req.params.id],
      )
      requireRule(trip, 'El viaje ya no está disponible.', 404)
      const { rows: bookings } = await tx.query("SELECT * FROM reservations WHERE trip_id = $1 AND status = 'Confirmada'", [trip.id])
      const quote = cotizar(trip, bookings, origin, destination)
      requireRule(quote.availableSeats > 0, 'No hay cupo en todos los tramos solicitados.', 409)
      return vistaPublica(trip, quote)
    })
    res.json(result)
  })

  app.post('/api/trips', async (req, res) => {
    const { id } = await approvedSession(req)
    const body = jsonBody(req)
    const trip = await db.transaction(tx => crearViaje(tx, id, body))
    res.status(201).json(trip)
  })

  app.post('/api/trips/series', async (req, res) => {
    const { id } = await approvedSession(req)
    const bodies = fechasSerie(jsonBody(req))
    const trips = await db.transaction(async tx => {
      const created = []
      for (const body of bodies) created.push(await crearViaje(tx, id, body))
      return created
    })
    res.status(201).json(trips)
  })

  app.put('/api/trips/:id', async (req, res) => {
    const { id } = await approvedSession(req)
    const body = jsonBody(req)
    const saved = await db.transaction(async tx => {
      const { rows: [current] } = await tx.query(`SELECT ${campos} FROM trips WHERE id = $1 FOR UPDATE`, [req.params.id])
      requireRule(current, 'No se encontró el viaje.', 404)
      requireRule(current.driverId === id, 'Solo el propietario puede editar el viaje.', 403)
      requireRule(['Programado', 'Lleno'].includes(current.status), 'El estado del viaje no permite editarlo.', 409)
      const { rows } = await tx.query(
        "SELECT id FROM reservations WHERE trip_id = $1 AND status IN ('Pendiente', 'Confirmada') LIMIT 1", [current.id],
      )
      requireRule(rows.length === 0, 'No puedes editar un viaje con reservas pendientes o confirmadas.', 409)
      const trip = await preparar(tx, id, body)
      const { rows: [updated] } = await tx.query(
        `UPDATE trips SET vehicle_id = $2, depart_at = $3::timestamptz, capacity = $4,
         route = $5::jsonb, itinerary = $6::jsonb, pricing = $7::jsonb, status = 'Programado'
         WHERE id = $1 AND depart_at > clock_timestamp() AND $3::timestamptz > clock_timestamp()
         RETURNING ${campos}`,
        [current.id, trip.vehicleId, trip.departure, trip.capacity,
          JSON.stringify(trip.route), JSON.stringify(trip.itinerary), JSON.stringify(trip.pricing)],
      )
      requireRule(updated, 'Solo puedes editar viajes futuros con una nueva salida futura.', 409)
      return updated
    })
    res.json(saved)
  })
}
