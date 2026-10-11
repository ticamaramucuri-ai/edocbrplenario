import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()
const tenants = await db.tenant.findMany({ select: { id: true, name: true, slug: true, active: true, trialEndsAt: true, createdAt: true } })
console.log('TENANTS:', JSON.stringify(tenants, null, 1))
const onb = await db.onboardingRequest.findMany({ select: { chamberName: true, slug: true, status: true } })
console.log('ONBOARDING:', JSON.stringify(onb, null, 1))
await db.$disconnect()
