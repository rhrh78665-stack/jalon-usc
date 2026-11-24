import { spawnSync } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { report } from './report.mjs'
await mkdir('quality-results', { recursive: true })
const result = spawnSync(process.execPath, [
  '--test', '--test-concurrency=2', '--experimental-test-coverage',
  '--test-coverage-include=server/auth.js', '--test-coverage-include=server/rules.js', '--test-coverage-include=server/liquidacion.js',
  '--test-reporter=lcov', '--test-reporter-destination=quality-results/coverage.lcov',
  '--test-reporter=spec', '--test-reporter-destination=stdout',
], { stdio: 'inherit' })
if (result.status !== 0) process.exit(result.status || 1)
const source = await readFile('quality-results/coverage.lcov', 'utf8')
const modules = []
for (const record of source.split('end_of_record')) {
  const path = record.match(/^SF:(.+)$/m)?.[1].replaceAll('\\', '/')
  if (!path) continue
  const total = Number(record.match(/^LF:(\d+)$/m)?.[1])
  const hit = Number(record.match(/^LH:(\d+)$/m)?.[1])
  modules.push({ path, total, hit, percent: total ? hit / total * 100 : 0 })
}
for (const name of ['auth', 'rules', 'liquidacion']) {
  const module = modules.find(module => module.path.endsWith('/' + name + '.js'))
  assert.ok(module, 'No hay cobertura de ' + name)
  assert.ok(module.percent >= 80, 'Cobertura insuficiente en ' + name + ': ' + module.percent)
}
await report('rnf025-coverage', { criterion: 'RNF-025', minimumPercentPerModule: 80, modules, passed: true })
