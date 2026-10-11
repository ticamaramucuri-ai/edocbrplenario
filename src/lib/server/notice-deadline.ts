import type { TenantSettings } from '@/lib/contracts'

export type NoticeDeadlineSession = {
  status: string
  agendaPublished: boolean
  scheduledAt: Date
}

/** Prazo calculado a partir do estado atual; sessão sem pauta publicada ainda exige convocação inicial. */
export function noticeDeadline(session: NoticeDeadlineSession, policy: TenantSettings) {
  const phase = !session.agendaPublished ? 'initial' as const : 'amendment' as const
  const minimumHours = phase === 'initial' ? policy.minimumNoticeHours : policy.minimumAmendmentHours
  return { phase, minimumHours,
    deadlineAt: new Date(session.scheduledAt.getTime() - minimumHours * 60 * 60 * 1000) }
}
