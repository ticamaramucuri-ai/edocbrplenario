/** Idempotent synthetic tenant for the isolated PostgreSQL staging stack. */
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/server/session'

if (process.env.STAGING_SEED !== 'synthetic-only' || !/^postgres(ql)?:\/\//.test(process.env.DATABASE_URL ?? '')) {
  throw new Error('Seed de homologação exige STAGING_SEED=synthetic-only e PostgreSQL.')
}

const db = new PrismaClient()
try {
  const password = process.env.STAGE_ADMIN_PASSWORD
  if (!password || password.length < 20) throw new Error('STAGE_ADMIN_PASSWORD ausente ou curta.')
  const monitorPassword = process.env.STAGE_MONITOR_PASSWORD
  if (!monitorPassword || monitorPassword.length < 20 || monitorPassword === password) {
    throw new Error('STAGE_MONITOR_PASSWORD ausente, curta ou igual à senha da Câmara.')
  }
  const passwordHash = hashPassword(password)
  const monitorPasswordHash = hashPassword(monitorPassword)
  const tenant = await db.tenant.upsert({
    where: { slug: 'staging-example' },
    update: {},
    create: {
      slug: 'staging-example',
      name: 'Câmara Exemplo de Homologação',
      city: 'Cidade Exemplo',
      uf: 'BA',
      plan: 'profissional',
      settings: '{}',
    },
  })
  await db.user.upsert({
    where: { email: 'stage-admin@example.invalid' },
    update: { passwordHash, role: 'tenant_admin', tenantId: tenant.id },
    create: {
      tenantId: tenant.id,
      name: 'Operador de Homologação',
      email: 'stage-admin@example.invalid',
      role: 'tenant_admin',
      passwordHash,
    },
  })
  await db.user.upsert({
    where: { email: 'stage-platform-observer@example.invalid' },
    update: { passwordHash: monitorPasswordHash, role: 'platform_monitor', tenantId: null },
    create: {
      tenantId: null,
      name: 'Observador da Plataforma (Fictício)',
      email: 'stage-platform-observer@example.invalid',
      role: 'platform_monitor',
      passwordHash: monitorPasswordHash,
    },
  })
  console.log(JSON.stringify({ seeded: true, synthetic: true, slug: tenant.slug, id: tenant.id,
    adminEmail: 'stage-admin@example.invalid',
    observerEmail: 'stage-platform-observer@example.invalid' }))
} finally {
  await db.$disconnect()
}
