import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { openDatabase } from '../server/db.js'
import { createApp } from '../server/app.js'
import { seedDemo } from '../server/demo.js'
import { horaLocal, horaBogota, crearItinerario, fijarCostos, cotizar } from '../server/itinerarios.js'
import { selectedPoints, routeCatalog } from '../server/puntos-recorrido.js'
import { createJourneyPlans } from '../server/planes-recorrido.js'
import { calcularLiquidacion, verificarLiquidacion } from '../server/liquidacion.js'
import { defaultFare, maximumFareCop, validFare } from '../shared/fare-policy.js'
import { demoCorridors } from '../shared/demo-corridors.js'
import { bestJourneyMatch } from '../server/cartelera.js'

function fixture() {
  const points=demoCorridors[0].stops, route=points.map(p=>p.id), times=route.map((_,i)=>'2035-01-10T08:'+String(i*5).padStart(2,'0'))
  const catalog=routeCatalog(points).map(s=>({...s,distanceKm:1.5}))
  return {route,capacity:2,...fijarCostos(crearItinerario(route,times,horaBogota(times[0]),catalog,points),30,16339,defaultFare,'distance-v2')}
}

test('diez paradas, mínimo único por reserva y liquidación exacta por distancia',()=>{
  const trip=fixture()
  assert.equal(trip.itinerary.length,10)
  const quote=cotizar(trip,[],trip.route[0],trip.route[9])
  assert.equal(quote.distanceKm,13.5);assert.equal(quote.maximumCop,16500)
  const direct={route:[trip.route[0],trip.route[9]],capacity:2,...fijarCostos([{...trip.itinerary[0],distanceToNextKm:13.5},trip.itinerary[9]],30,16339,defaultFare,'distance-v2')}
  assert.equal(cotizar(direct,[],direct.route[0],direct.route[1]).maximumCop,quote.maximumCop)
  assert.equal(cotizar(trip,[],trip.route[3],trip.route[4]).maximumCop,11000)
  assert.equal(cotizar(trip,[],trip.route[3],trip.route[7]).maximumCop,11000)
  const reservations=[{id:'a',board_index:0,alight_index:9,maximum_cop:16500,attendance:'Abordo'},{id:'b',board_index:3,alight_index:7,maximum_cop:11000,attendance:'Abordo'},{id:'c',board_index:2,alight_index:8,maximum_cop:21000,attendance:'Ausente'}]
  const actual=calcularLiquidacion(trip,reservations)
  assert.deepEqual(actual.aportes,{a:16500,b:11000,c:0});assert.equal(actual.totalCop,27500)
  assert.equal(actual.tramos.reduce((a,s)=>a+s.recaudoCop,0),27500)
  for(const r of reservations)assert.equal(actual.tramos.reduce((a,s)=>a+(s.aportes[r.id]??0),0),actual.aportes[r.id])
  verificarLiquidacion(actual,trip,reservations)
  const forged=structuredClone(actual);forged.tramos[2].recaudoCop++
  assert.throws(()=>verificarLiquidacion(forged,trip,reservations),/no coincide/)
  assert.throws(()=>calcularLiquidacion(trip,[{...reservations[0],maximum_cop:16499}]),/máximo/)
})


test('tope por persona: tarifas altas, tramos parciales y varios pasajeros conservan el máximo',()=>{
  assert.equal(validFare({minimumCop:25000,perKmCop:2300}),true)
  assert.equal(validFare({minimumCop:25001,perKmCop:2300}),false)
  const trip=fixture()
  const priced=fijarCostos(trip.itinerary,30,16339,{minimumCop:25000,perKmCop:100000},'distance-v2')
  const expensive={...trip,...priced}
  for(let start=0;start<9;start++)for(let end=start+1;end<10;end++){
    const quote=cotizar(expensive,[],trip.route[start],trip.route[end])
    assert.equal(quote.estimatedCop,25000);assert.equal(quote.maximumCop,25000)
  }
  const reservations=['a','b'].map(id=>({id,board_index:0,alight_index:9,maximum_cop:25000,attendance:'Abordo'}))
  const settlement=calcularLiquidacion(expensive,reservations)
  assert.deepEqual(settlement.aportes,{a:25000,b:25000})
  assert.equal(settlement.totalCop,50000)
  verificarLiquidacion(settlement,expensive,reservations)
})

