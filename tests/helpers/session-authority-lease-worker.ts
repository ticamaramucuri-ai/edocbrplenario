/** Child process used only by the PostgreSQL multi-process lease test. */
import { createPrivateKey } from 'node:crypto'
import { db } from '@/lib/db'
import { reserveSessionAuthorityLease } from '@/lib/server/session-authority-lease'

const raw = process.env.TEST_AUTHORITY_LEASE_ARGS
if (!raw) throw new Error('Argumentos de ensaio ausentes.')
const args = JSON.parse(raw) as {
  tenantId: string; sessionId: string; deviceId: string; revisionId: string
  manifestSha256: string; keyId: string; privateKeyPem: string; now: string
}
try {
  const result = await reserveSessionAuthorityLease({ ...args,
    privateKey: createPrivateKey(args.privateKeyPem), now: new Date(args.now),
    correlationId: crypto.randomUUID() })
  process.stdout.write(`AUTHORITY_GRANT:${JSON.stringify(result)}\n`)
} finally {
  await db.$disconnect()
}
