import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import express from 'express'
import { openDatabase } from '../server/db.js'
import { createApp } from '../server/app.js'
import { seedDemo } from '../server/demo.js'
import { horaLocal } from '../server/itinerarios.js'
import { selectedPoints } from '../server/puntos-recorrido.js'
import { createRoadService, mountRoadMap } from '../server/mapa-vial.js'

const custom = { id: 'point-biblioteca', nombre: 'Encuentro junto a la biblioteca', latitude: 3.4141, longitude: -76.5451 }

test('solo acepta puntos de Cali, sin suplantar el catálogo ni insertar contenido activo', () => {
  assert.equal(selectedPoints([custom.id,'usc'], [custom])[0].nombre, custom.nombre)
  assert.equal(selectedPoints([custom.id,'usc'], [{...custom,nombre:'Café cerca de Éxito'}])[0].nombre, 'Café cerca de Éxito')
  assert.throws(() => selectedPoints([custom.id,'usc'], [{...custom,nombre:'Parque\ncon salto'}]))
  for (const changes of [{ latitude: 10 }, { longitude: 0 }, { latitude: '3.41' }, { nombre: '<img onerror=alert(1)>' }, { nombre: 'a' }, { id: 'usc' }]) {
    assert.throws(() => selectedPoints([custom.id,'usc'], [{ ...custom, ...changes }]))
  }
  assert.throws(() => selectedPoints([custom.id,'usc'], [custom,custom]))
  assert.throws(() => selectedPoints(['desconocido','usc'], []))
})

test('sesenta y cuatro ofertas futuras con fotos distintas y publicación del recorrido por el propio conductor', async t => {
  const db = await openDatabase(), tomorrow = await seedDemo(db), cookies = {}
  for (const id of ['demo-driver','demo-passenger','demo-mobility']) {
    const token = createHash('sha256').update('offers/' + id).digest('hex'); cookies[id] = 'jalon_session=' + token
    await db.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,NOW()+interval '1 day')", [createHash('sha256').update(token).digest('hex'),id])
  }
  const server = createApp(db, undefined, null).listen(0,'127.0.0.1'); await once(server,'listening')
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await db.close() })
  const base = 'http://127.0.0.1:' + server.address().port
  async function request(path, user = 'demo-passenger', method = 'GET', body) {
    const r = await fetch(base+path, { method, headers: { ...(user && { Cookie: cookies[user] }), ...(body && { 'Content-Type':'application/json' }) }, ...(body && { body:JSON.stringify(body) }) })
    return { status:r.status, data:await r.json() }
  }
  await t.test('la cartelera muestra veinte ofertas del día, con paradas y veinte identidades', async () => {
    const date = tomorrow
    const board = await request('/api/journeys/available?' + new URLSearchParams({ date, pageSize:100 }))
    assert.equal(board.status,200); assert.ok(board.data.total>=64); assert.ok(board.data.items.length>=64)
    for (const values of [board.data.items.map(o=>o.driver.name),board.data.items.map(o=>o.vehicle.plate),board.data.items.map(o=>o.vehicle.photoUrl)]) assert.equal(new Set(values).size,64)
    assert.ok(board.data.items.every(o=>o.maximumCop>=11000 && !o.driver.name.includes('Demo')))
    assert.ok(board.data.items.filter(o=>o.itinerary.length>2).length>=4)
    assert.ok(board.data.items.every(o=>o.itinerary.every(p=>p.name && Number.isFinite(p.latitude) && Number.isFinite(p.longitude))))
    const sorted = await request('/api/journeys/available?' + new URLSearchParams({ date, pageSize:100, sort:'price' }))
    assert.deepEqual(sorted.data.items.map(o=>o.estimatedCop), [...sorted.data.items.map(o=>o.estimatedCop)].sort((a,b)=>a-b))
    assert.equal((await request('/api/journeys/available?date='+date+'&sort=bad')).status,400)
    assert.equal((await request('/api/map/route',null,'POST',{stops:[custom.id,'usc'],points:[custom]})).status,401)
  })
  let trip, booking
  const body = { vehicleId:'demo-car', capacity:2, departAt:tomorrow+'T18:30', route:[custom.id,'usc'], routePoints:[custom], stopTimes:[tomorrow+'T18:30',tomorrow+'T18:50'], fuelPriceCopPerGallon:16339 }
  await t.test('el conductor guarda nombre, punto y horario; el pasajero puede reservar su parada', async () => {
    assert.equal((await request('/api/trips','demo-passenger','POST',body)).status,403)
    assert.equal((await request('/api/trips','demo-mobility','POST',body)).status,403)
    assert.equal((await request('/api/trips','demo-driver','POST',{...body,routePoints:[{...custom,latitude:0}]})).status,400)
    const created = await request('/api/trips','demo-driver','POST',body)
    assert.equal(created.status,201,JSON.stringify(created.data)); trip=created.data
    assert.equal(trip.itinerary[0].name,custom.nombre); assert.equal(trip.itinerary[0].latitude,custom.latitude)
    assert.ok(trip.itinerary[0].distanceToNextKm>0)
    const detail = await request('/api/trips/'+trip.id+'?'+new URLSearchParams({origin:custom.id,destination:'usc'}))
    assert.equal(detail.status,200); assert.equal(detail.data.driver.name,'Carlos Rivas')
    assert.equal(detail.data.itinerary[0].longitude,custom.longitude)
    const catalog = await request('/api/journeys/stops')
    assert.ok(catalog.data.some(point => point.id === custom.id && point.nombre === custom.nombre))
    const filtered = await request('/api/journeys/available?' + new URLSearchParams({date:tomorrow,origin:custom.id,destination:'usc'}))
    assert.ok(filtered.data.items.some(o=>o.id===trip.id))
    const board = await request('/api/journeys/available?date='+tomorrow+'&pageSize=100')
    assert.ok(board.data.items.some(o=>o.id===trip.id && o.origin===custom.id))
    const reserved = await request('/api/trips/'+trip.id+'/reservations','demo-passenger','POST',{origin:custom.id,destination:'usc'})
    assert.equal(reserved.status,201,JSON.stringify(reserved.data)); booking=reserved.data
    assert.equal(booking.originName,custom.nombre); assert.equal(booking.maximumCop,detail.data.maximumCop)
  })
  await t.test('confirmar y finalizar conserva el importe y el nombre de la parada en historial', async () => {
    assert.equal((await request('/api/reservations/'+booking.id+'/decision','demo-driver','PATCH',{decision:'confirmar'})).status,200)
    await db.query("UPDATE trips SET depart_at=NOW()-interval '1 minute' WHERE id=$1",[trip.id])
    assert.equal((await request('/api/trips/'+trip.id+'/start','demo-driver','POST')).status,200)
    const finished=await request('/api/trips/'+trip.id+'/finish','demo-driver','POST',{asistencia:[{id:booking.id,attendance:'Abordo'}]})
    assert.equal(finished.status,200); assert.equal(finished.data.liquidation.aportes[booking.id],booking.maximumCop)
    const history=(await request('/api/journeys/history')).data.items.find(o=>o.id===trip.id)
    assert.equal(history.origin,custom.id); assert.equal(history.itinerary[0].name,custom.nombre)
    assert.equal(history.settledCop,booking.maximumCop)
  })
})

