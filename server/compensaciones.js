import { requireRule } from './rules.js'

export function mountCompensations(app, db, approvedSession, informar) {
  app.post('/api/reservations/:id/compensation', async (req, res) => {
    const { id } = await approvedSession(req)
    requireRule(req.is('application/json'), 'Envía un cuerpo JSON.', 415)
    const { montoCop } = req.body ?? {}
    requireRule(Number.isSafeInteger(montoCop) && montoCop > 0, 'Indica un monto entero positivo.')
    const result = await db.transaction(async tx => {
      const { rows: [r] } = await tx.query(
        `SELECT r.id, r.trip_id AS "tripId", r.passenger_id, r.status, r.attendance, r.maximum_cop,
                t.driver_id, t.status AS trip_status, (t.liquidation -> 'aportes' ->> r.id)::int AS aporte
         FROM reservations r JOIN trips t ON t.id = r.trip_id WHERE r.id = $1 FOR UPDATE OF r`, [req.params.id],
      )
      requireRule(r && r.driver_id === id, 'Solo el conductor del viaje puede registrar la compensación.', 403)
      requireRule(r.trip_status === 'Completado' && r.status === 'Confirmada' && r.attendance === 'Abordo'
        && r.aporte != null, 'La reserva necesita una liquidación definitiva.', 409)
      requireRule(montoCop <= Math.min(r.aporte, r.maximum_cop), 'El monto supera el aporte liquidado.', 409)
      const { rows: [saved] } = await tx.query(
        `INSERT INTO compensations (reservation_id, amount_cop) VALUES ($1, $2)
         ON CONFLICT DO NOTHING RETURNING amount_cop AS "montoCop"`, [r.id, montoCop],
      )
      requireRule(saved, 'La compensación ya fue registrada.', 409)
      return { r, saved }
    })
    await informar([id, result.r.passenger_id], 'reservation-changed', { id: result.r.id, tripId: result.r.tripId, status: result.r.status })
    res.status(201).json(result.saved)
  })

  app.post('/api/reservations/:id/compensation/confirm', async (req, res) => {
    const { id } = await approvedSession(req)
    const { rows: [saved] } = await db.query(
      `UPDATE compensations c SET confirmed_at = COALESCE(c.confirmed_at, clock_timestamp())
       FROM reservations r, trips t
       WHERE c.reservation_id = r.id AND t.id = r.trip_id AND r.id = $1 AND r.passenger_id = $2
       RETURNING c.confirmed_at AS "confirmadoEn", r.trip_id AS "tripId", r.status, t.driver_id`, [req.params.id, id],
    )
    requireRule(saved, 'No se encontró una compensación propia para confirmar.', 404)
    await informar([id, saved.driver_id], 'reservation-changed', { id: req.params.id, tripId: saved.tripId, status: saved.status })
    res.json({ confirmadoEn: saved.confirmadoEn })
  })
}
