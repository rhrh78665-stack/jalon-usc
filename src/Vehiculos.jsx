import React, { useEffect, useState } from 'react'
import Viajes from './Viajes.jsx'
import { prepareVehiclePhoto } from './vehicle-photo.js'

export default function Vehiculos({ view, composeSignal, tripStatus, navigationId, composeRequested }) {
  const [vehicles, setVehicles] = useState(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState({ text: 'Cargando vehículos…' })
  const [editing, setEditing] = useState(null)
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/vehicles', { signal: controller.signal }).then(async response => {
      const result = await response.json()
      if (!response.ok) throw new Error(result.message)
      setVehicles(result); setMessage(null)
    }).catch(error => { if (!controller.signal.aborted) setMessage({ error: true, text: error.message || 'No se pudieron cargar los vehículos.' }) })
    return () => controller.abort()
  }, [])

  async function save(event) {
    event.preventDefault()
    const form = event.currentTarget, fields = new FormData(form)
    setSaving(true); setMessage(null)
    try {
      const photo = fields.get('photo')
      const photoData = photo?.size ? await prepareVehiclePhoto(photo) : undefined
      const body = { brand: fields.get('brand'), model: fields.get('model'), color: fields.get('color'),
        ...(photoData && { photoData }), ...(!editing && { plate: fields.get('plate'), seats: Number(fields.get('seats')), efficiency: Number(fields.get('efficiency')) }) }
      const response = await fetch(editing ? '/api/vehicles/' + encodeURIComponent(editing.id) + '/description' : '/api/vehicles', {
        method: editing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message)
      setVehicles(current => (editing ? current.map(vehicle => vehicle.id === editing.id ? result : vehicle) : [...current, result]).sort((a, b) => a.plate.localeCompare(b.plate)))
      setEditing(null); form.reset(); setMessage({ text: 'Datos del vehículo guardados.' })
      window.dispatchEvent(new Event('jalon-trips-update'))
    } catch (error) { setMessage({ error: true, text: error.message || 'No se pudo guardar el vehículo.' }) }
    finally { setSaving(false) }
  }
  return <>
    <section hidden={view !== 'vehiculos'} aria-labelledby="vehicle-heading">
      <header className="section-heading"><span className="card-eyebrow">Tu vehículo</span><h2 id="vehicle-heading">Así te reconocerán al llegar</h2><p>Completa la marca, el modelo, el color y una fotografía del carro.</p></header>
      {vehicles && <>
        <ul className="owned-vehicles">{vehicles.map(vehicle => <li key={vehicle.id}>
          {vehicle.hasPhoto && <img src={'/api/vehicles/' + encodeURIComponent(vehicle.id) + '/photo'} alt={[vehicle.brand, vehicle.model].filter(Boolean).join(' ') || 'Tu vehículo'} />}
          <div><strong>{[vehicle.brand, vehicle.model].filter(Boolean).join(' ') || vehicle.plate}</strong><p>{vehicle.color || 'Color pendiente'} · {vehicle.plate} · {vehicle.seats} asientos</p>{vehicle.photoReference && <small>Foto de referencia de la demostración</small>}</div>
          <button type="button" className="secondary" onClick={() => setEditing(vehicle)}>Editar datos y foto</button>
        </li>)}</ul>
        <form onSubmit={save} key={editing?.id || 'new-vehicle'} aria-busy={saving} className="vehicle-form">
          <h3>{editing ? 'Actualizar vehículo' : 'Registrar vehículo'}</h3>
          {!editing && <><label htmlFor="vehicle-plate">Placa</label><input id="vehicle-plate" name="plate" pattern="[A-Za-z]{3}[0-9]{3}" maxLength={6} placeholder="ABC123" autoCapitalize="characters" required /></>}
          <div className="vehicle-description-fields">
            <label>Marca<input name="brand" maxLength={40} defaultValue={editing?.brand || ''} placeholder="Toyota" required /></label>
            <label>Modelo<input name="model" maxLength={60} defaultValue={editing?.model || ''} placeholder="Yaris 2013" required /></label>
            <label>Color<input name="color" maxLength={30} defaultValue={editing?.color || ''} placeholder="Blanco" required /></label>
          </div>
          <label htmlFor="vehicle-photo">Fotografía del vehículo</label><input id="vehicle-photo" name="photo" type="file" accept="image/jpeg,image/png,image/webp" /><small>Elige una foto clara del carro. Se ajustará su tamaño antes de guardarla.</small>
          {!editing && <><label htmlFor="vehicle-seats">Asientos disponibles</label><input id="vehicle-seats" name="seats" type="number" min="1" max="2147483647" step="1" required />
          <label htmlFor="vehicle-efficiency">Rendimiento (km/gal)</label><input id="vehicle-efficiency" name="efficiency" type="number" min="0" step="any" required /></>}
          <div className="actions"><button disabled={saving}>{saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Registrar vehículo'}</button>{editing && <button type="button" className="secondary" onClick={() => setEditing(null)}>Cancelar edición</button>}</div>
        </form>
      </>}
      {message && <p className={message.error ? 'notice error' : 'notice'} role={message.error ? 'alert' : 'status'}>{message.text}</p>}
    </section>
    <div hidden={view !== 'publicados'}>{vehicles?.length ? <Viajes vehicles={vehicles} composeSignal={composeSignal} initialStatus={tripStatus} navigationId={navigationId} composeRequested={composeRequested} /> : <section><h2>Mis viajes</h2><p>{message?.text || 'Registra un vehículo para publicar un viaje.'}</p></section>}</div>
  </>
}
