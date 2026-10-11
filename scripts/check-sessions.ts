import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const ss = await db.session.findMany({ select: { number: true, status: true, scheduledAt: true, closedAt: true, updatedAt: true }, orderBy: { number: 'asc' } })
console.log(JSON.stringify(ss, null, 1))
await db.$disconnect()
