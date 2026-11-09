import { expect, test } from 'bun:test'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadLocalDevice } from '@/lib/local-device-keystore'

test('CLI inicializa, vincula e confia sem expor segredo na saída', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'edocbr-local-cli-'))
  const root = join(parent, 'desktop')
  const passphrase = 'frase sintética exclusiva para ensaio 2026'
  const run = (args: string[], input = '') => Bun.spawnSync(['bun', 'scripts/local-server.ts', ...args],
    { stdin: Buffer.from(input), cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' })
  try {
    const initialized = run(['init', root, 'camara-a', 'https://example.invalid'], `${passphrase}\n`)
    expect(initialized.exitCode).toBe(0)
    const output = new TextDecoder().decode(initialized.stdout)
    expect(output).not.toContain(passphrase)
    const identity = JSON.parse(output)
    expect(identity.publicKeyPem).toContain('BEGIN PUBLIC KEY')
    const enrolled = run(['enroll', root, 'device-1'])
    expect(enrolled.exitCode).toBe(0)
    expect(JSON.parse(new TextDecoder().decode(enrolled.stdout)).deviceId).toBe('device-1')
    const signing = generateKeyPairSync('ed25519')
    const pem = signing.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const fingerprint = createHash('sha256').update(signing.publicKey.export({ type: 'spki', format: 'der' }) as Buffer).digest('hex')
    const pemPath = join(parent, 'camara.pem')
    await writeFile(pemPath, pem)
    const untrusted = run(['trust', root, 'k-test', pemPath, '0'.repeat(64)])
    expect(untrusted.exitCode).toBe(1)
    const trusted = run(['trust', root, 'k-test', pemPath, fingerprint])
    expect(trusted.exitCode).toBe(0)
    expect((await loadLocalDevice({ root, passphrase })).trustedKeys.has('k-test')).toBe(true)
    if (process.platform === 'linux') {
      const credentialPath = join(parent, 'local-service-credential')
      await writeFile(credentialPath, passphrase, { mode: 0o600 })
      const service = Bun.spawn(['bun', 'scripts/local-server.ts', 'run-credential', root,
        credentialPath, '30'], { cwd: process.cwd(), stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
      await new Promise((resolveWait) => setTimeout(resolveWait, 1500))
      service.kill('SIGTERM')
      expect(await service.exited).toBe(0)
      const stderr = await new Response(service.stderr).text()
      expect(stderr).not.toContain(passphrase)
    }
  } finally { await rm(parent, { recursive: true, force: true }) }
})
