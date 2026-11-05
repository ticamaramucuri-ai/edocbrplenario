/** Importação idempotente de período, mandatos e Mesas a partir de fontes públicas oficiais. */
import { db } from '../src/lib/db'

// Posse dos 13 vereadores e eleição da Mesa: https://mucuri.ba.gov.br/posse-historica-robertinho-e-empossado-na-prefeitura-de-mucuri-pela-4a-vez/
// Mesa 2027–2028: https://camaramucuri.ba.gov.br/por-unanimidade-pamela-seixas-e-escolhida-para-presidir-a-camara-de-mucuri-no-bienio-2027-2028/
const currentBoard = [
  ['presidente', 'Hélio Alvarenga Penha'],
  ['vice_presidente', 'Carlos de Jesus Brito'],
  ['primeiro_secretario', 'Willian Crisma da Cruz'],
  ['segundo_secretario', 'Fernando Batista dos Santos'],
] as const
const electedBoard = [
  ['presidente', 'Pamela Honorato Bremer Seixas'],
  ['vice_presidente', 'Ademilson Ferreira Neves'],
  ['primeiro_secretario', 'Carlos de Jesus Brito'],
  ['segundo_secretario', 'Felipe Pereira Tigre'],
] as const

const mandateStart = new Date('2025-01-01T03:00:00.000Z') // 00h em America/Bahia
const mandateEnd = new Date('2028-12-31T23:59:59.000Z')
const currentStart = mandateStart
const currentEnd = new Date('2027-01-01T02:59:59.999Z') // 31/12/2026, 23h59 em Mucuri
const electedStart = new Date('2027-01-01T03:00:00.000Z')
const electedEnd = new Date('2029-01-01T02:59:59.999Z')

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL obrigatória.')
  const tenant = await db.tenant.findUniqueOrThrow({ where: { slug: 'camara-mucuri-ba' } })
  const people = await db.parliamentarian.findMany({ where: { tenantId: tenant.id, active: true } })
  if (people.length !== 13) throw new Error(`Esperados 13 vereadores ativos; encontrados ${people.length}.`)
  const byName = new Map(people.map((person) => [person.name, person]))
  if (byName.size !== 13) throw new Error('Nomes duplicados impedem vinculação segura.')
  for (const [, name] of [...currentBoard, ...electedBoard]) {
    if (!byName.has(name)) throw new Error(`Vereador não encontrado: ${name}`)
  }
  const legislatures = await db.legislature.findMany({ where: { tenantId: tenant.id } })
  const period = legislatures.find((item) => item.startYear === 2025 && item.endYear === 2028)
  if (legislatures.some((item) => item.current && item.id !== period?.id)) {
    throw new Error('Outra legislatura está marcada como atual; revisar manualmente.')
  }
  if (period && !period.current) throw new Error('Legislatura 2025–2028 existente não está marcada como atual.')
  if (!process.argv.includes('--apply')) {
    process.stdout.write(`Prévia: ${period ? 'legislatura existente' : 'criar legislatura 2025–2028 sem número ordinal'}, verificar/criar 13 mandatos e 8 cargos temporais da Mesa.\n`)
    return
  }
  await db.$transaction(async (tx) => {
    const legislature = period ?? await tx.legislature.create({ data: {
      tenantId: tenant.id, number: null, startYear: 2025, endYear: 2028, current: true,
    } })
    for (const person of people) {
      const existing = await tx.mandate.findUnique({ where: {
        parliamentarianId_legislatureId: { parliamentarianId: person.id, legislatureId: legislature.id },
      } })
      if (existing) {
        if (existing.startDate.getTime() !== mandateStart.getTime() || existing.endDate?.getTime() !== mandateEnd.getTime()) {
          throw new Error(`Mandato divergente: ${person.name}`)
        }
      } else {
        await tx.mandate.create({ data: { tenantId: tenant.id, legislatureId: legislature.id,
          parliamentarianId: person.id, startDate: mandateStart, endDate: mandateEnd } })
      }
    }
    for (const [board, startDate, endDate, status] of [
      [currentBoard, currentStart, currentEnd, 'confirmed'], [electedBoard, electedStart, electedEnd, 'elected'],
    ] as const) {
      for (const [role, name] of board) {
        const person = byName.get(name)!
        const existing = await tx.boardPosition.findFirst({ where: {
          tenantId: tenant.id, legislatureId: legislature.id, role, startDate,
        } })
        if (existing) {
          if (existing.parliamentarianId !== person.id || existing.endDate?.getTime() !== endDate.getTime()) {
            throw new Error(`Mesa divergente: ${role} a partir de ${startDate.toISOString()}`)
          }
          if (existing.status !== status) {
            if (status !== 'elected' || existing.status !== 'confirmed') throw new Error(`Estado divergente da Mesa: ${role}`)
            await tx.boardPosition.update({ where: { id: existing.id }, data: { status: 'elected' } })
          }
        } else {
          await tx.boardPosition.create({ data: { tenantId: tenant.id, legislatureId: legislature.id,
            role, parliamentarianId: person.id, startDate, endDate, status } })
        }
      }
    }
  })
  process.stdout.write('Legislatura 2025–2028, 13 mandatos e duas composições temporais da Mesa conferidas/aplicadas. Número ordinal segue pendente.\n')
}

try { await main() } finally { await db.$disconnect() }
