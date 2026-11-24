import React, { useEffect, useState } from 'react'
import { api } from './Itinerario.jsx'

export default function Reputacion({ userId = 'mine', tripId }) {
  const [profile, setProfile] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setProfile(null)
    setError('')
    api(tripId ? '/api/trips/' + encodeURIComponent(tripId) + '/reputation' : '/api/reputation/' + encodeURIComponent(userId), { signal: controller.signal }).then(setProfile)
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message) })
    return () => controller.abort()
  }, [userId, tripId])
  return (
    <div className="reputation" aria-label="Reputación">
      {error && <p role="alert">{error}</p>}
      {profile && <p><strong>{profile.alias || 'Conductor del viaje'}</strong>{' · '}
        {profile.count === 0 ? 'Sin calificaciones' : <>
          <span aria-label={profile.average.toFixed(1) + ' de 5 estrellas'}>
            ★ {profile.average.toLocaleString('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}/5
          </span>{' · '}{profile.count} {profile.count === 1 ? 'calificación' : 'calificaciones'}
        </>}
      </p>}
    </div>
  )
}
