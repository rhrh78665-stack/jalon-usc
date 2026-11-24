import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { resolve } from 'node:path'
import { openDatabase } from '../server/db.js'
import { createApp } from '../server/app.js'
import { seedDemo } from '../server/demo.js'
import { report } from './report.mjs'

const db = await openDatabase()
await seedDemo(db)
const server = createApp(db, resolve('dist'), null).listen(0, '127.0.0.1')
await once(server, 'listening')
const url = 'http://127.0.0.1:' + server.address().port
const observations = []
const browsers = []
const errors = []
async function open(user, width) {
  const browser = await chromium.launch({
    ...(process.env.JALON_CHROMIUM_EXECUTABLE && { executablePath: process.env.JALON_CHROMIUM_EXECUTABLE }),
    args: JSON.parse(process.env.JALON_CHROMIUM_ARGS || '[]'),
  })
  browsers.push(browser)
  const context = await browser.newContext({ viewport: { width, height: 900 } })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(url)
  await page.getByRole('button', { name: 'Ya tengo cuenta', exact: true }).click()
  await page.getByLabel('Correo institucional', { exact: true }).fill(user + '.demo@usc.edu.co')
  await page.getByLabel('Contraseña', { exact: true }).fill('JalonDemo-2026!')
  await page.getByRole('button', { name: 'Entrar', exact: true }).click()
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).waitFor()
  return { page, browser, context }
}
const nav = (page, name) => page.getByRole('navigation', { name: 'Secciones de Jalón USC' }).getByRole('button', { name, exact: true }).click()
try {
  for (const width of [360, 768, 1366]) {
    const { page, browser } = await open('conductor', width)
    for (const section of ['Buscar viajes', 'Mis viajes', 'Reservas']) {
      await nav(page, section)
      await page.waitForTimeout(150)
      const dimensions = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }))
      assert.ok(dimensions.content <= dimensions.viewport, JSON.stringify({ width, section, dimensions }))
      observations.push({ width, section, ...dimensions })
    }
    await browser.close()
  }
  assert.deepEqual(errors, [])
  await report('rnf011-responsive', { criterion: 'RNF-011', observations, passed: true })
} finally {
  await Promise.all(browsers.map(browser => browser.close()))
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  await db.close()
}
