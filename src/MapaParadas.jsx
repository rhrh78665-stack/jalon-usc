import React, { useId } from 'react'
import { mapPoints } from '../shared/mapa.js'

export default function MapaParadas({ stops }) {
  const titleId = useId()
  const descriptionId = useId()
  const selected = mapPoints(stops)
  if (!selected.length) return null
  return (
    <figure className="stop-map">
      <svg viewBox="0 0 640 280" role="img" aria-labelledby={titleId} aria-describedby={descriptionId}>
        <title id={titleId}>Esquema del itinerario</title>
        <desc id={descriptionId}>{selected.map((stop, i) => (i + 1) + '. ' + stop.nombre).join(', ')}</desc>
        <rect x="1" y="1" width="638" height="278" rx="12" fill="#f3f6fc" stroke="#dbe3ee" />
        {[70, 140, 210].map(y => <line key={y} x1="25" y1={y} x2="615" y2={y} stroke="#dbe3ee" />)}
        {[80, 200, 320, 440, 560].map(x => <line key={x} x1={x} y1="25" x2={x} y2="255" stroke="#dbe3ee" />)}
        <polyline points={selected.map(stop => { return stop.x + ',' + stop.y }).join(' ')}
          fill="none" stroke="#174ec9" strokeWidth="4" strokeLinejoin="round" />
        {selected.map((stop, index) => {
          const { x, y } = stop
          return (
            <g key={stop.id}>
              <circle cx={x} cy={y} r="13" fill={index === selected.length - 1 ? '#ffcb32' : '#174ec9'} />
              <text x={x} y={y + 4} textAnchor="middle" fill={index === selected.length - 1 ? '#111c36' : 'white'} fontSize="12">
                {index + 1}
              </text>
              <text x={x} y={y - 22} textAnchor={x > 510 ? 'end' : 'start'} fill="#111c36" fontSize="14">{stop.nombre}</text>
            </g>
          )
        })}
        <text x="28" y="27" fill="#4e6079" fontSize="12">N ↑</text>
      </svg>
      <figcaption>Ubicaciones de referencia del catálogo. La línea representa el orden de las paradas.</figcaption>
    </figure>
  )
}
