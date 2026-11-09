import { afterAll, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cacheTransferArtifact, clearTransferCache, readCachedTransferArtifact } from '@/lib/local-session-transfer-cache'

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
