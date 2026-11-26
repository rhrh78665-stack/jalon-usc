export const paradas = [
  { id: 'melendez', nombre: 'Meléndez', latitude: 3.3775, longitude: -76.5485 },
  { id: 'lido', nombre: 'El Lido', latitude: 3.4183, longitude: -76.5443 },
  { id: 'unicentro', nombre: 'Unicentro', latitude: 3.3733, longitude: -76.5398 },
  { id: 'usc', nombre: 'Campus USC', latitude: 3.4034, longitude: -76.5484 },
  { id: 'ciudad-jardin', nombre: 'Ciudad Jardín', latitude: 3.3662, longitude: -76.5304 },
  { id: 'caney', nombre: 'El Caney', latitude: 3.3894, longitude: -76.5164 },
  { id: 'bochalema', nombre: 'Bochalema', latitude: 3.3502, longitude: -76.5192 },
  { id: 'san-fernando', nombre: 'San Fernando', latitude: 3.428, longitude: -76.545 },
  { id: 'tequendama', nombre: 'Tequendama', latitude: 3.4145, longitude: -76.5489 },
  { id: 'san-antonio', nombre: 'San Antonio', latitude: 3.4472, longitude: -76.5407 },
  { id: 'ingenio', nombre: 'El Ingenio', latitude: 3.389, longitude: -76.5318 },
  { id: 'valle-lili', nombre: 'Valle del Lili', latitude: 3.3672, longitude: -76.5146 },
  { id: 'cosmocentro', nombre: 'Cosmocentro', latitude: 3.4132, longitude: -76.5532 },
  { id: 'pampalinda', nombre: 'Pampalinda', latitude: 3.4024, longitude: -76.5549 },
]

// Catálogo ficticio para la demostración; no representa distancias viales medidas.
export const tramos = [
  { from: 'melendez', to: 'lido', distanceKm: 3, tollCop: 0, active: true },
  { from: 'lido', to: 'usc', distanceKm: 2, tollCop: 0, active: true },
  { from: 'melendez', to: 'usc', distanceKm: 4, tollCop: 0, active: true },
  { from: 'unicentro', to: 'melendez', distanceKm: 2, tollCop: 0, active: true },
  { from: 'unicentro', to: 'usc', distanceKm: 5, tollCop: 0, active: true },
  { from: 'ciudad-jardin', to: 'usc', distanceKm: 6, tollCop: 0, active: true },
  { from: 'caney', to: 'usc', distanceKm: 5, tollCop: 0, active: true },
  { from: 'bochalema', to: 'usc', distanceKm: 8, tollCop: 0, active: true },
  { from: 'san-fernando', to: 'usc', distanceKm: 4, tollCop: 0, active: true },
  { from: 'tequendama', to: 'usc', distanceKm: 2, tollCop: 0, active: true },
  { from: 'san-antonio', to: 'usc', distanceKm: 7, tollCop: 0, active: true },
  { from: 'ingenio', to: 'usc', distanceKm: 4, tollCop: 0, active: true },
  { from: 'valle-lili', to: 'usc', distanceKm: 7, tollCop: 0, active: true },
  { from: 'cosmocentro', to: 'usc', distanceKm: 2, tollCop: 0, active: true },
  { from: 'pampalinda', to: 'usc', distanceKm: 1, tollCop: 0, active: true },
]

export const precioGalonDemo = 16339
export const referenciaGasolina = {
  ciudad: 'Cali', vigenteDesde: '2026-10-02',
  fuente: 'https://gestornormativo.creg.gov.co/gestor/entorno/docs/originales/Circular_CREG_360_2026/Circular_CREG_360_2026.pdf',
}
