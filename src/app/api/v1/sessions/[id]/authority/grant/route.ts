/**
 * POST /api/v1/sessions/:id/authority/grant — concede ou renova época assinada
 * para o servidor desktop designado da Câmara.
 */
import { createPrivateKey } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { apiHandler, DomainError } from '@/lib/server/errors'
import { resolveActor } from '@/lib/server/actor'
import { requirePermission } from '@/lib/server/rbac'
import { loadSession } from '@/lib/server/loaders'
import { reserveSessionAuthorityLease } from '@/lib/server/session-authority-lease'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  deviceId: z.string().trim().min(1).max(200),
  revisionId: z.string().trim().min(1).max(200),
  manifestSha256: z.string().regex(/^[0-9a-f]{64}$/, 'manifestSha256 deve ser SHA-256 hexadecimal.'),
})

export const POST = apiHandler(async (req: NextRequest, ctx, correlationId) => {
  const actor = await resolveActor(req)
  requirePermission(actor, 'session.transition')
  const { id } = await ctx.params
  const body = bodySchema.parse(await req.json())
  const session = await loadSession(actor, id)

  const pem = process.env.LOCAL_AUTHORITY_SIGNING_PRIVATE_KEY?.trim()
  const keyId = process.env.LOCAL_AUTHORITY_SIGNING_KEY_ID?.trim() || 'edocbr-authority-1'
  if (!pem) {
    throw new DomainError(
      'LOCAL_AUTHORITY_PRECONDITION',
      409,
      'Chave de assinatura não provisionada',
      'Configure LOCAL_AUTHORITY_SIGNING_PRIVATE_KEY (Ed25519 PEM) antes de emitir concessões de autoridade local.'
    )
  }

  let privateKey
  try {
    privateKey = createPrivateKey(pem)
  } catch {
    throw new DomainError(
      'LOCAL_AUTHORITY_PRECONDITION',
      409,
      'Chave de assinatura inválida',
      'LOCAL_AUTHORITY_SIGNING_PRIVATE_KEY não é uma chave Ed25519 PEM válida.'
    )
  }

  const grant = await reserveSessionAuthorityLease({
    tenantId: session.tenantId,
    sessionId: session.id,
    deviceId: body.deviceId,
    revisionId: body.revisionId,
    manifestSha256: body.manifestSha256,
    keyId,
    privateKey,
    correlationId,
  })

  return Response.json({ grant })
})
