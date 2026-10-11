import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const carla = await db.parliamentarian.findFirst({ where: { name: 'Carla Mendes' }, select: { id: true } })
const sig = await db.documentSignature.findFirst({ where: { signatoryParliamentarianId: carla!.id } })
if (sig) { await db.documentSignature.delete({ where: { id: sig.id } }); console.log('deleted', sig.signatureCode) } else console.log('none')
await db.$disconnect()
