/** Consultas de negócio somente leitura na réplica PostgreSQL restaurada. */
export {}
const modulePath = process.env.POSTGRES_TEST_CLIENT
if (!modulePath) throw new Error('POSTGRES_TEST_CLIENT não configurado')
const { PrismaClient } = await import(modulePath)
const db = new PrismaClient()

try {
  const tenants = await db.tenant.findMany({ select: { id: true }, orderBy: { id: 'asc' } })
  if (!tenants.length) throw new Error('nenhuma Câmara restaurada')
  let sessionsRead = 0
  let mattersRead = 0
  let votingsRead = 0
  let votesRead = 0
  for (const tenant of tenants) {
    const [sessions, matters, votings] = await Promise.all([
      db.session.findMany({ where: { tenantId: tenant.id },
        include: { agendaItems: true, transmission: true, recording: true } }),
      db.legislativeMatter.findMany({ where: { tenantId: tenant.id }, include: { attachments: true } }),
      db.voting.findMany({ where: { session: { tenantId: tenant.id } },
        include: { session: { select: { tenantId: true } },
          matter: { select: { tenantId: true } },
          votes: { include: { parliamentarian: { select: { tenantId: true } } } } } }),
    ])
    if (sessions.some((session: { tenantId: string }) => session.tenantId !== tenant.id))
      throw new Error('sessão cruzou Câmara')
    if (matters.some((matter: { tenantId: string }) => matter.tenantId !== tenant.id))
      throw new Error('matéria cruzou Câmara')
    for (const voting of votings) {
      if (voting.session.tenantId !== tenant.id || (voting.matter && voting.matter.tenantId !== tenant.id))
        throw new Error('votação cruzou Câmara')
      if (voting.votes.some((vote: { parliamentarian: { tenantId: string } }) => vote.parliamentarian.tenantId !== tenant.id))
        throw new Error('voto cruzou Câmara')
      votesRead += voting.votes.length
    }
    sessionsRead += sessions.length
    mattersRead += matters.length
    votingsRead += votings.length
  }
  const [sessionsTotal, mattersTotal, votingsTotal, votesTotal] = await Promise.all([
    db.session.count(), db.legislativeMatter.count(), db.voting.count(), db.vote.count(),
  ])
  if (sessionsRead !== sessionsTotal || mattersRead !== mattersTotal ||
      votingsRead !== votingsTotal || votesRead !== votesTotal)
    throw new Error('leituras por Câmara divergiram das contagens globais')
  console.log(`Réplica restaurada: ${tenants.length} Câmaras, ${sessionsRead} sessões, ${mattersRead} matérias, ${votingsRead} votações e ${votesRead} votos lidos com isolamento.`)
} finally {
  await db.$disconnect()
}
