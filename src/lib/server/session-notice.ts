import { createHash } from 'crypto'

/** Cópia verificável da convocação emitida com uma revisão da pauta. */
export function createSessionNotice(input: {
  tenant: { id: string; slug: string; name: string; city: string; uf: string; timezone: string }
  session: { id: string; number: number; year: number; type: string; scheduledAt: Date; location: string; presidentName: string | null; secretaryName: string | null }
  revision: number
  issuedAt: Date
  agenda: unknown
  documents?: unknown
  policy: unknown
  justification?: string | null
  exceptionReason?: string | null
}) {
  const content = {
    schemaVersion: 1,
    kind: input.revision === 1 ? 'convocacao_inicial' : 'retificacao_convocacao',
    tenant: {
      id: input.tenant.id, slug: input.tenant.slug, name: input.tenant.name,
      city: input.tenant.city, uf: input.tenant.uf, timezone: input.tenant.timezone,
    },
    session: {
      id: input.session.id, number: input.session.number, year: input.session.year,
      type: input.session.type, scheduledAt: input.session.scheduledAt.toISOString(),
      location: input.session.location, presidentName: input.session.presidentName,
      secretaryName: input.session.secretaryName,
    },
    revision: input.revision,
    issuedAt: input.issuedAt.toISOString(),
    agenda: input.agenda,
    documents: input.documents ?? [],
    policy: input.policy,
    justification: input.justification ?? null,
    exceptionReason: input.exceptionReason ?? null,
  }
  const noticeJson = JSON.stringify(content)
  const noticeSha256 = createHash('sha256').update(noticeJson).digest('hex')
  return { noticeJson, noticeSha256 }
}
