import { requireRule } from './rules.js'

const roles = ['estudiante', 'docente', 'administrativo']
const bogotaToday = "(CURRENT_TIMESTAMP AT TIME ZONE 'America/Bogota')::date"

function licenseDate(value) {
    requireRule(
        typeof value === 'string' && /^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value),
        'Ingresa la fecha de vencimiento de la licencia.',
    )

    const instant = new Date(value + 'T00:00:00Z')
    requireRule(
        !Number.isNaN(instant.getTime()) && instant.toISOString().slice(0, 10) === value,
        'La fecha de vencimiento no es válida.',
    )

    return value
}

export function mountMobility(app, db, approvedSession) {
    app.use('/api/movilidad', async (req, _res, next) => {
        const reviewer = await approvedSession(req)
        requireRule(reviewer.mobility, 'Esta operación corresponde a Movilidad.', 403)
        req.reviewerId = reviewer.id
        next()
    })

    app.get('/api/movilidad/solicitudes', async (_req, res) => {
        const { rows } = await db.query(
            "SELECT id, email FROM users WHERE status = 'pending' AND mobility = false ORDER BY email",
        )
        res.json(rows)
    })

    app.post('/api/movilidad/solicitudes/:id', async (req, res) => {
        requireRule(req.is('application/json'), 'Envía un cuerpo JSON.', 415)

        const { code, role, decision } = req.body ?? {}

        requireRule(
            typeof code === 'string' && /^\d{5,12}$/.test(code),
            'El código universitario debe tener entre 5 y 12 dígitos.',
        )
        requireRule(roles.includes(role), 'Selecciona el rol declarado.')
        requireRule(
            decision === 'approved' || decision === 'rejected',
            'Selecciona una decisión válida.',
        )

        try {
            await db.transaction(async tx => {
                const { rows: [user] } = await tx.query(
                    'SELECT status FROM users WHERE id = $1 AND mobility = false FOR UPDATE',
                    [req.params.id],
                )

                requireRule(user, 'Cuenta no disponible.', 404)
                requireRule(user.status === 'pending', 'La solicitud ya fue revisada.', 409)

                if (decision === 'approved') {
                    const { rows } = await tx.query(
                        'SELECT code FROM roster WHERE code = $1 AND role = $2',
                        [code, role],
                    )

                    requireRule(
                        rows.length === 1,
                        'El código y el rol no coinciden con el padrón de prueba.',
                        409,
                    )
                }

                await tx.query(
                    `INSERT INTO membership_reviews (user_id, reviewer_id, code, declared_role, decision)
           VALUES ($1, $2, $3, $4, $5)`,
                    [req.params.id, req.reviewerId, code, role, decision],
                )

                await tx.query(
                    'UPDATE users SET status = $2 WHERE id = $1',
                    [req.params.id, decision],
                )
            })
        } catch (error) {
            requireRule(
                error.constraint !== 'approved_membership_code',
                'Ese código ya está vinculado a otra cuenta.',
                409,
            )
            throw error
        }

        res.json({ status: decision })
    })

    app.get('/api/movilidad/conductores', async (_req, res) => {
        const { rows } = await db.query(
            `SELECT u.id, u.email, to_char(p.license_expires_on, 'YYYY-MM-DD') AS "expiresOn",
              COALESCE(p.license_expires_on >= ${bogotaToday}, false) AS enabled
       FROM users u
       LEFT JOIN driver_permissions p ON p.user_id = u.id
       WHERE u.status = 'approved' AND u.mobility = false
       ORDER BY u.email`,
        )

        res.json(rows)
    })

    app.post('/api/movilidad/conductores/:id', async (req, res) => {
        requireRule(req.is('application/json'), 'Envía un cuerpo JSON.', 415)

        const expiresOn = licenseDate(req.body?.expiresOn)
        const { rows: [permission] } = await db.query(
            `INSERT INTO driver_permissions (user_id, reviewer_id, license_expires_on)
       SELECT id, $2, $3::date FROM users
       WHERE id = $1 AND status = 'approved' AND mobility = false
         AND $3::date >= ${bogotaToday}
       ON CONFLICT (user_id) DO UPDATE SET
         reviewer_id = EXCLUDED.reviewer_id,
         license_expires_on = EXCLUDED.license_expires_on,
         enabled_at = CURRENT_TIMESTAMP
       RETURNING user_id`,
            [req.params.id, req.reviewerId, expiresOn],
        )

        requireRule(permission, 'La cuenta debe estar aprobada y la licencia vigente.', 409)
        res.json({ id: permission.user_id, expiresOn, enabled: true })
    })
}