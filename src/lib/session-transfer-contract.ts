/** Versioned, signed preparation package for one designated local chamber server.
 *
 * This contract does not grant session authority or enable offline voting. The
 * verifier requires a trusted public key supplied out of band and every byte
 * named by the manifest before a revision can be marked prepared locally.
 */
import { createHash, sign as signBytes, verify as verifyBytes, type KeyObject } from 'node:crypto'
import { z } from 'zod'

const hexSha256 = z.string().regex(/^[0-9a-f]{64}$/)
const identifier = z.string().min(1).max(200)
const isoTime = z.string().refine((value) => !Number.isNaN(Date.parse(value)) && /(?:Z|[+-]\d\d:\d\d)$/.test(value), 'ISO timestamp with offset required')

export const transferManifestV1Schema = z.object({
  format: z.literal('edocbr.session-transfer'),
  schemaVersion: z.literal(1),
  tenantId: identifier,
  sessionId: identifier,
  revisionId: identifier,
  revisionNumber: z.number().int().positive(),
  sessionVersion: z.number().int().positive(),
  officialConfigurationId: identifier.nullable(),
  createdAt: isoTime,
  agendaSnapshot: z.array(z.record(z.string(), z.unknown())),
  policySnapshot: z.record(z.string(), z.unknown()),
  deliberationPolicySnapshot: z.record(z.string(), z.unknown()).refine((policy) => Object.keys(policy).length > 0, 'Deliberation policy required'),
  rosterSnapshot: z.array(z.object({
    parliamentarianId: identifier,
    displayName: z.string().min(1),
    party: z.string().min(1),
    active: z.boolean(),
    boardRole: z.string().nullable(),
  }).strict()).min(1),
  artifacts: z.array(z.object({
    id: identifier,
    source: z.enum(['session_document', 'matter_attachment']),
    sourceId: identifier,
    name: z.string().min(1),
    mimeType: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    sha256: hexSha256,
  }).strict()),
}).strict()

export type TransferManifestV1 = z.infer<typeof transferManifestV1Schema>
export type TransferSignatureV1 = { algorithm: 'Ed25519'; keyId: string; valueBase64: string }

function canonicalValue(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (typeof value === 'object' && value && Object.getPrototypeOf(value) === Object.prototype) {
    const result: Record<string, unknown> = Object.create(null)
    for (const key of Object.keys(value).sort()) result[key] = canonicalValue((value as Record<string, unknown>)[key])
    return result
  }
  throw new Error('Manifesto contém valor não canônico ou indefinido.')
}

export function canonicalManifest(manifest: TransferManifestV1): string {
  return JSON.stringify(canonicalValue(manifest))
}

function signedBytes(manifest: TransferManifestV1): Buffer {
  return Buffer.from('edocbr.session-transfer.v1\n' + canonicalManifest(manifest), 'utf8')
}

function assertManifest(manifest: TransferManifestV1): TransferManifestV1 {
  const parsed = transferManifestV1Schema.parse(manifest)
  canonicalManifest(parsed)
  const artifactIds = parsed.artifacts.map((entry) => entry.id)
  const rosterIds = parsed.rosterSnapshot.map((entry) => entry.parliamentarianId)
  if (new Set(artifactIds).size !== artifactIds.length || new Set(rosterIds).size !== rosterIds.length) {
    throw new Error('Manifesto contém identificadores duplicados.')
  }
  return parsed
}

function assertArtifacts(manifest: TransferManifestV1, bytesById: ReadonlyMap<string, Uint8Array>): void {
  if (bytesById.size !== manifest.artifacts.length) throw new Error('Quantidade de artefatos diverge do manifesto.')
  for (const artifact of manifest.artifacts) {
    const bytes = bytesById.get(artifact.id)
    if (!bytes || bytes.byteLength !== artifact.sizeBytes) throw new Error(`Artefato ausente ou tamanho divergente: ${artifact.id}`)
    if (createHash('sha256').update(bytes).digest('hex') !== artifact.sha256) {
      throw new Error(`Hash divergente: ${artifact.id}`)
    }
  }
}

export function signPreparedPackage(
  manifest: TransferManifestV1,
  bytesById: ReadonlyMap<string, Uint8Array>,
  keyId: string,
  privateKey: KeyObject,
): TransferSignatureV1 {
  const valid = assertManifest(manifest)
  if (!keyId || privateKey.asymmetricKeyType !== 'ed25519' || privateKey.type !== 'private') {
    throw new Error('Chave de assinatura Ed25519 inválida.')
  }
  assertArtifacts(valid, bytesById)
  return { algorithm: 'Ed25519', keyId, valueBase64: signBytes(null, signedBytes(valid), privateKey).toString('base64') }
}

export function verifyPreparedPackage(args: {
  manifest: TransferManifestV1
  signature: TransferSignatureV1
  bytesById: ReadonlyMap<string, Uint8Array>
  expectedTenantId: string
  expectedSessionId: string
  expectedRevisionId?: string
  minimumRevisionNumber: number
  trustedKeys: ReadonlyMap<string, KeyObject>
}): TransferManifestV1 {
  const valid = assertManifest(args.manifest)
  if (valid.tenantId !== args.expectedTenantId || valid.sessionId !== args.expectedSessionId) {
    throw new Error('Pacote pertence a outra Câmara ou sessão.')
  }
  if (args.expectedRevisionId && valid.revisionId !== args.expectedRevisionId) {
    throw new Error('Pacote pertence a outra revisão.')
  }
  if (valid.revisionNumber < args.minimumRevisionNumber) throw new Error('Revisão antiga não pode substituir a preparada.')
  const trustedKey = args.trustedKeys.get(args.signature.keyId)
  if (args.signature.algorithm !== 'Ed25519' || !trustedKey || trustedKey.asymmetricKeyType !== 'ed25519' || trustedKey.type !== 'public') {
    throw new Error('Assinatura sem chave confiável.')
  }
  const signature = Buffer.from(args.signature.valueBase64, 'base64')
  if (signature.length !== 64 || !verifyBytes(null, signedBytes(valid), trustedKey, signature)) {
    throw new Error('Assinatura do manifesto inválida.')
  }
  assertArtifacts(valid, args.bytesById)
  return valid
}
