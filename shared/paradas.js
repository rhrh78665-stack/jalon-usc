export const paradas = [
  { id: 'melendez', nombre: 'Meléndez', latitude: 3.3775, longitude: -76.5485 },
  { id: 'lido', nombre: 'El Lido', latitude: 3.4183, longitude: -76.5443 },
  { id: 'unicentro', nombre: 'Unicentro', latitude: 3.3733, longitude: -76.5398 },
  { id: 'usc', nombre: 'Campus USC', latitude: 3.4034, longitude: -76.5484 },
]

// Catálogo ficticio para la demostración; no representa distancias viales medidas.
export const tramos = [
  { from: 'melendez', to: 'lido', distanceKm: 3, tollCop: 0, active: true },
  { from: 'lido', to: 'usc', distanceKm: 2, tollCop: 0, active: true },
  { from: 'melendez', to: 'usc', distanceKm: 4, tollCop: 0, active: true },
  { from: 'unicentro', to: 'melendez', distanceKm: 2, tollCop: 0, active: true },
  { from: 'unicentro', to: 'usc', distanceKm: 5, tollCop: 0, active: true },
]

export const precioGalonDemo = 15000
