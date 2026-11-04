import { buildVersion } from '@/lib/build-version'

export const dynamic = 'force-dynamic'

export function GET() {
  return Response.json({ ok: true, service: 'edocbr-plenario', version: buildVersion() })
}
