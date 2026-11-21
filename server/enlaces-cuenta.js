import { createHash, randomBytes } from 'node:crypto'
import { hashPassword } from './auth.js'
import { institutionalEmail, requireRule } from './rules.js'

const actions = {
  recover: { minutes: 30, subject: 'Recuperación de acceso a Jalón USC' },
  verify: { minutes: 60, subject: 'Verificación de correo en Jalón USC' },
}

const hash = value => createHash('sha256').update(value).digest('hex')

async function sendLink(db, mail, purpose, email) {
  const token = randomBytes(32).toString('hex')
  const digest = hash(token)
  const { minutes, subject } = actions[purpose]
  const { rows: [issued] } = await db.query(
    `INSERT INTO account_links (user_id, purpose, token_hash, expires_at)
     SELECT id, $2, $3, CURRENT_TIMESTAMP + $4::int * interval '1 minute'
     FROM users WHERE email = $1 AND (
       ($2 = 'recover' AND status = 'approved') OR
       ($2 = 'verify' AND status IN ('pending', 'approved') AND email_verified_at IS NULL)
     )
     ON CONFLICT (user_id, purpose) DO UPDATE SET
       token_hash = EXCLUDED.token_hash, expires_at = EXCLUDED.expires_at,
       issued_at = CURRENT_TIMESTAMP
     WHERE account_links.issued_at <= CURRENT_TIMESTAMP - interval '60 seconds'
     RETURNING user_id`,
    [email, purpose, digest, minutes],
  )
  if (!issued) return

  const link = new URL('/', mail.origin)
  link.hash = new URLSearchParams({ action: purpose, token }).toString()
  try {
    await mail.send({ to: [email], subject, text: `Abre este enlace antes de ${minutes} minutos:\n${link}` })
  } catch (error) {
    await db.query('DELETE FROM account_links WHERE token_hash = $1', [digest])
    throw error
  }
}

function mountRequest(app, db, mail, purpose) {
  app.post(`/api/account/${purpose}/request`, (req, res) => {
    requireRule(req.is('application/json'), 'Envía un cuerpo JSON.', 415)
    const email = institutionalEmail(req.body?.email)
    requireRule(mail, 'El servicio de correo no está disponible.', 503)

    res.status(202).json({ message: 'Si la cuenta cumple las condiciones, recibirás un enlace.' })
    sendLink(db, mail, purpose, email).catch(() => console.error('No se pudo enviar un enlace de cuenta.'))
  })
}

function tokenHash(req) {
  requireRule(req.is('application/json'), 'Envía un cuerpo JSON.', 415)
  const token = req.body?.token
  requireRule(typeof token === 'string' && /^[0-9a-f]{64}$/.test(token), 'Enlace inválido o vencido.')
  return hash(token)
}

async function consume(tx, purpose, digest) {
  const { rows: [link] } = await tx.query(
    `DELETE FROM account_links
     WHERE token_hash = $1 AND purpose = $2 AND expires_at > clock_timestamp()
     RETURNING user_id`,
    [digest, purpose],
  )
  requireRule(link, 'Enlace inválido, usado o vencido.')
  return link.user_id
}

export function mountRecovery(app, db, mail) {
  mountRequest(app, db, mail, 'recover')
  app.post('/api/account/recover/confirm', async (req, res) => {
    const digest = tokenHash(req)
    const password = await hashPassword(req.body?.password)
    await db.transaction(async tx => {
      const id = await consume(tx, 'recover', digest)
      const { rows: [user] } = await tx.query(
        "UPDATE users SET password = $1 WHERE id = $2 AND status = 'approved' RETURNING id",
        [password, id],
      )
      requireRule(user, 'Enlace inválido, usado o vencido.')
      await tx.query('DELETE FROM sessions WHERE user_id = $1', [id])
    })
    res.json({ message: 'Contraseña actualizada. Ya puedes iniciar sesión.' })
  })
}

export function mountVerification(app, db, mail) {
  mountRequest(app, db, mail, 'verify')
  app.post('/api/account/verify/confirm', async (req, res) => {
    const digest = tokenHash(req)
    await db.transaction(async tx => {
      const id = await consume(tx, 'verify', digest)
      const { rows: [user] } = await tx.query(
        `UPDATE users SET email_verified_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND email_verified_at IS NULL AND status IN ('pending', 'approved')
         RETURNING id`,
        [id],
      )
      requireRule(user, 'Enlace inválido, usado o vencido.')
    })
    res.json({ message: 'Correo verificado.' })
  })
}
