import { requireRule } from './rules.js'

export function mountRatings(app, db, approvedSession) {
  app.post('/api/reservations/:id/rating', async (req, res) => {
    const { id } = await approvedSession(req)
    requireRule(req.is('application/json'), 'Envía un cuerpo JSON.', 415)
    const { stars, review } = req.body ?? {}
    const text = typeof review === 'string' ? review.trim() : ''
    requireRule(Number.isInteger(stars) && stars >= 1 && stars <= 5, 'Selecciona entre 1 y 5 estrellas.')
    requireRule(text.length >= 1 && text.length <= 300, 'Escribe una reseña de 1 a 300 caracteres.')

    const saved = await db.transaction(async tx => {
      const { rows: [r] } = await tx.query(
        `SELECT r.trip_id, r.passenger_id, r.status, r.attendance, t.driver_id, t.status AS trip_status,
                t.completed_at IS NOT NULL AND
                  clock_timestamp() <= t.completed_at + interval '7 days' AS within_window
         FROM reservations r JOIN trips t ON t.id = r.trip_id WHERE r.id = $1`, [req.params.id],
      )
      requireRule(r && (r.passenger_id === id || r.driver_id === id),
        'Solo los participantes pueden calificar este viaje.', 403)
      requireRule(r.trip_status === 'Completado' && r.status === 'Confirmada' && r.attendance === 'Abordo' &&
        r.within_window, 'Solo se puede calificar a quien viajó dentro de los siete días del cierre.', 409)
      const target = r.driver_id === id ? r.passenger_id : r.driver_id
      const { rows: [rating] } = await tx.query(
        `INSERT INTO ratings (trip_id, author_id, target_id, stars, review)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING RETURNING stars, review`, [r.trip_id, id, target, stars, text],
      )
      requireRule(rating, 'Ya registraste una calificación para esta persona en el viaje.', 409)
      return rating
    })
    res.status(201).json(saved)
  })
}
