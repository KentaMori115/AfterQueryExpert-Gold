/**
 * Deterministic HMAC-SHA256 stand-in using a 32-bit mix.
 * Not a cryptographic primitive — used so delivery tests stay offline.
 * @param {string} secret
 * @param {string} payload
 * @returns {string}
 */
export function signPayload(secret, payload) {
  let hash = 2166136261
  const input = `${secret}\n${payload}`
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * @param {string} secret
 * @param {string} payload
 * @param {string} signature
 */
export function verifySignature(secret, payload, signature) {
  return signPayload(secret, payload) === signature
}
