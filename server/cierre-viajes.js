import { registrarAdvertencia } from './advertencias.js'
import { calcularLiquidacion } from './liquidacion.js'
import { requireRule } from './rules.js'

async function cargarPropio(tx, tripId, driverId) {
  const { rows: [trip] } = await tx.query(
    `SELECT id, status, itinerary, liquidation, driver_id, depart_at <= clock_timestamp() AS due
     FROM trips WHERE id = $1 FOR UPDATE`, [tripId],
  )
  requireRule(trip, 'No se encontró el viaje.', 404)
  requireRule(trip.driver_id === driverId, 'Solo el conductor propietario puede gestionar el cierre.', 403)
  return trip
}

async function confirmadas(tx, tripId) {
  const { rows } = await tx.query(
    `SELECT id, passenger_id, board_index, alight_index, maximum_cop, attendance
     FROM reservations WHERE trip_id = $1 AND status = 'Confirmada' ORDER BY id`, [tripId],
  )
  return rows
}

function aplicarAsistencia(reservas, marcas) {
  requireRule(Array.isArray(marcas), 'Envía las marcas de asistencia.')
  const porReserva = new Map()
  const ids = new Set(reservas.map(r => r.id))
  for (const marca of marcas) {
    requireRule(ids.has(marca?.id) && !porReserva.has(marca.id) && ['Abordo', 'Ausente'].includes(marca.attendance),
      'Revisa las marcas de asistencia de las reservas confirmadas.')
    porReserva.set(marca.id, marca.attendance)
  }
  const resultado = reservas.map(r => ({ ...r, attendance: porReserva.get(r.id) ?? r.attendance }))
  requireRule(resultado.every(r => r.attendance), 'Registra la asistencia de cada reserva confirmada.', 409)
  return resultado
}

export function mountTripClosing(app, db, approvedSession, informar) {
  app.get('/api/trips/:id/cierre', async (req, res) => {
    const { id } = await approvedSession(req)
    const result = await db.transaction(async tx => {
      const trip = await cargarPropio(tx, req.params.id, id)
      const { rows: reservas } = await tx.query(
        `SELECT r.id, r.attendance, COALESCE(NULLIF(u.alias, ''), 'Pasajero') AS alias
         FROM reservations r JOIN users u ON u.id = r.passenger_id
         WHERE r.trip_id = $1 AND r.status = 'Confirmada' ORDER BY r.id`, [trip.id],
      )
      return { status: trip.status, liquidation: trip.liquidation, reservas }
    })
    res.json(result)
  })

  app.post('/api/trips/:id/start', async (req, res) => {
    const { id } = await approvedSession(req)
    const result = await db.transaction(async tx => {
      const trip = await cargarPropio(tx, req.params.id, id)
      requireRule(['Programado', 'Lleno'].includes(trip.status) && trip.due,
        'El viaje debe estar abierto y haber llegado su hora de salida.', 409)
      requireRule(trip.itinerary.length >= 2, 'Completa el itinerario antes de iniciar.', 409)
      const { rows: affected } = await tx.query(
        `UPDATE reservations SET status = 'Vencida' WHERE trip_id = $1 AND status = 'Pendiente'
         RETURNING id, passenger_id, status`, [trip.id],
      )
      const { rows: [saved] } = await tx.query(
        `UPDATE trips SET status = 'EnCurso', started_at = clock_timestamp() WHERE id = $1
         RETURNING id, status, started_at AS "startedAt"`, [trip.id],
      )
      return { saved, affected }
    })
    for (const r of result.affected) {
      await informar([id, r.passenger_id], 'reservation-changed', { id: r.id, tripId: result.saved.id, status: r.status })
    }
    res.json(result.saved)
  })

  app.post('/api/trips/:id/finish', async (req, res) => {
    const { id } = await approvedSession(req)
    requireRule(req.is('application/json'), 'Envía un cuerpo JSON.', 415)
    const result = await db.transaction(async tx => {
      const trip = await cargarPropio(tx, req.params.id, id)
      if (trip.status === 'Completado' && trip.liquidation) {
        return { saved: { id: trip.id, status: trip.status, liquidation: trip.liquidation }, affected: [] }
      }
      requireRule(trip.status === 'EnCurso', 'Solo un viaje en curso se puede cerrar.', 409)
      const reservas = aplicarAsistencia(await confirmadas(tx, trip.id), req.body?.asistencia ?? [])
      const liquidation = calcularLiquidacion(trip, reservas)
      for (const r of [...reservas].sort((a, b) => a.passenger_id.localeCompare(b.passenger_id))) {
        await tx.query('UPDATE reservations SET attendance = $2 WHERE id = $1', [r.id, r.attendance])
        if (r.attendance === 'Ausente') {
          await tx.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [r.passenger_id])
          await registrarAdvertencia(tx, r, 'ausencia')
        }
      }
      const { rows: [saved] } = await tx.query(
        `UPDATE trips SET status = 'Completado', completed_at = clock_timestamp(), liquidation = $2::jsonb
         WHERE id = $1 RETURNING id, status, liquidation`, [trip.id, JSON.stringify(liquidation)],
      )
      return { saved, affected: reservas }
    })
    for (const r of result.affected) {
      await informar([r.passenger_id], 'reservation-changed', { id: r.id, tripId: result.saved.id, status: r.status ?? 'Confirmada' })
    }
    res.json(result.saved)
  })
}
