import { requirePassenger } from './roles.js'
import { cotizar, horaBogota, horaLocal } from './itinerarios.js'
import { paradas } from '../shared/paradas.js'
import { localPoint } from '../shared/route-points.js'
import { distanceMeters } from '../shared/proximidad.js'
import { requireRule } from './rules.js'
import { journeyIdentity } from './presentacion-viaje.js'

const normalized = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim()
function textMatch(value, query) {
  const name=normalized(value), words=normalized(query).split(' ').filter(w=>w && !['de','del','el','la','los','las','en'].includes(w))
  return words.every(word=>name.includes(word))
}
function queryText(value, label, max=120) {
  requireRule(typeof value==='string' && value.length<=max && !/[<>\x00-\x1f]/.test(value), 'Revisa '+label+'.')
  return value.trim()
}
function queryPoint(query, prefix) {
  const lat=query[prefix+'Lat'],lng=query[prefix+'Lng']
  if (lat===undefined && lng===undefined) return null
  const p={latitude:Number(lat),longitude:Number(lng)}
  requireRule(typeof lat==='string' && lat.trim()!=='' && typeof lng==='string' && lng.trim()!=='' && localPoint(p),'Marca '+prefix+' dentro del área de Cali.')
  return p
}
function pointOf(stop) { return Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude) ? stop : paradas.find(p=>p.id===stop.stopId) }
function stopMatch(stop, id, text, location, radius) {
  if (id) return stop.stopId===id ? 0 : null
  if (location) { const p=pointOf(stop); if (!p) return null; const d=distanceMeters(location,p); return d<=radius ? d : null }
  return !text || textMatch(stop.name || paradas.find(p=>p.id===stop.stopId)?.nombre || '',text) ? 0 : null
}
export function bestJourneyMatch(trip, bookings, search) {
  let best=null
  const { origin,destination,originText,destinationText,originPoint,destinationPoint,radius,date,target }=search
  const hasOrigin=origin || originText || originPoint, hasDestination=destination || destinationText || destinationPoint
  for(let i=0;i<trip.itinerary.length-1;i++) {
    if (!hasOrigin && i!==0) continue
    const from=stopMatch(trip.itinerary[i],origin,originText,originPoint,radius)
    if (from===null) continue
    for(let j=i+1;j<trip.itinerary.length;j++) {
      if(!hasDestination && j!==trip.itinerary.length-1) continue
      const to=stopMatch(trip.itinerary[j],destination,destinationText,destinationPoint,radius)
      if(to===null) continue
      const quote=cotizar(trip,bookings,trip.route[i],trip.route[j])
      if(!quote.availableSeats || horaLocal(quote.boardAt).slice(0,10)!==date) continue
      const timeDifference=target===null ? 0 : Math.abs(Date.parse(quote.boardAt)-target)
      if(target!==null && timeDifference>60*60000) continue
      const score=from+to
      if(!best || score<best.score || (score===best.score && timeDifference<best.timeDifference)) best={...quote,origin:trip.route[i],destination:trip.route[j],pickupWalkMeters:Math.round(from),dropoffWalkMeters:Math.round(to),score,timeDifference,matchType:originPoint || destinationPoint ? 'nearby' : hasOrigin || hasDestination ? 'exact' : 'all'}
    }
  }
  return best
}
export function mountJourneyBoard(app, db, approvedSession) {
  app.get('/api/journeys/stops',async(req,res)=>{
    requirePassenger(await approvedSession(req))
    const date=req.query.date
    if(date!==undefined){queryText(date,'la fecha',10);horaBogota(date+'T00:00')}
    const {rows}=await db.query(`SELECT t.id,t.itinerary FROM trips t WHERE t.status IN ('Programado','Lleno') AND t.depart_at>clock_timestamp()
      AND ($1::text IS NULL OR EXISTS(SELECT 1 FROM jsonb_array_elements(t.itinerary) p WHERE ((p->>'estimatedAt')::timestamptz AT TIME ZONE 'America/Bogota')::date=$1::date))
      ORDER BY t.depart_at LIMIT 2000`,[date??null])
    const points=new Map()
    for(const trip of rows) for(const stop of trip.itinerary){const p=pointOf(stop);if(!p)continue;const key=stop.stopId;const current=points.get(key);if(current)current.offerCount++;else points.set(key,{id:key,nombre:stop.name || p.nombre,latitude:p.latitude,longitude:p.longitude,offerCount:1})}
    res.json([...points.values()].sort((a,b)=>a.nombre.localeCompare(b.nombre,'es')))
  })
  app.get('/api/journeys/available',async(req,res)=>{
    const user=await approvedSession(req),q=req.query
    requirePassenger(user)
    const date=queryText(q.date??'','la fecha',10);requireRule(/^\d{4}-\d{2}-\d{2}$/.test(date),'Selecciona una fecha válida.');horaBogota(date+'T00:00')
    const origin=queryText(q.origin??'','la parada de subida',100),destination=queryText(q.destination??'','la parada de bajada',100)
    const originText=queryText(q.originText??'','el lugar de salida'),destinationText=queryText(q.destinationText??'','el destino')
    for(const id of [origin,destination])requireRule(!id || paradas.some(p=>p.id===id) || /^point-[a-z0-9-]{1,60}$/.test(id),'Selecciona una parada del recorrido.')
    requireRule(!origin || !destination || origin!==destination,'La subida y la bajada deben ser distintas.')
    const originPoint=queryPoint(q,'origin'),destinationPoint=queryPoint(q,'destination')
    const radius=Number(q.radiusM??1500);requireRule(Number.isSafeInteger(radius)&&radius>=100&&radius<=5000,'El radio debe estar entre 100 y 5000 metros.')
    const time=queryText(q.time??'','la hora',5);requireRule(!time||/^\d{2}:\d{2}$/.test(time),'Selecciona una hora válida.')
    const target=time?Date.parse(horaBogota(date+'T'+time)):null
    const sort=q.sort??'departure';requireRule(['recommended','departure','price','seats'].includes(sort),'El orden solicitado no es válido.')
    const page=Number(q.page??1),pageSize=Number(q.pageSize??24);requireRule(Number.isSafeInteger(page)&&page>=1&&page<=1000000&&Number.isSafeInteger(pageSize)&&pageSize>=1&&pageSize<=100,'La página solicitada no es válida.')
    const result=await db.transaction(async tx=>{
      const {rows:trips}=await tx.query(`SELECT t.id,t.depart_at AS "departAt",t.capacity,t.route,t.status,t.itinerary,t.pricing,
        v.id AS "vehicleId",v.brand,v.model,v.color,v.plate,v.photo_data IS NOT NULL AS "hasPhoto",v.photo_reference AS "photoReference",u.alias AS "driverName"
        FROM trips t JOIN users u ON u.id=t.driver_id JOIN vehicles v ON v.id=t.vehicle_id
        WHERE t.status IN ('Programado','Lleno') AND t.depart_at>clock_timestamp() AND t.driver_id<>$1
        AND EXISTS(SELECT 1 FROM jsonb_array_elements(t.itinerary) p WHERE ((p->>'estimatedAt')::timestamptz AT TIME ZONE 'America/Bogota')::date=$2::date)
        ORDER BY t.depart_at,t.id LIMIT 2000`,[user.id,date])
      const {rows:bookings}=await tx.query(`SELECT trip_id,board_index,alight_index,status FROM reservations WHERE status='Confirmada'
        AND trip_id IN (SELECT jsonb_array_elements_text($1::jsonb))`,[JSON.stringify(trips.map(t=>t.id))])
      const grouped=new Map();for(const b of bookings){if(!grouped.has(b.trip_id))grouped.set(b.trip_id,[]);grouped.get(b.trip_id).push(b)}
      const search={origin,destination,originText,destinationText,originPoint,destinationPoint,radius,date,target},items=[]
      for(const trip of trips){if(trip.itinerary.length<2)continue;const match=bestJourneyMatch(trip,grouped.get(trip.id)??[],search);if(!match)continue
        items.push({id:trip.id,route:trip.route,itinerary:trip.itinerary,status:trip.status,departAt:trip.departAt,...match,...journeyIdentity(trip),mapReady:Boolean(trip.pricing?.roadMap?.geometry)})}
      items.sort((a,b)=>(sort==='price'?a.estimatedCop-b.estimatedCop:sort==='seats'?b.availableSeats-a.availableSeats:sort==='recommended'?a.score-b.score:0)||a.timeDifference-b.timeDifference||Date.parse(a.boardAt)-Date.parse(b.boardAt)||a.id.localeCompare(b.id))
      return {total:items.length,page,pageSize,searchRadiusMeters:radius,items:items.slice((page-1)*pageSize,page*pageSize).map(({score,timeDifference,...item})=>item)}
    })
    res.json(result)
  })
}
