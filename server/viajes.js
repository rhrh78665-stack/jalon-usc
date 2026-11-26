import { accountRole, requirePassenger, requireConductor } from './roles.js'
import { createJourneyPlans, mountJourneyPlans } from './planes-recorrido.js'
import { selectedPoints, routeCatalog } from './puntos-recorrido.js'
import { defaultFare } from '../shared/fare-policy.js'
import { mountHistory } from './historial.js'
import { journeyProfile } from './presentacion-viaje.js'
import { mountJourneyBoard } from './cartelera.js'
import { tripSearch } from './busqueda.js'
import { randomUUID } from 'node:crypto'
import { requireRule } from './rules.js'
import { tarifaVigente, mountTariffs } from './tarifas.js'
import { requireDriver } from './vehiculos.js'
import { mountReservations } from './reservas.js'
import { mountRatings } from './calificaciones.js'
import { mountCompensations } from './compensaciones.js'
import { mountTripClosing } from './cierre-viajes.js'
import {
  horaBogota, horaLocal, validarParadas, crearItinerario, fijarCostos,
  cotizar, diferenciaHorario, fechasSerie,
} from './itinerarios.js'

const campos = `id, driver_id AS "driverId", vehicle_id AS "vehicleId",
  depart_at AS "departAt", capacity, route, status, itinerary, pricing,
  cancel_reason AS "cancelReason"`

function jsonBody(req) {
  requireRule(req.is('application/json'), 'Envía un cuerpo JSON.', 415)
  requireRule(req.body && typeof req.body === 'object' && !Array.isArray(req.body), 'Envía los datos del viaje.')
  return req.body
}

async function preparar(tx, driverId, body, previousPricing, plans) {
  const { vehicleId, departAt, capacity, route, stopTimes, fuelPriceCopPerGallon } = body
  requireRule(typeof vehicleId === 'string' && vehicleId.length > 0, 'Selecciona tu vehículo.')
  requireRule(Number.isInteger(capacity) && capacity > 0, 'Indica una cantidad entera de cupos mayor que cero.')
  const departure = horaBogota(departAt)
  const vigente = await tarifaVigente(tx)
  const tarifa = previousPricing?.tariff ?? (previousPricing ? null : vigente)
  const points = selectedPoints(route, body.routePoints ?? [])
  const plan = body.planId ? plans.resolve(body.planId,driverId,points) : null
  const catalog = plan ? plan.catalog.map(s => ({...s,tollCop:tarifa?.tolls?.[s.from+':'+s.to]??s.tollCop})) : routeCatalog(points, tarifa?.tolls)
  const ordered = crearItinerario(route, stopTimes, departure, catalog, points)
  await requireDriver(tx, driverId)
  const { rows: [vehicle] } = await tx.query(
    'SELECT seats, efficiency FROM vehicles WHERE id = $1 AND user_id = $2 FOR SHARE', [vehicleId, driverId],
  )
  requireRule(vehicle, 'Selecciona un vehículo propio.')
  requireRule(capacity <= vehicle.seats, 'Los cupos superan la capacidad del vehículo.')
  const fuel = tarifa?.fuelPriceCopPerGallon ??
    (vigente && previousPricing ? previousPricing.fuelPriceCopPerGallon : fuelPriceCopPerGallon)
  const { itinerary, pricing } = fijarCostos(ordered, vehicle.efficiency, fuel, previousPricing ? (previousPricing.fare ?? null) : (tarifa?.fare ?? defaultFare), previousPricing ? (previousPricing.fareModel ?? 'fixed-v1') : 'distance-v2')
  return { vehicleId, departure, capacity, route, itinerary, pricing: { ...pricing, ...(tarifa && { tariff: tarifa }), ...(plan && { roadMap:plan.roadMap,distanceSource:plan.source }) } }
}

async function crearViaje(tx, driverId, body, plans) {
  const trip = await preparar(tx, driverId, body, undefined, plans)
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
    status: trip.status, roadMap:trip.pricing?.roadMap??null, ...quote,
  }
}

function enteroConsulta(value, fallback, max) {
  if (value === undefined) return fallback
  requireRule(typeof value === 'string' && /^[1-9]\d*$/.test(value) &&
    Number.isSafeInteger(Number(value)) && Number(value) <= max, 'La paginación no es válida.')
  return Number(value)
}

