import { createHash, randomUUID } from 'node:crypto'

export function notificationWorker(db, mail) {
  let running = false
  return async function processNotifications() {
    if (!mail || running) return
    running = true
    try {
      for (let count = 0; count < 10; count++) {
        const item = await db.transaction(async tx => {
          const { rows: [next] } = await tx.query(
            `SELECT n.*, u.email, u.status AS user_status, u.trip_email_opt_in,
                    u.email_verified_at, n.first_attempt_at < clock_timestamp() - interval '23 hours' AS expired
             FROM trip_notifications n JOIN users u ON u.id = n.user_id
             WHERE n.status = 'Pendiente' AND n.next_attempt_at <= clock_timestamp()
               AND (n.locked_until IS NULL OR n.locked_until <= clock_timestamp())
             ORDER BY n.created_at, n.event_key, n.user_id LIMIT 1 FOR UPDATE OF n SKIP LOCKED`,
          )
          if (!next) return null
          const status = !next.trip_email_opt_in || next.user_status !== 'approved' || !next.email_verified_at
            ? 'Omitido' : next.expired ? 'Revisar' : null
          if (status) {
            await tx.query('UPDATE trip_notifications SET status = $3 WHERE event_key = $1 AND user_id = $2',
              [next.event_key, next.user_id, status])
            return { skip: true }
          }
          const lease = randomUUID()
          await tx.query(
            `UPDATE trip_notifications SET attempts = attempts + 1,
             first_attempt_at = COALESCE(first_attempt_at, clock_timestamp()),
             locked_until = clock_timestamp() + interval '2 minutes', lease_token = $3
             WHERE event_key = $1 AND user_id = $2`, [next.event_key, next.user_id, lease],
          )
          return { ...next, lease }
        })
        if (!item) break
        if (item.skip) continue
        let status = 'Enviado'
        const key = createHash('sha256').update(item.event_key + ':' + item.user_id).digest('hex')
        try {
          await mail.send(
            { to: item.email, subject: item.subject, text: item.message },
            { idempotencyKey: 'jalon/' + key },
          )
        } catch { status = 'Pendiente' }
        await db.query(
          `UPDATE trip_notifications SET status = $4, locked_until = NULL, lease_token = NULL,
           next_attempt_at = clock_timestamp() + interval '1 minute',
           sent_at = CASE WHEN $4 = 'Enviado' THEN clock_timestamp() ELSE NULL END
           WHERE event_key = $1 AND user_id = $2 AND lease_token = $3`,
          [item.event_key, item.user_id, item.lease, status],
        )
      }
    } finally { running = false }
  }
}

export function mountNotifications(app, db, approvedSession) {
  app.get('/api/notifications', async (req, res) => {
    const { id } = await approvedSession(req)
    const { rows } = await db.query(
      `SELECT event_key AS "eventKey", subject, status, attempts,
         created_at AS "createdAt", sent_at AS "sentAt"
       FROM trip_notifications WHERE user_id = $1 ORDER BY created_at DESC, event_key LIMIT 50`, [id],
    )
    res.json(rows)
  })
}
