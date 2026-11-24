import { configurarCorreo } from './correo.js'
import express from 'express'
import { mountIncidents } from './incidentes.js'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { hashPassword, verifyPassword } from './auth.js'
import { mountMobility } from './movilidad.js'
import { mountVehicles } from './vehiculos.js'
import { mountTrips } from './viajes.js'
import { mountProfile } from './perfil.js'
import { mountRecovery, mountVerification } from './enlaces-cuenta.js'
import { institutionalEmail, requireRule, RuleError } from './rules.js'

const sessionMaxAge = 8 * 60 * 60 * 1000
const emptyHash = '00'.repeat(16) + ':' + '00'.repeat(32)

function sessionToken(req) {
    return (req.headers.cookie ?? '').match(
        /(?:^|;\s*)jalon_session=([a-f0-9]{64})(?:;|$)/,
    )?.[1]
}

function tokenDigest(token) {
    return createHash('sha256').update(token).digest('hex')
}

function sessionCookieOptions(req) {
    return {
        httpOnly: true,
        sameSite: 'lax',
        secure: req.secure || process.env.NODE_ENV === 'production',
        path: '/',
    }
}

async function approvedSession(db, req) {
    const token = sessionToken(req)
    requireRule(token, 'Sesión no activa.', 401)

    const { rows: [user] } = await db.query(
        `SELECT users.id, users.email, users.mobility FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = $1
       AND sessions.expires_at > CURRENT_TIMESTAMP
       AND users.status = 'approved'`,
        [tokenDigest(token)],
    )

    requireRule(user, 'Sesión no activa.', 401)
    return user
}

function sessionView(user) {
    return user.mobility ? { email: user.email, mobility: true } : { email: user.email }
}

export function createApp(db, dist, mail = configurarCorreo(process.env, Number(process.env.PORT ?? 3000))) {
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

    app.post('/api/login', async (req, res) => {
        requireRule(req.is('application/json'), 'Envía un cuerpo JSON.', 415)
        requireRule(
            req.body && typeof req.body === 'object' && !Array.isArray(req.body),
            'Completa los datos de acceso.',
        )
        const email = institutionalEmail(req.body.email)
        const { rows: [user] } = await db.query(
            'SELECT id, email, password, status, mobility FROM users WHERE email = $1',
            [email],
        )
        const matches = await verifyPassword(req.body.password, user?.password ?? emptyHash)
        const credentialsError = 'Credenciales inválidas o cuenta sin aprobar.'
        requireRule(user?.status === 'approved' && matches, credentialsError, 401)

        const token = randomBytes(32).toString('hex')
        const previous = sessionToken(req)
        await db.transaction(async (tx) => {
            const { rows } = await tx.query(
                `INSERT INTO sessions (token_hash, user_id, expires_at)
         SELECT $1, id, $2 FROM users WHERE id = $3 AND status = 'approved' AND password = $4
         FOR SHARE
         RETURNING user_id`,
        [tokenDigest(token), new Date(Date.now() + sessionMaxAge).toISOString(), user.id, user.password],
            )
            requireRule(rows.length === 1, credentialsError, 401)
            if (previous) {
                await tx.query('DELETE FROM sessions WHERE token_hash = $1', [tokenDigest(previous)])
            }
        })

        res.cookie('jalon_session', token, {
            ...sessionCookieOptions(req),
            maxAge: sessionMaxAge,
        }).json(sessionView(user))
    })

    app.get('/api/session', async (req, res) => {
        res.json(sessionView(await approvedSession(db, req)))
    })

    app.post('/api/logout', async (req, res) => {
        requireRule(req.is('application/json'), 'Envía un cuerpo JSON.', 415)

        const token = sessionToken(req)
        if (token) {
            await db.query('DELETE FROM sessions WHERE token_hash = $1', [tokenDigest(token)])
        }

        res.clearCookie('jalon_session', sessionCookieOptions(req)).status(204).end()
    })

    mountMobility(app, db, req => approvedSession(db, req))
    mountVehicles(app, db, req => approvedSession(db, req))
  mountTrips(app, db, req => approvedSession(db, req))
  mountProfile(app, db, req => approvedSession(db, req))
  mountRecovery(app, db, mail)
  mountVerification(app, db, mail)

    mountIncidents(app, db, req => approvedSession(db, req))

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
        console.error('Error de solicitud', error.code ?? error.name)
        res.status(500).json({ message: 'No se pudo procesar la solicitud.' })
    })

    return app
}