export function mountTrips(app, db, approvedSession, { roadService } = {}) {
  const plans = createJourneyPlans(roadService)
  mountJourneyPlans(app,db,approvedSession,plans)
  const listeners = new Map()
  const search = tripSearch(db)
  mountJourneyBoard(app, db, approvedSession)
  mountHistory(app, db, approvedSession)

  // Solo se emiten cambios después de confirmar la transacción y a sus participantes.

  async function informar(userIds, event, data) {
    const reservationEvent = event === 'reservation-changed'
    const { rows: [saved] } = await db.query(
      reservationEvent ? 'SELECT changed_at FROM reservations WHERE id = $1' : 'SELECT changed_at FROM trips WHERE id = $1',
      [reservationEvent ? data.id : data.tripId],
    )
    const payload = { ...data, ...(saved && { persistedAt: saved.changed_at }) }
    await Promise.all([...new Set(userIds)].flatMap(id => [...(listeners.get(id) ?? [])].map(async listener => {
      try {
        await approvedSession(listener.req)
        listener.res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
      } catch {
        listener.res.end()
      }
    })))
  }

  mountTariffs(app, db, approvedSession)
  mountTripClosing(app, db, approvedSession, informar)
  mountCompensations(app, db, approvedSession, informar)
  mountRatings(app, db, approvedSession)
  mountReservations(app, db, approvedSession, (participants, booking) =>
    informar(participants, 'reservation-changed', { id: booking.id, tripId: booking.tripId, status: booking.status }))

  app.get('/api/trips/events', async (req, res) => {
    const { id } = await approvedSession(req)
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' })
    res.flushHeaders()
    const listener = { req, res }
    const group = listeners.get(id) ?? new Set()
    group.add(listener)
    listeners.set(id, group)
    res.write('retry: 3000\nevent: ready\ndata: {}\n\n')
    const heartbeat = setInterval(async () => {
      try {
        await approvedSession(req)
        res.write(': keepalive\n\n')
      } catch {
        res.end()
      }
    }, 15000)
    heartbeat.unref()
    res.on('close', () => {
      clearInterval(heartbeat)
      group.delete(listener)
      if (!group.size) listeners.delete(id)
    })
  })

  app.get('/api/trips/mine', async (req, res) => {
    const user = await approvedSession(req)
    requireConductor(user)
    const { id } = user
    const { rows } = await db.query(`SELECT ${campos} FROM trips WHERE driver_id = $1 ORDER BY depart_at, id`, [id])
    res.json(rows)
  })

  app.get('/api/trips/search', async (req, res) => {
    const user = await approvedSession(req)
    requirePassenger(user)
    const { id } = user
    const { origin, destination, date, time } = req.query
    validarParadas(origin, destination)
    requireRule(typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date), 'Selecciona una fecha válida.')
    horaBogota(date + 'T00:00')
    const hasTime = time !== undefined && time !== ''
    if (hasTime) requireRule(typeof time === 'string' && /^\d{2}:\d{2}$/.test(time), 'Indica una hora válida.')
    const target = hasTime ? new Date(horaBogota(date + 'T' + time)).getTime() : null
    const page = enteroConsulta(req.query.page, 1, 1000000)
    const pageSize = enteroConsulta(req.query.pageSize, 10, 50)
    const result = await search({ userId: id, origin, destination, date, target, page, pageSize })
    res.json(result)
  })

  app.get('/api/trips/:id', async (req, res) => {
    const user = await approvedSession(req)
    requireRule(accountRole(user) !== 'movilidad', 'Esta consulta pertenece a los participantes del viaje.', 403)
    const { origin, destination } = req.query
    const result = await db.transaction(async tx => {
      const { rows: [trip] } = await tx.query(
        `SELECT ${campos} FROM trips WHERE id = $1 AND status IN ('Programado', 'Lleno')
         AND depart_at > clock_timestamp()`, [req.params.id],
      )
      requireRule(trip, 'El viaje ya no está disponible.', 404)
      requireRule(accountRole(user) === 'pasajero' || trip.driverId === user.id,
        'El conductor solo puede consultar sus propios recorridos.', 403)
      const { rows: bookings } = await tx.query("SELECT * FROM reservations WHERE trip_id = $1 AND status = 'Confirmada'", [trip.id])
      validarParadas(origin, destination, trip.itinerary)
      const quote = cotizar(trip, bookings, origin, destination)
      requireRule(quote.availableSeats > 0, 'No hay cupo en todos los tramos solicitados.', 409)
      return { ...vistaPublica(trip, quote), ...await journeyProfile(tx, trip.id) }
    })
    res.json(result)
  })

  app.post('/api/trips', async (req, res) => {
    const { id } = await approvedSession(req)
    const body = jsonBody(req)
    const trip = await db.transaction(tx => crearViaje(tx, id, body, plans))
    res.status(201).json(trip)
  })

  app.post('/api/trips/series', async (req, res) => {
    const { id } = await approvedSession(req)
    const bodies = fechasSerie(jsonBody(req))
    const trips = await db.transaction(async tx => {
      const created = []
      for (const body of bodies) created.push(await crearViaje(tx, id, body, plans))
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
      const trip = await preparar(tx, id, body, current.pricing, plans)
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

  app.post('/api/trips/:id/cancel', async (req, res) => {
    const { id } = await approvedSession(req)
    const { reason } = jsonBody(req)
    requireRule(typeof reason === 'string' && reason.trim().length > 0 && reason.trim().length <= 500,
      'Indica un motivo de cancelación de hasta 500 caracteres.')
    const result = await db.transaction(async tx => {
      const { rows: [trip] } = await tx.query(`SELECT ${campos} FROM trips WHERE id = $1 FOR UPDATE`, [req.params.id])
      requireRule(trip, 'No se encontró el viaje.', 404)
      requireRule(trip.driverId === id, 'Solo el propietario puede cancelar el viaje.', 403)
      if (trip.status === 'Cancelado') return { trip, participants: [] }
      requireRule(['Programado', 'Lleno'].includes(trip.status), 'Solo puedes cancelar un viaje que no ha iniciado.', 409)
      const { rows: cancelled } = await tx.query(
        `UPDATE reservations SET status = 'Cancelada' WHERE trip_id = $1
         AND status IN ('Pendiente', 'Confirmada') RETURNING passenger_id`, [trip.id],
      )
      const { rows: [saved] } = await tx.query(
        `UPDATE trips SET status = 'Cancelado', cancel_reason = $2 WHERE id = $1 RETURNING ${campos}`, [trip.id, reason.trim()],
      )
      return { trip: saved, participants: [id, ...cancelled.map(booking => booking.passenger_id)] }
    })
    await informar(result.participants, 'trip-cancelled', {
      tripId: result.trip.id, status: result.trip.status, reason: result.trip.cancelReason,
    })
    res.json(result.trip)
  })
}
