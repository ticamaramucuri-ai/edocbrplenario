import { expect, test } from 'bun:test'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { enrollLocalDevice, initializeLocalDevice, trustLocalTransferKey } from '@/lib/local-device-keystore'

test('app local abre pré-voo somente em loopback e encerra sem janela', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'edocbr-local-app-'))
  const root = join(parent, 'device')
  const passphrase = 'frase sintética exclusiva para app local'
  let child: ReturnType<typeof Bun.spawn> | undefined
  try {
    await initializeLocalDevice({ root, tenantId: 'camara-a', baseUrl: 'https://example.invalid', passphrase })
    await enrollLocalDevice(root, 'mesa-1')
    const signing = generateKeyPairSync('ed25519')
    const publicKeyPem = signing.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const expectedSpkiSha256 = createHash('sha256').update(signing.publicKey.export({ type: 'spki', format: 'der' }) as Buffer).digest('hex')
    await trustLocalTransferKey({ root, keyId: 'k-test', publicKeyPem, expectedSpkiSha256 })
    const credential = join(parent, 'credential')
    await writeFile(credential, passphrase, { mode: 0o600 })
    child = Bun.spawn(['bun', 'scripts/local-app.ts', root, credential, '0'],
      { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' })
    const stdout = child.stdout
    if (!(stdout instanceof ReadableStream)) throw new Error('Saída do app local não disponível.')
    const reader = stdout.getReader()
    const first = await Promise.race([reader.read(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('App não iniciou.')), 10_000))])
    const started = JSON.parse(new TextDecoder().decode(first.value))
    expect(started.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(started.mode).toBe('read_only')
    const response = await fetch(`${started.url}/api/status`)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ tenantId: 'camara-a', deviceId: 'mesa-1', sessions: [] })
    expect((await fetch(`${started.url}/`, { method: 'POST' })).status).toBe(405)
  } finally {
    child?.kill('SIGTERM')
    if (child) await child.exited
    await rm(parent, { recursive: true, force: true })
  }
})
