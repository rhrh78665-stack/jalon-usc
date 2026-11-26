export function configureTransport(app) {
  const production = process.env.NODE_ENV === 'production'
  const proxy = process.env.JALON_TRUST_PROXY
  if (proxy) app.set('trust proxy', proxy.split(',').map(value => value.trim()))
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://tile.openstreetmap.org; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
    })
    if (production && !req.secure) {
      return res.status(426).json({ message: 'Utiliza la conexión HTTPS del sitio.' })
    }
    if (production && req.secure) res.set('Strict-Transport-Security', 'max-age=31536000')
    next()
  })
}
