import { resolve } from 'node:path'
import { createApp } from './app.js'
import { openDatabase } from './db.js'

const db = await openDatabase(resolve('data/pg'))
const port = Number(process.env.PORT ?? 3000)

const app = createApp(db, resolve('dist'))
const server = app.listen(port, '127.0.0.1', () => {
    console.log(`Jalón USC: http://127.0.0.1:${port}`)
})

const expiration = setInterval(() => {
    app.locals.expirarReservas().catch(() => console.error('No se pudo actualizar el vencimiento de reservas.'))
}, 15000)
expiration.unref()
server.once('close', () => clearInterval(expiration))

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
        server.close(async () => {
            await db.close()
            process.exit(0)
        })
    })
}