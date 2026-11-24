import { readFile, appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { report } from './report.mjs'

export function summarize(records, start, end) {
  const slots = Math.max(1, Math.ceil((end - start) / 60000))
  const map = new Map()
  for (const record of records) if (record.slot >= 0 && record.slot < slots && !map.has(record.slot)) map.set(record.slot, record.ok === true)
  const successful = [...map.values()].filter(Boolean).length
  const availability = successful / slots
  const complete = slots >= 43200 && end - start >= 30 * 86400000
  return { slots, successful, missing: slots - map.size, availability, complete, passed: complete ? availability >= .995 : null }
}

if (import.meta.main) {
  const url = new URL(process.argv[2] || 'http://127.0.0.1:3001/api/health')
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('URL de salud inválida.')
  const file = process.argv[3] || 'quality-results/availability.jsonl'
  await mkdir(dirname(file), { recursive: true })
  let lines = []
  try { lines = (await readFile(file, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  if (!lines.length) { const meta = { start: Date.now(), url: String(url) }; await appendFile(file, JSON.stringify(meta) + '\n'); lines.push(meta) }
  const meta = lines[0]
  if (meta.url !== String(url)) throw new Error('La evidencia pertenece a otra URL.')
  const records = lines.slice(1)
  let stop = false
  process.on('SIGINT', () => { stop = true })
  process.on('SIGTERM', () => { stop = true })
  while (!stop && Date.now() < meta.start + 30 * 86400000) {
    const slot = Math.floor((Date.now() - meta.start) / 60000)
    if (!records.some(record => record.slot === slot)) {
      const started = performance.now()
      let ok = false
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(10000), redirect: 'error' })
        const result = await response.json()
        ok = response.status === 200 && result.status === 'ok' && result.database === 'ok'
      } catch {}
      const record = { slot, at: new Date().toISOString(), ok, milliseconds: performance.now() - started }
      await appendFile(file, JSON.stringify(record) + '\n')
      records.push(record)
      console.log(JSON.stringify(record))
    }
    if (process.argv.includes('--once')) break
    const next = meta.start + (slot + 1) * 60000
    while (!stop && Date.now() < next) await delay(Math.min(1000, next - Date.now()))
  }
  await report('rnf021-availability', { criterion: 'RNF-021', url: String(url), start: new Date(meta.start).toISOString(), ...summarize(records, meta.start, Date.now()) })
}
