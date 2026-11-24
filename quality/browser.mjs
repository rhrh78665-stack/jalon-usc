import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
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
async function keyboardActivate(page, locator) {
  for (let index = 0; index < 150; index++) {
    if (await locator.evaluate(element => element === document.activeElement)) {
      assert.ok(await locator.evaluate(element => getComputedStyle(element).outlineStyle !== 'none'))
      await page.keyboard.press('Enter')
      return
    }
    await page.keyboard.press('Tab')
  }
  throw new Error('Acción no alcanzable con Tab: ' + await locator.textContent())
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
      await page.evaluate(await readFile(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8'))
      const contrast = await page.evaluate(async () => {
        const result = await axe.run(document, { runOnly: { type: 'rule', values: ['color-contrast'] } })
        return { violations: result.violations, incomplete: result.incomplete }
      })
      assert.deepEqual(contrast.violations, [], 'Contraste ' + section)
      assert.ok(contrast.incomplete.every(rule => rule.nodes.every(node => node.html.startsWith('<text'))), 'Hay elementos pendientes fuera del SVG')
      const svgRatios = await page.evaluate(() => {
        const luminance = value => {
          const rgb = value.match(/[0-9.]+/g).slice(0, 3).map(Number).map(channel => {
            const n = channel / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4
          })
          return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722
        }
        return [...document.querySelectorAll('.workspace-panel:not([hidden]) .stop-map text')].map(text => {
          const background = /^\d+$/.test(text.textContent.trim()) ? text.parentElement.querySelector('circle') : text.closest('svg').querySelector('rect')
          const a = luminance(getComputedStyle(text).fill)
          const b = luminance(getComputedStyle(background).fill)
          return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
        })
      })
      assert.ok(svgRatios.every(ratio => ratio >= 4.5), 'Contraste del texto del mapa')

    }
    await browser.close()
  }
  const { page: keyboardPage, browser: keyboardBrowser } = await open('pasajero', 1366)
  await keyboardActivate(keyboardPage, keyboardPage.getByRole('button', { name: 'Buscar viajes', exact: true }).last())
  await keyboardActivate(keyboardPage, keyboardPage.getByRole('button', { name: 'Ver detalle y aporte', exact: true }))
  await keyboardActivate(keyboardPage, keyboardPage.getByRole('button', { name: 'Solicitar asiento', exact: true }))
  await keyboardPage.getByText(/Solicitud registrada/).waitFor()
  await report('rnf012-keyboard', { criterion: 'RNF-012', actions: ['navegación', 'buscar', 'detalle', 'solicitar'], passed: true })
  await keyboardBrowser.close()
  assert.deepEqual(errors, [])
  await report('rnf013-contrast', { criterion: 'RNF-013', viewports: [360, 768, 1366], sections: ['buscar', 'publicar', 'reservas'], violations: 0, passed: true })
  await report('rnf011-responsive', { criterion: 'RNF-011', observations, passed: true })
} finally {
  await Promise.all(browsers.map(browser => browser.close()))
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
  await db.close()
}