test('el mapa valida sesión y coordenadas; la caché distingue dos ubicaciones con el mismo identificador', async t => {
  let calls=0
  const fetcher=async url=>{
    calls++; const coords=url.pathname.split('/').at(-1).split(';').map(p=>p.split(',').map(Number))
    return {ok:true,json:async()=>({code:'Ok',routes:[{distance:1900,duration:300,geometry:{type:'LineString',coordinates:coords},legs:coords.slice(1).map(()=>({distance:1900,duration:300}))}]})}
  }
  const first=selectedPoints([custom.id,'usc'],[custom]), changed=selectedPoints([custom.id,'usc'],[{...custom,latitude:3.42}])
  const service=createRoadService({fetcher}); assert.equal((await service(first)).stops[0].latitude,custom.latitude)
  assert.equal((await service(changed)).stops[0].latitude,3.42); assert.equal(calls,2)
  const app=express(); app.use(express.json())
  mountRoadMap(app,async req=>{if(req.headers['x-test']!=='yes')throw Object.assign(new Error('Sin sesión'),{status:401})},{fetcher})
  app.use((error,req,res,next)=>res.status(error.status||500).json({message:error.message}))
  const server=app.listen(0,'127.0.0.1');await once(server,'listening')
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))})
  const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/map/route',{method:'POST',headers:{'Content-Type':'application/json','x-test':'yes'},body:JSON.stringify({stops:[custom.id,'usc'],points:[custom]})})
  assert.equal(response.status,200);assert.equal((await response.json()).stops[0].nombre,custom.nombre)
})
