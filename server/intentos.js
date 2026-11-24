import { createHash } from 'node:crypto'

const key = email => createHash('sha256').update(email).digest('hex')

export async function accountBlocked(db, email) {
  const { rows: [row] } = await db.query(
    'SELECT blocked_until > clock_timestamp() AS blocked FROM login_attempts WHERE account_hash = $1', [key(email)],
  )
  return Boolean(row?.blocked)
}

export async function recordAttempt(db, email, valid) {
  return db.transaction(async tx => {
    const digest = key(email)
    await tx.query('INSERT INTO login_attempts (account_hash) VALUES ($1) ON CONFLICT DO NOTHING', [digest])
    const { rows: [row] } = await tx.query(
      'SELECT *, clock_timestamp() AS now FROM login_attempts WHERE account_hash = $1 FOR UPDATE', [digest],
    )
    const now = new Date(row.now).getTime()
    if (row.blocked_until && new Date(row.blocked_until).getTime() > now) return false
    if (valid) {
      await tx.query('DELETE FROM login_attempts WHERE account_hash = $1', [digest])
      return true
    }
    const expired = now - new Date(row.window_started).getTime() >= 15 * 60 * 1000 || row.blocked_until
    const count = expired ? 1 : row.failures + 1
    await tx.query(
      'UPDATE login_attempts SET failures = $2, window_started = $3, blocked_until = $4 WHERE account_hash = $1',
      [digest, count, expired ? row.now : row.window_started, count >= 5 ? new Date(now + 900000).toISOString() : null],
    )
    return count < 5
  })
}
