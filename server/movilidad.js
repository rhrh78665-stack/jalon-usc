import { requireRule } from './rules.js'

const roles = ['estudiante', 'docente', 'administrativo']

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
}