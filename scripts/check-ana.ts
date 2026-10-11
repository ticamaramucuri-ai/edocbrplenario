import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const ana = await db.user.findFirst({ where: { email: 'ana.ribeiro@vilanova.mg.leg.br' }, select: { id: true } })
const owner = await db.user.findFirst({ where: { email: 'suporte@legissaas.dev' }, select: { id: true } })
console.log(JSON.stringify({ ana: ana?.id, owner: owner?.id }))
await db.$disconnect()
