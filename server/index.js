import { once } from 'node:events'
import { resolve } from 'node:path'
import { createApp } from './app.js'
import { openDatabase } from './db.js'

export async function startServer(db, port, { cleanup = async () => {}, mail } = {}) {
    const app = createApp(db, resolve('dist'), mail)
    const server = app.listen(port, '127.0.0.1')
    await once(server, 'listening')

    const expiration = setInterval(() => {
        app.locals.procesarAvisos().catch(() => console.error('No se pudo actualizar la entrega de avisos.'))
        app.locals.expirarReservas().catch(() => console.error('No se pudo actualizar el vencimiento de reservas.'))
    }, 15000)
    expiration.unref()

    for (const signal of ['SIGINT', 'SIGTERM']) {
        process.once(signal, () => {
            clearInterval(expiration)
            server.close(async () => {
                await db.close()
                await cleanup()
            })
            server.closeAllConnections()
        })
    }

    return 'http://127.0.0.1:' + server.address().port
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