test('búsqueda por texto y cercanía exige orden, cupo en todo el tramo y fecha de recogida',()=>{
  const trip=fixture(), point=trip.itinerary[3], destination=trip.itinerary[7]
  const search={origin:'',destination:'',originText:'',destinationText:'',originPoint:point,destinationPoint:destination,radius:500,date:'2035-01-10',target:null}
  const exact=bestJourneyMatch(trip,[],search)
  assert.equal(exact.origin,point.stopId);assert.equal(exact.destination,destination.stopId);assert.equal(exact.pickupWalkMeters,0)
  assert.equal(bestJourneyMatch(trip,[],{...search,originPoint:destination,destinationPoint:point,radius:100}),null)
  assert.equal(bestJourneyMatch(trip,[{status:'Confirmada',board_index:0,alight_index:9},{status:'Confirmada',board_index:0,alight_index:9}],search),null)
  assert.equal(bestJourneyMatch(trip,[],{...search,date:'2035-01-11'}),null)
  const byText=bestJourneyMatch(trip,[],{...search,originPoint:null,destinationPoint:null,originText:'ciudad jardin',destinationText:'lourdes'})
  assert.ok(byText);assert.equal(byText.origin,point.stopId)
  assert.equal(bestJourneyMatch(trip,[],{...search,originPoint:{latitude:3.51,longitude:-76.44},radius:100}),null)
})

test('planes ligados al conductor, al recorrido y a su vencimiento; sin proveedor se identifica la estimación',async()=>{
  let time=1000
  const plans=createJourneyPlans(async()=>{throw Error('No disponible')},{now:()=>time})
  const points=demoCorridors[0].stops,route=points.map(p=>p.id)
  const plan=await plans.create('driver',route,points)
  assert.equal(plan.source,'estimated');assert.equal(plan.roadMap,null)
  assert.equal(plans.resolve(plan.id,'driver',points).signature,JSON.stringify(points.map(p=>[p.id,p.nombre,p.latitude,p.longitude])))
  assert.throws(()=>plans.resolve(plan.id,'other',points),/venció/)
  assert.throws(()=>plans.resolve(plan.id,'driver',points.slice().reverse()),/venció/)
  time+=16*60000
  assert.throws(()=>plans.resolve(plan.id,'driver',points),/venció/)
  assert.throws(()=>selectedPoints([...route,'point-extra'],points),/diez/)
})

