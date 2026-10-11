/**
 * Serializador local dos ScheduledJob (Onda 5 / Fase 21 — ROADMAP §12.1).
 * Módulo privado da pasta `schedules/` (não é rota): mantém o shape
 * `ScheduledJobView` de src/lib/contracts.ts com datas ISO string.
 */
import type { ScheduledJob } from '@prisma/client'
import type { ScheduledJobKind, ScheduledJobView } from '@/lib/contracts'

export function toScheduledJobView(job: ScheduledJob): ScheduledJobView {
  return {
    id: job.id,
    kind: job.kind as ScheduledJobKind,
    title: job.title,
    everySeconds: job.everySeconds,
    lastRunAt: job.lastRunAt ? job.lastRunAt.toISOString() : null,
    nextRunAt: job.nextRunAt.toISOString(),
    lastStatus: job.lastStatus ?? null,
    lastNote: job.lastNote ?? null,
    active: job.active,
    updatedBy: job.updatedBy ?? null,
    updatedAt: job.updatedAt ? job.updatedAt.toISOString() : null,
  }
}
