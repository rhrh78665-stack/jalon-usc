import { randomBytes } from 'node:crypto'
import { selectedPoints, routeCatalog } from './puntos-recorrido.js'
import { requireDriver } from './vehiculos.js'
import { requireRule } from './rules.js'

export function createJourneyPlans(roadService, { now = Date.now } = {}) {
  const cache=new Map()
  const signature=points=>JSON.stringify(points.map(p=>[p.id,p.nombre,p.latitude,p.longitude]))
  return {
    async create(user,route,custom) {
      const points=selectedPoints(route,custom)
      let roadMap=null
      try { roadMap=await roadService(points) } catch { /* The saved point-to-point estimate remains usable without a routing provider. */ }
      const estimate=routeCatalog(points)
      const catalog=roadMap ? estimate.map((s,i)=>({...s,distanceKm:Math.max(.01,roadMap.legs[i].distanceMeters/1000)})) : estimate
      const plan={id:randomBytes(24).toString('hex'),user,signature:signature(points),expiresAt:now()+15*60000,catalog,roadMap,source:roadMap?'road':'estimated'}
      for(const [id,value] of cache)if(value.expiresAt<=now())cache.delete(id)
      if(cache.size>=128)cache.delete(cache.keys().next().value)
      cache.set(plan.id,plan)
      return {id:plan.id,source:plan.source,roadMap,distanceKm:catalog.reduce((a,s)=>a+s.distanceKm,0),stops:points,expiresAt:new Date(plan.expiresAt).toISOString()}
    },
    resolve(id,user,points) {
      const plan=cache.get(id)
      requireRule(plan && plan.user===user && plan.expiresAt>now() && plan.signature===signature(points),'La vista previa venció o cambió el recorrido. Actualiza la ruta antes de publicar.',409)
      return plan
    },
  }
}
export function mountJourneyPlans(app,db,approvedSession,plans) {
  app.post('/api/journeys/plan',async(req,res)=>{
    const user=await approvedSession(req)
    requireRule(req.is('application/json'),'Envía el recorrido como JSON.',415)
    await requireDriver(db,user.id)
    res.json(await plans.create(user.id,req.body?.route,req.body?.routePoints??[]))
  })
}
