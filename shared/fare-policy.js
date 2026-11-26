export const maximumFareCop = 25000

export const defaultFare = Object.freeze({ minimumCop: 11000, perKmCop: 1200 })

export function validFare(value) {
  return value && !Array.isArray(value) && Object.keys(value).every(key => ['minimumCop', 'perKmCop'].includes(key)) &&
    Number.isSafeInteger(value.minimumCop) && value.minimumCop >= 11000 && value.minimumCop <= maximumFareCop &&
    Number.isSafeInteger(value.perKmCop) && value.perKmCop >= 100 && value.perKmCop <= 100000
}
