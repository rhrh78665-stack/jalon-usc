import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert/strict'
import { openDatabase } from '../server/db.js'
import { seedDemo } from '../server/demo.js'
import { backupDatabase, restoreDatabase } from '../server/backups.js'
import { report } from './report.mjs'

if (process.argv[2] === 'restore') {
  if (!process.argv[3] || !process.argv[4]) throw new Error('Indica archivo.tar y una carpeta de destino que no exista.')
  console.log(JSON.stringify(await restoreDatabase(process.argv[3], process.argv[4])))
} else {
  const folder = await mkdtemp(join(tmpdir(), 'jalon-recovery-'))
  let db, restored
  try {
    db = await openDatabase(join(folder, 'source'))
    await seedDemo(db)
    const expectedTrips = (await db.query('SELECT count(*)::int AS n FROM trips')).rows[0].n
    const snapshot = await backupDatabase(db, join(folder, 'backups'))
    const started = Date.now()
    await db.close(); db = null
    const destination = join(folder, 'restored')
    await restoreDatabase(snapshot.file, destination)
    restored = await openDatabase(destination)
    const rows = (await restored.query('SELECT id FROM users ORDER BY id')).rows
    assert.deepEqual(rows.map(row => row.id), ['demo-driver', 'demo-mobility', 'demo-passenger', 'demo-second'])
    assert.equal((await restored.query("SELECT count(*)::int AS n FROM trips")).rows[0].n, expectedTrips)
    const rtoSeconds = (Date.now() - started) / 1000
    const rpoSeconds = (started - Date.parse(snapshot.snapshotStartedAt)) / 1000
    assert.ok(rtoSeconds <= 14400 && rpoSeconds <= 86400)
    await assert.rejects(restoreDatabase(snapshot.file, destination), /ya existe/)
    await report('rnf022-recovery', { criterion: 'RNF-022', environment: 'simulacro local sintético', rtoSeconds, rpoSeconds, backupSha256: snapshot.sha256, passed: true })
  } finally {
    if (db) await db.close()
    if (restored) await restored.close()
    await rm(folder, { recursive: true, force: true })
  }
}
