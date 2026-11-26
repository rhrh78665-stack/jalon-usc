import test from 'node:test'
import assert from 'node:assert/strict'
import { groupPublishedRoutes, publishedStopList } from '../shared/catalogo.js'

test('el catálogo representa recorridos publicados completos, sin inventar destinos ni reordenar las paradas',()=>{
  const first={id:'a',route:['norte','centro','campus'],itinerary:[{stopId:'norte',name:'Norte'},{stopId:'centro',name:'Centro'},{stopId:'campus',name:'Campus'}],availableSeats:2,maximumCop:16000}
  const second={...first,id:'b',availableSeats:1,maximumCop:14500}
  const reverse={...first,id:'c',route:[...first.route].reverse(),itinerary:[...first.itinerary].reverse(),availableSeats:3}
  const original=structuredClone([first,second,reverse])
  const groups=groupPublishedRoutes([first,second,reverse])
  assert.equal(groups.length,2)
  assert.deepEqual(groups[0].route,['norte','centro','campus'])
  assert.deepEqual(groups[1].route,['campus','centro','norte'])
  assert.deepEqual(groups[0].offers.map(o=>o.id),['a','b'])
  assert.equal(groups[0].availableSeats,3)
  assert.equal(groups[0].minimumCop,14500)
  assert.deepEqual([first,second,reverse],original)
  assert.deepEqual(groupPublishedRoutes([]),[])
})

test('las paradas disponibles se deducen únicamente de las ofertas y cuentan cada oferta una vez',()=>{
  const offers=[{id:'a',itinerary:[{stopId:'p1',name:'Campus'},{stopId:'p2',name:'Centro'}]},{id:'b',itinerary:[{stopId:'p2',name:'Centro'},{stopId:'p3',name:'Meléndez'}]}]
  const stops=publishedStopList(offers)
  assert.equal(stops.length,3)
  assert.equal(stops.find(p=>p.stopId==='p2').offers.size,2)
  assert.deepEqual([...new Set(stops.flatMap(p=>[...p.offers]))].sort(),['a','b'])
  assert.deepEqual(publishedStopList([]),[])
})
