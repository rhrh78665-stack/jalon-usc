import { argon2, randomBytes, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { requireRule } from './rules.js'

const derive = promisify(argon2)
const argonOptions = {
    parallelism: 1,
    tagLength: 32,
    memory: 19_456,
    passes: 2,
}

export async function hashPassword(password) {
    requireRule(
        typeof password === 'string' &&
        password.length >= 10 &&
        password.length <= 128,
        'La contraseña debe tener entre 10 y 128 caracteres.',
    )

    const nonce = randomBytes(16)
    const tag = await derive('argon2id', {
        ...argonOptions,
        nonce,
        message: Buffer.from(password),
    })

    return nonce.toString('hex') + ':' + tag.toString('hex')
}

export async function verifyPassword(password, stored) {
    if (typeof password !== 'string' || password.length < 10 || password.length > 128) {
        return false
    }
    if (typeof stored !== 'string' || !/^[0-9a-f]{32}:[0-9a-f]{64}$/i.test(stored)) {
        return false
    }

    const [salt, hash] = stored.split(':')
    const tag = await derive('argon2id', {
        ...argonOptions,
        nonce: Buffer.from(salt, 'hex'),
        message: Buffer.from(password),
    })

    return timingSafeEqual(tag, Buffer.from(hash, 'hex'))
}