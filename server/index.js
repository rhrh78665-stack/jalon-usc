import { resolve } from 'node:path'
import { createApp } from './app.js'
import { openDatabase } from './db.js'

const db = await openDatabase(resolve('data/pg'))
const port = Number(process.env.PORT ?? 3000)

const server = createApp(db, resolve('dist')).listen(port, '127.0.0.1', () => {
    console.log(`Jalón USC: http://127.0.0.1:${port}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
        server.close(async () => {
            await db.close()
            process.exit(0)
        })
    })
}