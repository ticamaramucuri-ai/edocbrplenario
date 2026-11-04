import { buildVersion } from '@/lib/build-version'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

let readiness: Promise<boolean> | null = null

function databaseReady(): Promise<boolean> {
  if (readiness) return readiness
  readiness = Promise.race([
    db.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3_000)),
  ]).finally(() => { readiness = null })
  return readiness
}

export async function GET(req: Request) {
  const ready = new URL(req.url).searchParams.get('ready') === '1'
  const ok = ready ? await databaseReady() : true
  return Response.json({ ok, service: 'edocbr-plenario', version: buildVersion(),
    ...(ready ? { database: ok ? 'ready' : 'unavailable' } : {}) },
  { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } })
}
