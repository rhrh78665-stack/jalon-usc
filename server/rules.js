export class RuleError extends Error {
    constructor(message, status = 400) {
        super(message)
        this.status = status
    }
}

export function requireRule(condition, message, status) {
    if (!condition) throw new RuleError(message, status)
}

export function institutionalEmail(value) {
    requireRule(typeof value === 'string', 'Indica un correo institucional.')
    const email = value.trim().toLowerCase()
    const [local, host, extra] = email.split('@')
    requireRule(
        email.length <= 254 &&
        /^[a-z0-9][a-z0-9._+-]{0,63}$/.test(local) &&
        host === 'usc.edu.co' &&
        extra === undefined,
        'Usa un correo del dominio usc.edu.co.',
    )
    return email
}