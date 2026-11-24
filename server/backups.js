import { mkdir, writeFile, rename, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

export async function backupDatabase(db, directory = 'backups') {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const snapshotStartedAt = new Date().toISOString()
  const bytes = Buffer.from(await (await db.dumpDataDir()).arrayBuffer())
  const name = 'jalon-' + Date.now() + '-' + randomUUID() + '.tar'
  const file = join(directory, name)
  const temporary = file + '.tmp'
  await writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' })
  await rename(temporary, file)
  const metadata = { format: 'pglite-data-dir', snapshotStartedAt, completedAt: new Date().toISOString(), sha256: digest(bytes), bytes: bytes.length }
  await writeFile(file + '.json.tmp', JSON.stringify(metadata, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
  await rename(file + '.json.tmp', file + '.json')
  return { file, ...metadata }
}

export async function restoreDatabase(file, destination) {
  const target = resolve(destination)
  try { await stat(target); throw new Error('El destino de restauración ya existe. Elige una carpeta nueva.') }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const bytes = await readFile(file)
  const metadata = JSON.parse(await readFile(file + '.json', 'utf8'))
  if (metadata.format !== 'pglite-data-dir' || metadata.bytes !== bytes.length || metadata.sha256 !== digest(bytes)) throw new Error('El respaldo no supera la verificación de integridad.')
  const db = new PGlite(target, { loadDataDir: new Blob([bytes]) })
  try { await db.waitReady; await db.query('SELECT 1') }
  catch (error) { await db.close(); throw error }
  await db.close()
  return { destination: target, snapshotStartedAt: metadata.snapshotStartedAt }
}

export function scheduleBackups(db, directory) {
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try { await backupDatabase(db, directory) }
    catch { console.error('No se pudo completar el respaldo programado.') }
    finally { running = false }
  }
  const timer = setInterval(run, 12 * 60 * 60 * 1000)
  timer.unref()
  return { initial: run(), stop: () => clearInterval(timer) }
}
