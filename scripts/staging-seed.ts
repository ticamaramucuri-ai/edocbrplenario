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
    update: {},
    create: {
      tenantId: tenant.id,
      name: 'Operador de Homologação',
      email: 'stage-admin@example.invalid',
      role: 'tenant_admin',
      passwordHash: hashPassword(password),
    },
  })
  console.log(JSON.stringify({ seeded: true, synthetic: true, slug: tenant.slug, id: tenant.id,
    adminEmail: 'stage-admin@example.invalid' }))
} finally {
  await db.$disconnect()
}
