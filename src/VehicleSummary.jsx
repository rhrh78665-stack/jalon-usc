import React, { useState } from 'react'

export default function VehicleSummary({ trip, showDriver = true }) {
  const [failed, setFailed] = useState(false)
  const vehicle = trip.vehicle || {}
  return <div className="journey-vehicle">
    <div className="journey-photo">
      {vehicle.photoUrl && !failed
        ? <img src={vehicle.photoUrl} alt={[vehicle.brand, vehicle.model, vehicle.color].filter(Boolean).join(' · ') || 'Vehículo del viaje'} loading="lazy" onError={() => setFailed(true)} />
        : <div className="vehicle-no-photo"><svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 17h18l-2-7H5l-2 7ZM7 10l2-5h6l2 5M6 17v3m12-3v3" /></svg><span>Foto no registrada</span></div>}
      <div className="photo-caption">
        {trip.availableSeats != null && <span className="photo-seats">{trip.availableSeats} {trip.availableSeats === 1 ? 'asiento' : 'asientos'}</span>}
        {vehicle.photoReference && <span className="photo-reference">Foto de referencia</span>}
      </div>
    </div>
    <div className="journey-person">
      <span className="card-eyebrow">{showDriver?'Conduce':'Vehículo del recorrido'}</span>
      <strong className="driver-name">{showDriver?(trip.driver?.name || 'Conductor de la comunidad'):[vehicle.brand,vehicle.model].filter(Boolean).join(' ')}</strong>
      {showDriver && <p>{[vehicle.brand, vehicle.model].filter(Boolean).join(' ') || 'Vehículo por describir'}</p>}
      <div className="vehicle-identification"><span>{vehicle.color || 'Color no registrado'}</span><span className="license-plate" aria-label={'Placa ' + vehicle.plate}>{vehicle.plate || 'Placa no registrada'}</span></div>
    </div>
  </div>
}
