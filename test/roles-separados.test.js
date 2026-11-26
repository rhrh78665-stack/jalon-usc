import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { openDatabase } from '../server/db.js'
import { seedDemo } from '../server/demo.js'
import { createApp } from '../server/app.js'
import { accountRole, requirePassenger, requireConductor } from '../server/roles.js'
import { roleView } from '../shared/roles.js'

test('los roles tienen funciones exclusivas y un conductor con licencia vencida conserva su rol',()=>{
  const passenger={mobility:false,driver:false,driverAssigned:false}
  const driver={mobility:false,driver:true,driverAssigned:true}
  const expired={...driver,driver:false}
  assert.equal(accountRole(passenger),'pasajero')
  assert.equal(accountRole(driver),'conductor')
  assert.equal(accountRole(expired),'conductor')
  assert.equal(accountRole({...driver,mobility:true}),'movilidad')
  assert.throws(()=>requirePassenger(driver),/Pasajero/)
  assert.throws(()=>requireConductor(passenger),/Conductor/)
  assert.equal(roleView({driver:true},'rutas'),'inicio')
  assert.equal(roleView({driver:true},'reservas'),'inicio')
  assert.equal(roleView({driver:true},'solicitudes'),'solicitudes')
  assert.equal(roleView({driver:true},'historial'),'historial')
  assert.equal(roleView({},'publicados'),'inicio')
  assert.equal(roleView({},'solicitudes'),'inicio')
  assert.equal(roleView({},'rutas'),'rutas')
  assert.equal(roleView({mobility:true},'rutas'),'inicio')
})

