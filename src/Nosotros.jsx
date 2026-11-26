import React from 'react'
import { photoCredits } from '../shared/photo-credits.js'

const team = [
  ['AS', 'Alejandro Soto Coy', 'Product Owner', 'Requisitos y priorización'],
  ['MP', 'María Paula Narváez Castillo', 'Scrum Master', 'Seguimiento y coordinación'],
  ['DG', 'Darlyn Dayana Grisales Orozco', 'Desarrollo', 'Backend y base de datos'],
  ['SG', 'Sacarías Granja Hurtado', 'Desarrollo', 'Frontend y accesibilidad'],
  ['MO', 'Miguel Ángel Ossa Rojas', 'Desarrollo', 'API e integración'],
  ['JA', 'Jhonier Andrés Arroyo Charria', 'Desarrollo', 'Calidad y trazabilidad'],
]
export default function Nosotros() {
  return <section className="about-page" aria-labelledby="about-heading">
    <header className="about-hero"><span className="card-eyebrow">Nuestra comunidad</span>
      <h2 id="about-heading">Compartimos camino.<br /><em>Construimos comunidad.</em></h2>
      <p>Somos un equipo de estudiantes que desarrolla una forma más organizada de compartir los recorridos hacia y desde la Universidad Santiago de Cali.</p>
      <span className="about-signature">Un proyecto académico nacido en Cali.</span>
    </header>
    <div className="about-story"><div><span className="card-eyebrow">Quiénes somos</span><h3>La universidad nos conecta.<br />El viaje también puede hacerlo.</h3></div>
      <div><p>Jalón USC reúne a estudiantes que tienen un vehículo con quienes buscan un asiento para llegar al campus. Nuestro propósito es facilitar la coordinación de horarios, puntos de encuentro y reservas dentro de la comunidad universitaria.</p>
      <p>Diseñamos cada recorrido para que puedas reconocer al conductor y su vehículo, consultar el valor antes de reservar y mantener un registro de tus viajes. Movilidad administra las validaciones y las tarifas desde su propio espacio.</p></div></div>
    <div className="about-values"><article><span>01</span><h3>Claridad antes de salir</h3><p>Conductor, placa, ruta y valor disponibles antes de solicitar un asiento.</p></article>
      <article><span>02</span><h3>Coordinación en cada tramo</h3><p>Reservas y cupos organizados según los puntos de subida y bajada.</p></article>
      <article><span>03</span><h3>Continuidad después del viaje</h3><p>Historial, calificaciones y registro de incidentes para dar seguimiento a la experiencia.</p></article></div>
    <header className="team-heading" id="equipo"><span className="card-eyebrow">Seis personas, un mismo proyecto</span><h3>Nuestro equipo</h3></header>
    <ul className="team-grid">{team.map(([initials, name, role, area], index) => <li key={name} style={{ '--member-index': index }}><span className="team-number" aria-hidden="true">{String(index+1).padStart(2,'0')}</span><div><h4>{name}</h4><strong>{role}</strong><p>{area}</p></div></li>)}</ul>
    <footer className="about-footer"><p>Proyecto académico · Santiago de Cali</p>
      <details id="creditos"><summary>Créditos fotográficos</summary><p>Las imágenes de vehículos de la demostración son fotografías de referencia, redimensionadas para la web; no representan vehículos de los integrantes del equipo.</p>
        <ul className="photo-credit-list">{photoCredits.map(photo => <li key={photo.source}><a href={photo.source} target="_blank" rel="noreferrer">{photo.title.replace(/\.(jpg|png)$/i, '')}</a> · {photo.author} · <a href={photo.licenseUrl} target="_blank" rel="noreferrer">{photo.license}</a>. Imagen redimensionada, convertida a WebP y compartida bajo su licencia original.</li>)}</ul></details>
    </footer>
  </section>
}
