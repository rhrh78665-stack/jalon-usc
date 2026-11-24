import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabase } from '../server/db.js'
import { seedDemo } from '../server/demo.js'
import { createApp } from '../server/app.js'
import { report } from './report.mjs'
const start = performance.now()
const folder = await mkdtemp(join(tmpdir(), 'jalon-rebuild-'))
let db, server
try {
  db = await openDatabase(join(folder, 'pg'))
  await seedDemo(db)
  server = createApp(db, undefined, null).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const response = await fetch('http://127.0.0.1:' + server.address().port + '/api/health')
  assert.equal(response.status, 200)
  assert.equal((await response.json()).database, 'ok')
  assert.equal((await db.query('SELECT count(*)::int AS n FROM users')).rows[0].n, 4)
  const seconds = (performance.now() - start) / 1000
  await report('rnf019-rebuild', { criterion: 'RNF-019', seconds, maximumSeconds: 900, passed: seconds <= 900 })
  assert.ok(seconds <= 900)
} finally {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  if (db) await db.close()
  await rm(folder, { recursive: true, force: true })
}
