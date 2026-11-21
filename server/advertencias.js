export async function registrarAdvertencia(tx, reserva, motivo) {
  const { rows } = await tx.query(
    `INSERT INTO booking_warnings (reservation_id, passenger_id, reason)
     VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING reservation_id`,
    [reserva.id, reserva.passenger_id, motivo],
  )
  if (!rows.length) return
  await tx.query(
    `UPDATE users SET suspended_until = GREATEST(suspended_until, CURRENT_TIMESTAMP + interval '7 days')
     WHERE id = $1 AND (SELECT count(*) FROM booking_warnings
       WHERE passenger_id = $1 AND created_at >= CURRENT_TIMESTAMP - interval '30 days') >= 3`,
    [reserva.passenger_id],
  )
}
