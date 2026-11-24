import { createServer as createHttpsServer } from 'node:https'
import { readFile } from 'node:fs/promises'
import { scheduleBackups } from './backups.js'
import { once } from 'node:events'
import { resolve } from 'node:path'
import { createApp } from './app.js'
import { openDatabase } from './db.js'

export async function startServer(db, port, { cleanup = async () => {}, mail } = {}) {
    const app = createApp(db, resolve('dist'), mail)

    const keyFile = process.env.JALON_TLS_KEY
    const certFile = process.env.JALON_TLS_CERT
    if (Boolean(keyFile) !== Boolean(certFile)) throw new Error('Configura JALON_TLS_KEY y JALON_TLS_CERT juntos.')
    if (process.env.NODE_ENV === 'production' && !keyFile && !process.env.JALON_TRUST_PROXY) {
        throw new Error('Producción requiere un certificado TLS o un proxy HTTPS de confianza configurado.')
    }
    const listener = keyFile ? createHttpsServer({
        key: await readFile(keyFile), cert: await readFile(certFile),
    }, app) : app
    const server = listener.listen(port, process.env.JALON_HOST || '127.0.0.1')
    await once(server, 'listening')

    const backupDirectory = process.env.JALON_BACKUP_DIR || (process.env.NODE_ENV === 'production' ? 'backups' : null)
    const backups = backupDirectory ? scheduleBackups(db, resolve(backupDirectory)) : null
    if (backups) await backups.initial

    const expiration = setInterval(() => {
        app.locals.procesarAvisos().catch(() => console.error('No se pudo actualizar la entrega de avisos.'))
        app.locals.expirarReservas().catch(() => console.error('No se pudo actualizar el vencimiento de reservas.'))
    }, 15000)
    expiration.unref()

    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.once(signal, () => {
            clearInterval(expiration)
            backups?.stop()
            server.close(async () => {
                await db.close()
                await cleanup()
            })
            server.closeAllConnections()
        })
    }

    return (keyFile ? 'https://127.0.0.1:' : 'http://127.0.0.1:') + server.address().port
}

if (import.meta.main) {
    const db = await openDatabase(resolve('data/pg'))
    try {
        console.log('Jalón USC: ' + await startServer(db, Number(process.env.PORT ?? 3000)))
    } catch (error) {
        await db.close()
        throw error
    }
}
