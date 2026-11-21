import { requireRule } from './rules.js'

const fields = 'email, alias, trip_email_opt_in AS "tripEmailOptIn"'

export function mountProfile(app, db, approvedSession) {
  app.get('/api/profile', async (req, res) => {
    const { id } = await approvedSession(req)
    const { rows: [profile] } = await db.query(
      `SELECT ${fields} FROM users WHERE id = $1`,
      [id],
    )
    res.json(profile)
  })

  app.put('/api/profile', async (req, res) => {
    const { id } = await approvedSession(req)
    requireRule(req.is('application/json'), 'Envía un cuerpo JSON.', 415)

    const body = req.body ?? {}
    requireRule(
      Object.keys(body).every(key => key === 'alias' || key === 'tripEmailOptIn'),
      'Hay campos de perfil que no se pueden modificar.',
    )
    const alias = typeof body.alias === 'string' ? body.alias.trim() : ''
    requireRule(
      alias.length >= 2 && alias.length <= 40 && !/[\p{Cc}\p{Cf}]/u.test(alias),
      'El alias debe tener entre 2 y 40 caracteres visibles.',
    )
    requireRule(typeof body.tripEmailOptIn === 'boolean', 'Indica tu preferencia de correo.')

    const { rows: [profile] } = await db.query(
      `UPDATE users SET alias = $1, trip_email_opt_in = $2
       WHERE id = $3 AND status = 'approved' RETURNING ${fields}`,
      [alias, body.tripEmailOptIn, id],
    )
    requireRule(profile, 'Sesión no activa.', 401)
    res.json(profile)
  })
}
