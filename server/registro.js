export function logRequestError(error) {
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,20}$/.test(error.code) ? error.code : 'INTERNAL'
  console.error(JSON.stringify({ event: 'request_failed', code, at: new Date().toISOString() }))
}
