/** One exact signed revision issued to the designated local server. */
import { createHash } from 'node:crypto'
import { db } from '@/lib/db'
import { canonicalManifest } from '@/lib/session-transfer-contract'
import { parsePlanLimits } from './entitlements'
import { DomainError, notFound, unauthenticated } from './errors'
import { buildSessionTransferCandidate } from './session-transfer-export'
import { signSessionTransferCandidate } from './session-transfer-signing'

export async function issueSessionTransfer(args: { tenantId: string; sessionId: string; deviceId: string }) {
  const session = await db.session.findFirst({ where: { id: args.sessionId, tenantId: args.tenantId }, select: { id: true } })
  if (!session) throw notFound('Sessão não encontrada nesta Câmara.')
  let candidate: Awaited<ReturnType<typeof buildSessionTransferCandidate>>
  try { candidate = await buildSessionTransferCandidate({ tenantId: args.tenantId, sessionId: args.sessionId }) }
  catch (error) {
    if (error && typeof error === 'object' && 'code' in error) throw error
    console.error('[session-transfer] preparation failed', error)
    throw new DomainError('SESSION_PRECONDITION', 409, 'Sessão ainda não preparável',
      'Publique uma revisão completa da pauta, matérias e documentos antes de transferir.')
  }
  const totalBytes = candidate.manifest.artifacts.reduce((sum, item) => sum + item.sizeBytes, 0)
  if (candidate.manifest.artifacts.length > 500 || totalBytes > 512 * 1024 * 1024) {
    throw new DomainError('SESSION_PRECONDITION', 409, 'Pacote excede o limite',
      'A preparação da sessão excede os limites de transferência local.')
  }
  const subscription = await db.subscription.findUnique({ where: { tenantId: args.tenantId },
    select: { plan: { select: { limits: true } } } })
  const planMiB = subscription && parsePlanLimits(subscription.plan.limits).maxTransferPackageMiB
  if (planMiB && totalBytes > planMiB * 1024 * 1024) {
    throw new DomainError('PLAN_LIMIT', 402, 'Pacote acima do plano',
      `A revisão possui ${totalBytes} bytes e excede o limite de ${planMiB} MiB por sessão desta Câmara.`)
  }
  const root = process.env.EDOCBR_TRANSFER_KEY_ROOT
  if (!root) throw new DomainError('LOCAL_TRANSFER_UNAVAILABLE', 503, 'Transferência indisponível',
    'Chave de assinatura da Câmara ainda não foi configurada.')
  let signature: Awaited<ReturnType<typeof signSessionTransferCandidate>>['signature']
  try { ({ signature } = await signSessionTransferCandidate({ root, tenantId: args.tenantId, ...candidate })) }
  catch (error) {
    console.error('[session-transfer] signing failed', error)
    throw new DomainError('LOCAL_TRANSFER_UNAVAILABLE', 503, 'Transferência indisponível',
      'Chave de assinatura da Câmara indisponível.')
  }
  const designated = await db.localServerDesignation.findFirst({ where: { tenantId: args.tenantId, deviceId: args.deviceId } })
  const registered = await db.localServerDevice.findFirst({ where: { tenantId: args.tenantId, id: args.deviceId, status: 'registered' } })
  if (!designated || !registered) throw unauthenticated('Servidor local não designado para esta Câmara.')
  const manifestJson = canonicalManifest(candidate.manifest)
  if (Buffer.byteLength(manifestJson) > 2 * 1024 * 1024) {
    throw new DomainError('SESSION_PRECONDITION', 409, 'Manifesto excede o limite', 'Reduza os metadados da sessão.')
  }
  const manifestSha256 = createHash('sha256').update(manifestJson).digest('hex')
  const issue = await db.localSessionTransferIssue.upsert({
    where: { tenantId_deviceId_revisionId_manifestSha256: {
      tenantId: args.tenantId, deviceId: args.deviceId, revisionId: candidate.manifest.revisionId, manifestSha256 } },
    update: { manifestJson },
    create: { tenantId: args.tenantId, deviceId: args.deviceId, sessionId: args.sessionId,
      revisionId: candidate.manifest.revisionId, revisionNumber: candidate.manifest.revisionNumber,
      manifestSha256, manifestJson, artifactHashesJson: JSON.stringify(candidate.manifest.artifacts.map((item) => ({
        id: item.id, sha256: item.sha256, sizeBytes: item.sizeBytes }))) },
  })
  return { ...candidate, signature, issueId: issue.id, manifestSha256 }
}
