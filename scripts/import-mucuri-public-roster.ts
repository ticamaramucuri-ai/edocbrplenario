/** Importa somente dados públicos verificados; não aprova configuração oficial nem cria usuários. */
import { db } from '../src/lib/db'

const roster = [
  ['Hélio Alvarenga Penha', 'Dr. Hélio da Fisioterapia', 'PSDB', 'presidente'],
  ['Carlos de Jesus Brito', 'Carlinhos da Ótica', 'PSB', 'vice_presidente'],
  ['Willian Crisma da Cruz', 'Willian Crisma', 'PODEMOS', 'primeiro_secretario'],
  ['Fernando Batista dos Santos', 'Fernando da Gazzinelli', 'REPUBLICANOS', 'segundo_secretario'],
  ['Ademilson Ferreira Neves', 'Dema', 'PP', 'vereador'],
  ['Douglas Souto Buchacra', 'Dodô', 'REPUBLICANOS', 'vereador'],
  ['Ediney Alves de Oliveira', 'Diney Drinks', 'PP', 'vereador'],
  ['Edison Silva de Mattos', 'Sula Policial', 'PODEMOS', 'vereador'],
  ['Felipe Pereira Tigre', 'Felipe do Ônibus', 'PSD', 'vereador'],
  ['Geneval Pereira Miranda', 'Valzinho Embalador', 'UNIÃO', 'vereador'],
  ['Pamela Honorato Bremer Seixas', 'Pamela Seixas', 'PODEMOS', 'vereador'],
  ['Paulo Gomes Mota', 'Paulo do Carvão', 'PSB', 'vereador'],
  ['Roberto Silva dos Santos Junior', 'Roberto Júnior', 'UNIÃO', 'vereador'],
] as const

const partyNames: Record<string, string> = {
  PSDB: 'PSDB', PSB: 'PSB', PODEMOS: 'Podemos', REPUBLICANOS: 'Republicanos',
  PP: 'PP', PSD: 'PSD', UNIÃO: 'União Brasil',
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL obrigatória.')
  const tenant = await db.tenant.findUnique({ where: { slug: 'camara-mucuri-ba' } })
  if (!tenant) throw new Error('Câmara de Mucuri ainda não cadastrada.')
  const current = await db.parliamentarian.findMany({ where: { tenantId: tenant.id } })
  const byName = new Map(current.map((person) => [person.name, person]))
  if (byName.size !== current.length) throw new Error('Há nomes duplicados na base; revisar antes de importar.')
  for (const [name, displayName, party, boardRole] of roster) {
    const existing = byName.get(name)
    if (existing && (existing.displayName !== displayName || existing.party !== party || existing.boardRole !== boardRole)) {
      throw new Error(`Cadastro divergente para ${name}; nenhuma alteração automática permitida.`)
    }
  }
  const missing = roster.filter(([name]) => !byName.has(name))
  const existingParties = await db.party.findMany({ where: { tenantId: tenant.id } })
  const partySet = new Set(existingParties.map((party) => party.acronym))
  const missingParties = Object.keys(partyNames).filter((acronym) => !partySet.has(acronym))
  if (!process.argv.includes('--apply')) {
    process.stdout.write(`Prévia: ${missingParties.length} partidos e ${missing.length} vereadores a cadastrar; ${current.length} vereadores já presentes. Use --apply para confirmar.\n`)
    return
  }
  await db.$transaction(async (tx) => {
    for (const acronym of missingParties) {
      await tx.party.create({ data: { tenantId: tenant.id, acronym, name: partyNames[acronym] } })
    }
    const lastOrder = current.reduce((max, person) => Math.max(max, person.order), -1)
    for (const [index, [name, displayName, party, boardRole]] of missing.entries()) {
      await tx.parliamentarian.create({ data: {
        tenantId: tenant.id, name, displayName, party, boardRole,
        order: lastOrder + index + 1, active: true,
      } })
    }
  })
  process.stdout.write(`Aplicado: ${missingParties.length} partidos e ${missing.length} vereadores. Legislatura, mandatos, Mesa com datas, usuários e sessões não foram criados.\n`)
}

try { await main() } finally { await db.$disconnect() }
