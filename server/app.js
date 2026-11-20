import express from 'express'
import { randomUUID } from 'node:crypto'
import { hashPassword } from './auth.js'
import { institutionalEmail, requireRule, RuleError } from './rules.js'

export function createApp(db, dist) {
    const app = express()
    app.disable('x-powered-by')

    app.use('/api', (_req, res, next) => {
        res.set('Cache-Control', 'no-store')
        next()
    })

    app.use('/api', express.json({ limit: '8kb' }))

    app.post('/api/register', async (req, res) => {
        requireRule(req.is('application/json'), 'Envía un cuerpo JSON.', 415)
        requireRule(
            req.body && typeof req.body === 'object' && !Array.isArray(req.body),
            'Completa los datos de registro.',
        )

        const email = institutionalEmail(req.body.email)
        const password = await hashPassword(req.body.password)

        const { rows } = await db.query(
            `INSERT INTO users (id, email, password, status)
       VALUES ($1, $2, $3, 'pending')
       ON CONFLICT (email) DO NOTHING
       RETURNING status`,
            [randomUUID(), email, password],
        )

        requireRule(rows.length === 1, 'Ese correo ya tiene una cuenta.', 409)
        res.status(201).json({ status: rows[0].status })
    })

    if (dist) app.use(express.static(dist))

    app.use((error, _req, res, _next) => {
        if (error instanceof RuleError) {
            return res.status(error.status).json({ message: error.message })
        }

        if (error.type === 'entity.parse.failed') {
            return res.status(400).json({ message: 'El JSON enviado es inválido.' })
        }

        if (error.type === 'entity.too.large') {
            return res.status(413).json({ message: 'La solicitud supera el tamaño permitido.' })
        }

        console.error('Error de registro', error.code ?? error.name)
        res.status(500).json({ message: 'El registro no está disponible en este momento.' })
    })

    return app
}