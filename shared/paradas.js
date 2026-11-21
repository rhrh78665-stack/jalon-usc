export const paradas = [
  { id: 'melendez', nombre: 'Meléndez' },
  { id: 'lido', nombre: 'El Lido' },
  { id: 'unicentro', nombre: 'Unicentro' },
  { id: 'usc', nombre: 'Campus USC' },
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
