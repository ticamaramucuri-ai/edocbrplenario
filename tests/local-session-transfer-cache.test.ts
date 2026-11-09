import { afterAll, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cacheTransferArtifact, clearTransferCache, pruneTransferCache, readCachedTransferArtifact } from '@/lib/local-session-transfer-cache'

const root = await mkdtemp(join(tmpdir(), 'edocbr-partial-cache-'))
afterAll(async () => { await rm(root, { recursive: true, force: true }) })
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')

test('cache parcial aceita só bytes íntegros da emissão e nunca marca a revisão preparada', async () => {
  const bytes = Buffer.from('artefato de ensaio')
  const artifact = { id: 'matter-attachment:one', sha256: sha256(bytes), sizeBytes: bytes.length }
  const args = { root, tenantId: 'camara-a', sessionId: 'sessao-a', manifestSha256: sha256('manifesto'), artifact }
  expect(await readCachedTransferArtifact(args)).toBeNull()
  await expect(cacheTransferArtifact({ ...args, bytes: Buffer.from('bytes falsos') })).rejects.toThrow('diverge')
  await cacheTransferArtifact({ ...args, bytes })
  expect(Buffer.from((await readCachedTransferArtifact(args))!)).toEqual(bytes)
  expect(await readCachedTransferArtifact({ ...args, tenantId: 'camara-b' })).toBeNull()
  expect(await readCachedTransferArtifact({ ...args, manifestSha256: sha256('revisao-nova') })).toBeNull()
  const directory = join(root, 'tenants', sha256('camara-a'), 'sessions', sha256('sessao-a'),
    'partial', args.manifestSha256)
  const path = join(directory, sha256(artifact.id) + '.bin')
  expect((await readdir(directory)).filter((name) => !name.startsWith('.'))).toHaveLength(1)
  await writeFile(path, 'alterado')
  expect(await readCachedTransferArtifact(args)).toBeNull()
  await rm(path)
  await symlink(join(root, 'secret'), path)
  await expect(readCachedTransferArtifact(args)).rejects.toThrow()
  await rm(path)
  await cacheTransferArtifact({ ...args, bytes })
  expect(await readFile(path)).toEqual(bytes)
  await clearTransferCache({ root, tenantId: 'camara-a', sessionId: 'sessao-a' })
  expect(await readCachedTransferArtifact(args)).toBeNull()
})

test('limpeza preserva a revisão corrente e dois caches recentes, isolada por Câmara', async () => {
  const bytes = Buffer.from('conteúdo')
  const artifact = { id: 'one', sha256: sha256(bytes), sizeBytes: bytes.length }
  const current = sha256('current')
  const tenantId = 'camara-cache'
  const sessionId = 'sessao-cache'
  const now = new Date('2026-11-09T12:00:00Z')
  const base = { root, tenantId, sessionId, artifact }
  const manifests = ['old', 'recent-one', 'recent-two', 'recent-three', 'current'].map(sha256)
  for (const manifestSha256 of manifests) {
    await cacheTransferArtifact({ ...base, manifestSha256, bytes })
    const directory = join(root, 'tenants', sha256(tenantId), 'sessions', sha256(sessionId), 'partial', manifestSha256)
    const offset = manifests.indexOf(manifestSha256) === 0 ? 8 : 1
    const age = new Date(now.getTime() - offset * 86400_000 + manifests.indexOf(manifestSha256) * 1000)
    await utimes(directory, age, age)
  }
  await cacheTransferArtifact({ ...base, tenantId: 'outra-camara', manifestSha256: manifests[0], bytes })
  expect(await pruneTransferCache({ root, tenantId, sessionId, keepManifestSha256: current, now })).toBe(2)
  expect(await readCachedTransferArtifact({ ...base, manifestSha256: current })).not.toBeNull()
  expect(await readCachedTransferArtifact({ ...base, manifestSha256: manifests[0] })).toBeNull()
  expect(await readCachedTransferArtifact({ ...base, manifestSha256: manifests[1] })).toBeNull()
  expect(await readCachedTransferArtifact({ ...base, manifestSha256: manifests[2] })).not.toBeNull()
  expect(await readCachedTransferArtifact({ ...base, manifestSha256: manifests[3] })).not.toBeNull()
  expect(await readCachedTransferArtifact({ ...base, tenantId: 'outra-camara', manifestSha256: manifests[0] })).not.toBeNull()
})