test('128 ofertas futuras de diez paradas; búsqueda libre, planes y reserva con rutas viales guardadas',async t=>{
  const db=await openDatabase()
  t.after(()=>db.close())
  const tomorrow=await seedDemo(db),cookies={}
  for(const id of ['demo-driver','demo-passenger','demo-ezequiel','demo-mobility']){
    const token=createHash('sha256').update('rutas/'+id).digest('hex');cookies[id]='jalon_session='+token
    await db.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,NOW()+interval '1 day')",[createHash('sha256').update(token).digest('hex'),id])
  }
  const maps=JSON.parse(await readFile(new URL('../server/fixtures/demo-road-maps.json',import.meta.url)))
  const fetcher=async url=>{
    const coords=url.pathname.split('/').at(-1).split(';').map(p=>p.split(',').map(Number))
    return {ok:true,json:async()=>({code:'Ok',routes:[{distance:(coords.length-1)*1500,duration:(coords.length-1)*300,geometry:{type:'LineString',coordinates:coords},legs:coords.slice(1).map(()=>({distance:1500,duration:300}))}]})}
  }
  const server=createApp(db,undefined,null,{routing:{fetcher}}).listen(0,'127.0.0.1');await once(server,'listening')
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r))})
  const base='http://127.0.0.1:'+server.address().port
  async function request(path,user='demo-passenger',method='GET',body){
    const response=await fetch(base+path,{method,headers:{...(user&&{Cookie:cookies[user]}),...(body&&{'Content-Type':'application/json'})},...(body&&{body:JSON.stringify(body)})})
    return {status:response.status,data:await response.json()}
  }
  for(const [offset,prefix] of [[1,'demo-tomorrow-'],[2,'demo-day-after-']]){
    const date=horaLocal(new Date(Date.now()+offset*86400000)).slice(0,10)
    const response=await request('/api/journeys/available?'+new URLSearchParams({date,pageSize:'100'}))
    assert.equal(response.status,200)
    const offers=response.data.items.filter(p=>p.id.startsWith(prefix))
    assert.equal(offers.length,64)
    assert.equal(new Set(offers.map(p=>p.driver.name)).size,64)
    assert.equal(new Set(offers.map(p=>p.vehicle.plate)).size,64)
    assert.ok(offers.every(p=>p.itinerary.length===10 && p.mapReady && p.maximumCop>=11000 && p.maximumCop<=maximumFareCop))
    assert.ok(new Set(offers.map(p=>p.maximumCop)).size>5)
    for(const offer of offers)assert.equal(offer.maximumCop,Math.min(maximumFareCop,Math.max(11000,Math.ceil(offer.distanceKm*defaultFare.perKmCop/500)*500)))
  }
  assert.equal(Object.keys(maps).length,16);assert.ok(Object.values(maps).every(map=>map.legs.length===9&&map.geometry.coordinates.length>10))
  const route=demoCorridors[0],origin=route.stops[2],destination=route.stops[7]
  const match=(await request('/api/journeys/available?'+new URLSearchParams({date:tomorrow,originText:'Unicentro',pageSize:'100'}))).data
  assert.ok(match.total>0);assert.ok(match.items.every(p=>p.itinerary.find(s=>s.stopId===p.origin).name.includes('Unicentro')))
  const nearby=(await request('/api/journeys/available?'+new URLSearchParams({date:tomorrow,originLat:String(origin.latitude+.0003),originLng:String(origin.longitude),destinationLat:String(destination.latitude),destinationLng:String(destination.longitude),radiusM:'500',pageSize:'100'}))).data
  assert.ok(nearby.items.some(p=>p.pickupWalkMeters>0&&p.pickupWalkMeters<100))
  assert.equal((await request('/api/journeys/available?date='+tomorrow+'&originLat=100&originLng=1')).status,400)
  assert.equal((await request('/api/journeys/available?date='+tomorrow+'&originText='+encodeURIComponent('<script>'))).status,400)
  const points=demoCorridors[1].stops,ids=points.map(p=>p.id)
  const body={route:ids,routePoints:points}
  assert.equal((await request('/api/journeys/plan','demo-passenger','POST',body)).status,403)
  const plan=await request('/api/journeys/plan','demo-driver','POST',body)
  assert.equal(plan.status,200);assert.equal(plan.data.source,'road')
  const times=ids.map((_,i)=>tomorrow+'T'+String(9+Math.floor(i*5/60)).padStart(2,'0')+':'+String(i*5%60).padStart(2,'0'))
  const draft={...body,planId:plan.data.id,vehicleId:'demo-car',capacity:2,departAt:times[0],stopTimes:times,fuelPriceCopPerGallon:16339}
  const forged=await request('/api/trips','demo-driver','POST',{...draft,routePoints:points.map((p,i)=>i? p:{...p,latitude:p.latitude+.001})})
  assert.equal(forged.status,409)
  assert.equal((await request('/api/trips','demo-ezequiel','POST',{...draft,vehicleId:'demo-renault'})).status,409)
  const created=await request('/api/trips','demo-driver','POST',draft)
  assert.equal(created.status,201,JSON.stringify(created.data));assert.equal(created.data.itinerary.length,10)
  assert.equal(created.data.pricing.fareModel,'distance-v2')
  assert.equal(created.data.pricing.roadMap.distanceMeters,13500)
  const detail=await request('/api/trips/'+created.data.id+'?'+new URLSearchParams({origin:ids[2],destination:ids[7]}))
  assert.equal(detail.data.maximumCop,11000);assert.ok(detail.data.roadMap.geometry)
  const reservation=await request('/api/trips/'+created.data.id+'/reservations','demo-passenger','POST',{origin:ids[2],destination:ids[7]})
  assert.equal(reservation.status,201);assert.equal(reservation.data.maximumCop,11000)
  assert.equal((await request('/api/reservations/'+reservation.data.id+'/decision','demo-driver','PATCH',{decision:'confirmar'})).status,200)
  const incident=await request('/api/incidents','demo-passenger','POST',{tripId:created.data.id,category:'otro',description:'Consulta sobre el punto de encuentro publicado.'})
  assert.equal(incident.status,201)
  const incidentTrip=(await request('/api/incidents/trips')).data.find(trip=>trip.id===created.data.id)
  assert.equal(incidentTrip.itinerary[0].name,points[0].nombre)
  const report=(await request('/api/incidents')).data.find(item=>item.id===incident.data.id)
  assert.equal(report.itinerary.at(-1).name,points.at(-1).nombre)
  assert.deepEqual((await request('/api/trips/'+created.data.id+'?'+new URLSearchParams({origin:ids[2],destination:ids[7]}))).data.route,ids)

  const suggestions=(await request('/api/journeys/stops?date='+tomorrow)).data
  assert.ok(suggestions.some(p=>p.id===ids[2]&&p.offerCount>0))
  assert.equal((await request('/api/journeys/available?date=2035-02-30')).status,400)
})
