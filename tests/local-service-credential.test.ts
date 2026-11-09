import { afterAll, expect, test } from 'bun:test'
import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readLocalServiceCredential } from '@/lib/local-service-credential'

const root = await mkdtemp(join(tmpdir(), 'edocbr-local-credential-'))
afterAll(async () => { await rm(root, { recursive: true, force: true }) })

test('credencial do serviço Linux exige arquivo privado, regular e sem redirecionamento', async () => {
  if (process.platform !== 'linux') return
  const secret = 'frase-sintética-local-com-mais-de-vinte-caracteres'
  const path = join(root, 'secret')
  await writeFile(path, `${secret}\n`, { mode: 0o600 })
  expect(await readLocalServiceCredential(path)).toBe(secret)
  await chmod(path, 0o644)
  await expect(readLocalServiceCredential(path)).rejects.toThrow('inseguro')
  await chmod(path, 0o600)
  const alias = join(root, 'alias')
  await symlink(path, alias)
  await expect(readLocalServiceCredential(alias)).rejects.toThrow('redirecionado')
  await writeFile(path, 'curta', { mode: 0o600 })
  await expect(readLocalServiceCredential(path)).rejects.toThrow('inválida')
  await expect(readLocalServiceCredential('secret')).rejects.toThrow('inválido')
})
