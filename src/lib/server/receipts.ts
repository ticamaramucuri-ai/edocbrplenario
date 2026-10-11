import { createHmac } from 'node:crypto'

/**
 * Onda 4 / Fase 18 — Recibos verificáveis de voto nominal (ADR-019).
 *
 * Cada voto nominal fechado gera um recibo determinístico:
 *   payload   = `${votingId}|${parliamentarianId}|${value}|${closedAtISO}`
 *   tenantKey = HMAC-SHA256(segredo da plataforma, `tenant:${tenantId}`)
 *   hash      = HMAC-SHA256(tenantKey, payload)
 *   code      = hash.slice(0, 12).toUpperCase()
 *
 * Voto SECRETO nunca inclui o valor no payload (constante `__SIGILO__`):
 * o recibo prova participação, sem permitir correlação com o resultado.
 *
 * Sandbox: segredo fixo documentado. Produção: secret manager com rotação
 * por tenant (a recompute usa a chave vigente; rotações registram a vigência).
 */

const PLATFORM_RECEIPT_SECRET =
  process.env.LEGIS_RECEIPT_SECRET ?? 'legis-saas-demo-receipt-secret-v1'

/** Valor usado no lugar do voto real quando a votação é secreta. */
export const SECRET_VOTE_PLACEHOLDER = '__SIGILO__'

export function deriveTenantReceiptSecret(tenantId: string): string {
  return createHmac('sha256', PLATFORM_RECEIPT_SECRET).update(`tenant:${tenantId}`).digest('hex')
}

export function receiptPayload(
  votingId: string,
  parliamentarianId: string,
  value: string,
  closedAtIso: string,
): string {
  return [votingId, parliamentarianId, value, closedAtIso].join('|')
}

export function computeReceipt(
  tenantId: string,
  votingId: string,
  parliamentarianId: string,
  value: string,
  closedAtIso: string,
): { code: string; hash: string } {
  const tenantKey = deriveTenantReceiptSecret(tenantId)
  const payload = receiptPayload(votingId, parliamentarianId, value, closedAtIso)
  const hash = createHmac('sha256', tenantKey).update(payload).digest('hex')
  return { code: hash.slice(0, 12).toUpperCase(), hash }
}
