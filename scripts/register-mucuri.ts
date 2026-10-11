/** Cadastro mínimo e idempotente da Câmara real; não cria usuários nem fatos legislativos. */
import { db } from '../src/lib/db'

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL obrigatória.')

try {
  const slug = 'camara-mucuri-ba'
  const existing = await db.tenant.findUnique({ where: { slug } })
  if (existing) {
    process.stdout.write(`Câmara já cadastrada: ${existing.id}. Nenhuma alteração aplicada.\n`)
  } else {
    const tenant = await db.tenant.create({
      data: {
        slug,
        name: 'Câmara Municipal de Mucuri',
        city: 'Mucuri',
        uf: 'BA',
        plan: 'piloto',
        primaryColor: '#062f63',
        accentColor: '#d9a441',
        logoUrl: '/brand/camara-mucuri-brasao.png',
        timezone: 'America/Bahia',
        settings: '{}',
      },
    })
    process.stdout.write(`Câmara cadastrada: ${tenant.id} (${tenant.slug}). Sem usuários, legislatura, sessões ou assinatura.\n`)
  }
} finally {
  await db.$disconnect()
}
