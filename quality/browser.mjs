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
const demoDate = await seedDemo(db)
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
  await keyboardActivate(page, page.locator('.header-access'))
  await page.locator('.auth-dialog[open]').waitFor()
  await page.getByLabel('Correo institucional', { exact: true }).fill(user + '.demo@usc.edu.co')
  await page.getByLabel('Contraseña', { exact: true }).fill('JalonDemo-2026!')
  await keyboardActivate(page, page.locator('.auth-dialog button[type="submit"]'))
  await page.locator('.session-indicator').waitFor()
  return { page, browser, context }
}
async function keyboardFocus(page, locator) {
  for (let index = 0; index < 150; index++) {
    if (await locator.evaluate(element => element === document.activeElement)) {
      assert.ok(await locator.evaluate(element => getComputedStyle(element).outlineStyle !== 'none'))
      return
    }
    await page.keyboard.press('Tab')
  }
  throw new Error('Acción no alcanzable con Tab: ' + await locator.textContent())
}
async function keyboardActivate(page, locator) {
  await keyboardFocus(page, locator)
  await page.keyboard.press('Enter')
}
async function nav(page,name) {
  const destinations={
    'Buscar viajes':['Rutas','Rutas disponibles'],
    'Mis viajes':['Conducir','Mis ofertas'],
    'Reservas':['Reservas','Todas mis reservas'],
    'Solicitudes':['Solicitudes','Todas las solicitudes'],
    'Historial':['Historial','Todas mis carreras'],
  }
  const [group,item]=destinations[name]||['Comunidad','Quiénes somos']
  await keyboardActivate(page,page.getByRole('navigation',{name:'Navegación principal'}).getByRole('button',{name:group,exact:true}))
  await keyboardActivate(page,page.locator('.mega-items button').filter({has:page.getByText(item,{exact:true})}))
}
try {
  for (const width of [360, 768, 1366]) {
    const { page, browser } = await open('conductor', width)
    for (const section of ['Mis viajes', 'Solicitudes', 'Historial']) {
      await nav(page, section)
      await page.waitForTimeout(450)
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
  const { page: publishPage, browser: publishBrowser } = await open('conductor', 1366)
  await nav(publishPage,'Mis viajes')
  await keyboardActivate(publishPage, publishPage.getByRole('button', { name: /^Publicar recorrido/ }))
  const draft = [
    ['#trip-vehicle', 'demo-car'], ['#trip-departure', demoDate + 'T18:00'], ['#trip-capacity', '2'],
    ['#trip-stop-0', 'melendez'], ['#trip-stop-0-time', demoDate + 'T18:00'],
    ['#trip-stop-1', 'usc'], ['#trip-stop-1-time', demoDate + 'T18:30'],
  ]
  for (const [selector, value] of draft) {
    const field = publishPage.locator(selector)
    await keyboardFocus(publishPage, field)
    if (await field.evaluate(element => element.tagName === 'SELECT')) await field.selectOption(value)
    else if (await field.getAttribute('readonly') !== null) assert.equal(await field.inputValue(), value)
    else await field.fill(value)
  }
  await keyboardActivate(publishPage,publishPage.getByRole('button',{name:'Calcular y revisar recorrido',exact:true}))
  await publishPage.locator('.route-plan-summary').waitFor()
  await keyboardActivate(publishPage, publishPage.getByRole('button', { name: 'Publicar viaje', exact: true }))
  await publishPage.getByText('Viaje publicado.', { exact: true }).waitFor()
  await publishBrowser.close()
  const { page: keyboardPage, browser: keyboardBrowser } = await open('pasajero', 1366)
  await nav(keyboardPage,'Buscar viajes')
  await keyboardPage.getByLabel('Otra fecha',{exact:true}).fill(demoDate)
  await keyboardPage.locator('#published-route').selectOption('melendez|usc')
  await keyboardActivate(keyboardPage,keyboardPage.locator('[data-trip-id="demo-search"]').getByRole('button',{name:/^Ver paradas/}))
  const requested = keyboardPage.waitForResponse(response => response.url().endsWith('/api/trips/demo-search/reservations') && response.request().method() === 'POST')
  await keyboardActivate(keyboardPage, keyboardPage.getByRole('button', { name: /^Reservar asiento/ }))
  assert.equal((await requested).status(), 201)
  await report('rnf012-keyboard', { criterion: 'RNF-012', actions: ['ingreso', 'navegación', 'publicar', 'buscar', 'detalle', 'solicitar'], passed: true })
  await nav(keyboardPage, 'Reservas')
  const driverLogin = await fetch(url + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'conductor.demo@usc.edu.co', password: 'JalonDemo-2026!' }) })
  const driverCookie = driverLogin.headers.get('set-cookie').split(';')[0]
  const mutation = async (path, options) => {
    const response = await fetch(url + path, { ...options, headers: { Cookie: driverCookie, 'Content-Type': 'application/json' }, body: JSON.stringify(options.body) })
    assert.ok(response.ok, await response.clone().text())
    return response.json()
  }
  async function changedAt(id) {
    return new Date((await db.query('SELECT changed_at FROM reservations WHERE id = $1', [id])).rows[0].changed_at).getTime()
  }
  const initial = (await db.query("SELECT id FROM reservations WHERE trip_id = 'demo-search' AND passenger_id = 'demo-passenger' AND status = 'Pendiente'")).rows
  for (const row of initial) await mutation('/api/reservations/' + row.id + '/decision', { method: 'PATCH', body: { decision: 'rechazar' } })
  const latencies = []
  for (let index = 0; index < 25; index++) {
    const created = await keyboardPage.request.post(url + '/api/trips/demo-search/reservations', { data: { origin: 'melendez', destination: 'usc' } })
    assert.equal(created.status(), 201)
    const booking = await created.json()
    const row = keyboardPage.locator('[data-reservation-id="' + booking.id + '"]')
    await row.locator('[data-status="Pendiente"]').waitFor()
    latencies.push(Date.now() - await changedAt(booking.id))
    await mutation('/api/reservations/' + booking.id + '/decision', { method: 'PATCH', body: { decision: 'rechazar' } })
    await row.locator('[data-status="Rechazada"]').waitFor()
    latencies.push(Date.now() - await changedAt(booking.id))
  }
  latencies.sort((a, b) => a - b)
  const p95 = latencies[Math.ceil(latencies.length * .95) - 1]
  assert.ok(p95 <= 2000, 'p95 SSE: ' + p95)
  await report('rnf002-sse-visible', { criterion: 'RNF-002', samples: latencies.length, transport: 'SSE', persistenceToVisibleP95Milliseconds: p95, passed: true })
  const reconnections = []
  for (let index = 0; index < 10; index++) {
    const created = await keyboardPage.request.post(url + '/api/trips/demo-search/reservations', { data: { origin: 'melendez', destination: 'usc' } })
    const booking = await created.json()
    await keyboardPage.locator('[data-reservation-id="' + booking.id + '"] [data-status="Pendiente"]').waitFor()
    const context = keyboardPage.context()
    await context.setOffline(true)
    await keyboardPage.getByText('Sin conexión. Conéctate para consultar o guardar cambios.', { exact: true }).waitFor()
    await mutation('/api/reservations/' + booking.id + '/decision', { method: 'PATCH', body: { decision: 'rechazar' } })
    const start = Date.now()
    await context.setOffline(false)
    await keyboardPage.locator('[data-reservation-id="' + booking.id + '"] [data-status="Rechazada"]').waitFor({ timeout: 10000 })
    reconnections.push(Date.now() - start)
  }
  assert.ok(reconnections.every(value => value <= 10000))
  await report('rnf024-reconnections', { criterion: 'RNF-024', samples: 10, milliseconds: reconnections, passed: true })
  await keyboardPage.context().route('**/api/trips/events', route => route.abort())
  await keyboardPage.reload()
  await nav(keyboardPage, 'Reservas')
  const fallback = []
  for (let index = 0; index < 3; index++) {
    const created = await keyboardPage.request.post(url + '/api/trips/demo-search/reservations', { data: { origin: 'melendez', destination: 'usc' } })
    assert.equal(created.status(), 201)
    const booking = await created.json()
    const row = keyboardPage.locator('[data-reservation-id="' + booking.id + '"]')
    await row.locator('[data-status="Pendiente"]').waitFor({ timeout: 10000 })
    fallback.push(Date.now() - await changedAt(booking.id))
    await mutation('/api/reservations/' + booking.id + '/decision', { method: 'PATCH', body: { decision: 'rechazar' } })
    await row.locator('[data-status="Rechazada"]').waitFor({ timeout: 10000 })
    fallback.push(Date.now() - await changedAt(booking.id))
  }
  await report('rnf002-fallback', { criterion: 'RNF-002', transport: 'consulta de respaldo cada 3 s con SSE interrumpido', samples: fallback.length, milliseconds: fallback })
  const browserVersion = keyboardBrowser.version()
  assert.equal(await keyboardPage.locator('link[rel="manifest"]').count(), 0)
  await report('rnf018-desktop', { criterion: 'RNF-018', browser: 'Chromium', version: browserVersion, desktop: true, physicalMobileVerified: false, note: 'Verificar también en un navegador móvil físico.' })
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