test('separación de conductor, pasajero y Movilidad aplicada en el servidor',async t=>{
  const db=await openDatabase()
  const date=await seedDemo(db),cookies={}
  for(const id of ['demo-driver','demo-passenger','demo-mobility']){
    const token=createHash('sha256').update('separacion/'+id).digest('hex')
    cookies[id]='jalon_session='+token
    await db.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,NOW()+interval '1 day')",[createHash('sha256').update(token).digest('hex'),id])
  }
  const server=createApp(db,undefined,null).listen(0,'127.0.0.1');await once(server,'listening')
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await db.close()})
  const base='http://127.0.0.1:'+server.address().port
  async function request(path,user='demo-passenger',method='GET',body){
    const response=await fetch(base+path,{method,headers:{...(user&&{Cookie:cookies[user]}),...(body&&{'Content-Type':'application/json'})},...(body&&{body:JSON.stringify(body)})})
    return {status:response.status,data:await response.json()}
  }

  await t.test('solo el pasajero consulta las ofertas y solicita un asiento',async()=>{
    for(const path of ['/api/journeys/available?date='+date,'/api/journeys/stops?date='+date,'/api/trips/search?date='+date+'&origin=melendez&destination=usc']){
      assert.equal((await request(path,'demo-passenger')).status,200)
      assert.equal((await request(path,'demo-driver')).status,403)
      assert.equal((await request(path,'demo-mobility')).status,403)
    }
    for(const role of ['demo-driver','demo-mobility']){
      const blocked=await request('/api/trips/demo-return/reservations',role,'POST',{origin:'usc',destination:'lido',driver:false,mobility:false,role:'pasajero'})
      assert.equal(blocked.status,403)
    }
    const allowed=await request('/api/trips/demo-search/reservations','demo-passenger','POST',{origin:'melendez',destination:'usc'})
    assert.equal(allowed.status,201)
    assert.equal((await request('/api/trips/mine','demo-passenger')).status,403)
    assert.equal((await request('/api/vehicles','demo-passenger')).status,403)
    const own=(await request('/api/trips/mine','demo-driver')).data
    assert.ok(own.length>0);assert.ok(own.every(trip=>trip.driverId==='demo-driver'))
  })

  await t.test('el conductor solo recibe solicitudes de sus ofertas y puede decidirlas',async()=>{
    const driver=(await request('/api/reservations','demo-driver')).data
    assert.ok(driver.length>0);assert.ok(driver.every(booking=>booking.canDecide && !booking.canCancel))
    const passenger=(await request('/api/reservations','demo-passenger')).data
    assert.ok(passenger.every(booking=>!booking.canDecide))
    const pending=driver.find(booking=>booking.tripId==='demo-search' && booking.status==='Pendiente')
    assert.ok(pending);assert.equal(pending.contraparte,'Valentina Torres')
    assert.equal((await request('/api/reservations/'+pending.id+'/decision','demo-driver','PATCH',{decision:'confirmar'})).status,200)
    assert.equal((await request('/api/reservations/'+pending.id+'/decision','demo-passenger','PATCH',{decision:'rechazar'})).status,403)
  })

  await t.test('el historial del conductor excluye reservas antiguas como pasajero, sin borrar registros',async()=>{
    await db.exec("INSERT INTO reservations(id,trip_id,passenger_id,board_index,alight_index,status,maximum_cop,attendance) VALUES('legacy-conductor-pasajero','demo-history-1','demo-driver',0,1,'Confirmada',11000,'Abordo')")
    await db.exec("INSERT INTO trips(id,driver_id,vehicle_id,depart_at,capacity,route,status,itinerary,pricing) SELECT 'legacy-oferta-pasajero','demo-passenger',vehicle_id,depart_at,capacity,route,status,itinerary,pricing FROM trips WHERE id='demo-history-0'")
    const driver=(await request('/api/journeys/history?role=pasajero&user=demo-passenger','demo-driver')).data
    assert.ok(driver.items.length>0);assert.ok(driver.items.every(trip=>trip.asDriver))
    assert.ok(!driver.items.some(trip=>trip.id==='demo-history-1'))
    assert.equal(driver.total,new Set(driver.items.map(trip=>trip.id)).size)
    const passenger=(await request('/api/journeys/history?role=conductor&user=demo-driver')).data
    assert.ok(passenger.items.every(trip=>!trip.asDriver))
    assert.ok(!passenger.items.some(trip=>trip.id==='legacy-oferta-pasajero'))
    const inbox=(await request('/api/reservations','demo-driver')).data
    assert.ok(!inbox.some(booking=>booking.id==='legacy-conductor-pasajero'))
    assert.equal((await db.query("SELECT count(*)::int AS n FROM reservations WHERE id='legacy-conductor-pasajero'")).rows[0].n,1)
    assert.equal((await db.query("SELECT count(*)::int AS n FROM trips WHERE id='legacy-oferta-pasajero'")).rows[0].n,1)
  })

  await t.test('el conductor consulta el detalle y la foto de sus propios recorridos',async()=>{
    assert.equal((await request('/api/trips/demo-search?origin=melendez&destination=usc','demo-driver')).status,200)
    assert.equal((await request('/api/trips/demo-return?origin=usc&destination=lido','demo-driver')).status,403)
    const own=await fetch(base+'/api/vehicles/demo-car/photo',{headers:{Cookie:cookies['demo-driver']}})
    assert.equal(own.status,200);await own.arrayBuffer()
    const other=await fetch(base+'/api/vehicles/demo-renault/photo',{headers:{Cookie:cookies['demo-driver']}})
    assert.equal(other.status,403);await other.json()
    assert.equal((await request('/api/movilidad/conductores','demo-driver')).status,403)
    assert.equal((await request('/api/movilidad/conductores','demo-mobility')).status,200)
  })

  await t.test('vencer la licencia no convierte al conductor en pasajero ni habilita reservas',async()=>{
    await db.exec("UPDATE driver_permissions SET license_expires_on=CURRENT_DATE-1 WHERE user_id='demo-driver'")
    const session=await request('/api/session','demo-driver')
    assert.equal(session.data.driver,true);assert.equal(session.data.driverExpired,true)
    const login=await request('/api/login',null,'POST',{email:'conductor.demo@usc.edu.co',password:'JalonDemo-2026!'})
    assert.equal(login.status,200);assert.equal(login.data.driver,true);assert.equal(login.data.driverExpired,true)
    assert.equal((await request('/api/journeys/available?date='+date,'demo-driver')).status,403)
    assert.equal((await request('/api/trips/demo-return/reservations','demo-driver','POST',{origin:'usc',destination:'lido'})).status,403)
    assert.equal((await request('/api/trips/mine','demo-driver')).status,200)
    assert.ok((await request('/api/journeys/history','demo-driver')).data.items.every(trip=>trip.asDriver))
  })
})
