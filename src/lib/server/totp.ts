/**
 * Onda 5 / Fase 22 — TOTP nativo (RFC 6238) SEM dependências externas.
 *
 * Implementa o algoritmo de senha de uso único baseada em tempo com
 * `node:crypto` (HMAC-SHA1, 6 dígitos, janela de 30s — o padrão do Google
 * Authenticator), incluindo base32 (RFC 4648) para transportar o segredo.
 *
 * Verificação com drift ±1 janela: aceita o código atual, o anterior ou o
 * próximo — relógios de celular atrasados/adiantados continuam funcionando
 * sem abrir janela maior (security vs. usabilidade, ADR-023).
 *
 * PRODUÇÃO (caminho documentado no ADR-023): migrar para OIDC/SAML com
 * IdP dedicado; o TOTP nativo permanece como fallback offline.
 */
import { createHmac, randomBytes } from 'crypto'

// ─── Base32 (RFC 4648, sem padding) ─────────────────────────────────────────

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** Codifica bytes para base32 (RFC 4648) sem `=` de padding. */
export function base32Encode(bytes: Buffer): string {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  }
  return output
}

/** Decodifica base32 (ignora espaços, hífens e padding; inválida → ''). */
export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s\-=]/g, '')
  let bits = 0
  let value = 0
  const bytes: number[] = []
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch)
    if (idx === -1) return Buffer.alloc(0)
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

// ─── TOTP (RFC 6238) ────────────────────────────────────────────────────────

export const TOTP_PERIOD_SECONDS = 30
export const TOTP_DIGITS = 6
/** Janela de tolerância na verificação: aceita contra-passo ±1. */
export const TOTP_DRIFT_STEPS = 1

/** Contador de tempo RFC 4226: floor(ms / 30000). */
export function totpCounter(atMs: number): number {
  return Math.floor(atMs / (TOTP_PERIOD_SECONDS * 1000))
}

/**
 * Código HOTP/TOTP de UM contador: HMAC-SHA1(segredo, contador 8 bytes
 * big-endian) + dynamic truncation do RFC 4226, 6 dígitos zero-padded.
 */
function hotpAt(key: Buffer, counter: number): string {
  const buf = Buffer.alloc(8)
  buf.writeUInt32BE(Math.floor(counter / 0x100000000), 0)
  buf.writeUInt32BE(counter >>> 0, 4)
  const digest = createHmac('sha1', key).update(buf).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3]
  const code = binary % 10 ** TOTP_DIGITS
  return code.toString().padStart(TOTP_DIGITS, '0')
}

/** Gera um segredo TOTP: 20 bytes aleatórios codificados em base32. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

/** Código TOTP do segredo (base32) no instante `atMs` (default: agora). */
export function totpCode(secret: string, atMs: number = Date.now()): string {
  const key = base32Decode(secret)
  return hotpAt(key, totpCounter(atMs))
}

/**
 * Verifica um código contra o segredo com drift ±1 janela: aceita o código
 * do passo atual, do anterior ou do próximo. Segredo inválido → sempre false.
 * A comparação é feita em tempo constante sobre o código normalizado.
 */
export function verifyTotp(secret: string, code: string, atMs: number = Date.now()): boolean {
  const key = base32Decode(secret)
  if (key.length === 0) return false
  const normalized = code.replace(/\D/g, '')
  if (normalized.length !== TOTP_DIGITS) return false
  const counter = totpCounter(atMs)
  for (let drift = -TOTP_DRIFT_STEPS; drift <= TOTP_DRIFT_STEPS; drift++) {
    const expected = hotpAt(key, counter + drift)
    // timingSafeEqual exige buffers de mesmo tamanho (ambos 6 chars ASCII).
    if (timingSafeEqualAscii(normalized, expected)) return true
  }
  return false
}

function timingSafeEqualAscii(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

/**
 * URL otpauth:// para leitura de QR Code pelos autenticadores
 * (Google Authenticator, Microsoft Authenticator, 1Password…):
 * `otpauth://totp/Legis%20SaaS:{email}?secret=…&issuer=Legis%20SaaS&algorithm=SHA1&digits=6&period=30`
 * (rótulo issuer:email com componentes codificados por RFC 3986).
 */
export function otpauthUrl(secret: string, email: string): string {
  const issuer = 'edocBR Plenário'
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SECONDS}`
}
