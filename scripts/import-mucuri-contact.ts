/** Contatos publicados em https://camaramucuri.ba.gov.br/; não altera regras ou usuários. */
import { db } from '../src/lib/db'

const contact = {
  contactAddress: 'Rua Oscar Teixeira de Siqueira, nº 290, Bairro Malvinas',
  contactPostalCode: '45.930-000',
  contactGeneralPhone: '(73) 3206-1077',
  contactAlternatePhone: '(73) 99827-1105',
  contactOmbudsmanPhone: '(73) 99926-5271',
  contactGeneralEmail: 'camara@camaramucuri.ba.gov.br',
  contactProtocolEmail: 'protocolo@camaramucuri.ba.gov.br',
  contactOmbudsmanEmail: 'ouvidoria@camaramucuri.ba.gov.br',
  contactWebsiteUrl: 'https://camaramucuri.ba.gov.br/',
  contactServiceHours: 'Segunda a sexta-feira, 07h às 13h (exceto feriados e pontos facultativos)',
  contactSessionHours: 'Terça-feira, 09h (horário habitual)',
} as const

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL obrigatória.')
  const tenant = await db.tenant.findUniqueOrThrow({ where: { slug: 'camara-mucuri-ba' } })
  const pending: Partial<typeof contact> = {}
  for (const key of Object.keys(contact) as Array<keyof typeof contact>) {
    const current = tenant[key]
    if (current && current !== contact[key]) throw new Error(`Contato já preenchido de forma diferente: ${key}. Revisar manualmente.`)
    if (!current) Object.assign(pending, { [key]: contact[key] })
  }
  const count = Object.keys(pending).length
  if (!process.argv.includes('--apply')) {
    process.stdout.write(`Prévia: ${count} de ${Object.keys(contact).length} campos de contato a preencher em Mucuri.\n`)
    return
  }
  if (count) await db.tenant.update({ where: { id: tenant.id }, data: pending })
  process.stdout.write(`Aplicado: ${count} campo(s) de contato. Nenhum usuário, regra regimental ou sessão alterada.\n`)
}

try { await main() } finally { await db.$disconnect() }
