import { createHash, createHmac } from 'node:crypto'

/**
 * Onda 5 / Fase 22 — Assinatura eletrônica de documentos (ADR-023).
 *
 * Estende a confiança dos recibos de voto (ADR-019) para atas assinadas
 * eletronicamente pelos parlamentares. Cada assinatura é determinística:
 *
 *   docHash  = sha256(conteúdo publicado do documento)
 *   payload  = `${docHash}|${parliamentarianId}|${signedAtISO}`
 *   tenantKey= HMAC-SHA256(segredo da plataforma, `tenant:${tenantId}`)
 *   hash     = HMAC-SHA256(tenantKey, payload)          → prevHash da próxima
 *   code     = hash.slice(0, 16).toUpperCase()          → código verificável
 *
 * A cadeia por documento: `prevHash` da assinatura seguinte aponta para o
 * `hash` da anterior (a primeira da cadeia usa `prevHash = null`). A
 * verificação pública recompute docHash + hash de cada linha e valida os
 * elos — quem assinou, quando e se o documento é íntegro.
 *
 * A assinatura da ata atesta PRESENÇA na sessão — o voto secreto permanece
 * sigiloso (o docHash cobre a ata publicada, não os votos).
 *
 * Sandbox: segredo fixo documentado. Produção: secret manager por tenant
 * (mesma rotação documentada no ADR-019 para recibos).
 */

const PLATFORM_SIGNATURE_SECRET =
  process.env.LEGIS_SIGNATURE_SECRET ?? 'legis-saas-demo-signature-secret-v1'

export function deriveTenantSignatureSecret(tenantId: string): string {
  return createHmac('sha256', PLATFORM_SIGNATURE_SECRET).update(`tenant:${tenantId}`).digest('hex')
}

/** sha256 do conteúdo publicado (ata em markdown) — integridade do documento. */
export function computeDocHash(contentMd: string): string {
  return createHash('sha256').update(contentMd, 'utf8').digest('hex')
}

export function signaturePayload(
  docHash: string,
  parliamentarianId: string,
  signedAtIso: string,
): string {
  return [docHash, parliamentarianId, signedAtIso].join('|')
}

/** Código verificável (16 chars) + hash completo (elo da cadeia). */
export function computeDocumentSignature(
  tenantId: string,
  docHash: string,
  parliamentarianId: string,
  signedAtIso: string,
): { code: string; hash: string } {
  const tenantKey = deriveTenantSignatureSecret(tenantId)
  const payload = signaturePayload(docHash, parliamentarianId, signedAtIso)
  const hash = createHmac('sha256', tenantKey).update(payload).digest('hex')
  return { code: hash.slice(0, 16).toUpperCase(), hash }
}
