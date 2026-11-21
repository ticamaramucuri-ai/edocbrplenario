/**
 * Domínio de Publicações Oficiais e Audiências Públicas (Fase 11).
 *
 * Máquinas de estado:
 * - Publication: draft → published → revoked (revogada NUNCA volta;
 *   draft editável; published imutável exceto revogar).
 * - PublicHearing: scheduled → open → closed; scheduled|open → canceled
 *   (com justificativa); canceled é terminal.
 * - HearingQuestion: pending → approved | rejected (terminais);
 *   approved → answered (com texto de resposta); rejected/answered terminais.
 *
 * Views públicas NUNCA incluem authorEmail (uso interno legitimado apenas).
 */
import { createHash, randomInt } from 'crypto'
import type { HearingQuestion, Publication, PublicHearing } from '@prisma/client'
import { DomainError } from './errors'

// ─── Publicações ────────────────────────────────────────────────────────────

export const PUBLICATION_KINDS = [
  'ata_sessao',
  'decreto',
  'resolucao',
  'portaria',
  'edital',
  'ata',
] as const
export type PublicationKind = (typeof PUBLICATION_KINDS)[number]

export const PUBLICATION_KIND_LABEL: Record<PublicationKind, string> = {
  ata_sessao: 'Ata de Sessão',
  decreto: 'Decreto',
  resolucao: 'Resolução',
  portaria: 'Portaria',
  edital: 'Edital',
  ata: 'Ata',
}

export const PUBLICATION_STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho',
  published: 'Publicada',
  revoked: 'Revogada',
}

/** draft → published → revoked (revogada é terminal e nunca volta). */
export const PUBLICATION_TRANSITIONS: Record<string, string[]> = {
  draft: ['published'],
  published: ['revoked'],
  revoked: [],
}

export function assertPublicationTransition(from: string, to: string): void {
  if (!PUBLICATION_TRANSITIONS[from]?.includes(to)) {
    throw new DomainError(
      'PUBLICATION_INVALID_TRANSITION',
      409,
      'Transição inválida',
      `Publicação em situação "${PUBLICATION_STATUS_LABEL[from] ?? from}" não pode ir para "${PUBLICATION_STATUS_LABEL[to] ?? to}". Rascunho → Publicada → Revogada (a revogação é definitiva).`
    )
  }
}

/** Rótulo público do número: 0001/2026. */
export function publicationNumberLabel(number: number, year: number): string {
  return `${String(number).padStart(4, '0')}/${year}`
}

/** Código de verificação público: 8 caracteres [A-Z0-9] (crypto, sem viés). */
export function generateVerificationCode(length = 8): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let code = ''
  for (let i = 0; i < length; i++) code += alphabet[randomInt(alphabet.length)]
  return code
}

/** Versão revisada inclui título, texto e vínculo da sessão, em ordem fixa. */
export function publicationReviewHash(p: Pick<Publication, 'title' | 'contentMd' | 'sessionId'>): string {
  return createHash('sha256').update(JSON.stringify([p.title, p.contentMd, p.sessionId]), 'utf8').digest('hex')
}

/** View interna (lista) — SEM contentMd (detalhe usa toPublicationDetailView). */
export function toPublicationView(p: Publication) {
  return {
    id: p.id,
    number: p.number,
    year: p.year,
    numberLabel: publicationNumberLabel(p.number, p.year),
    kind: p.kind,
    kindLabel: PUBLICATION_KIND_LABEL[p.kind as PublicationKind] ?? p.kind,
    title: p.title,
    status: p.status,
    statusLabel: PUBLICATION_STATUS_LABEL[p.status] ?? p.status,
    sessionId: p.sessionId ?? null,
    matterId: p.matterId ?? null,
    publishedAt: p.publishedAt?.toISOString() ?? null,
    revokedAt: p.revokedAt?.toISOString() ?? null,
    revokedReason: p.revokedReason ?? null,
    verificationCode: p.verificationCode || null,
    reviewHash: p.reviewHash ?? null,
    reviewedByName: p.reviewedByName ?? null,
    reviewedAt: p.reviewedAt?.toISOString() ?? null,
    publishedContentSha256: p.publishedContentSha256 ?? null,
    rectifiesPublicationId: p.rectifiesPublicationId ?? null,
    createdAt: p.createdAt.toISOString(),
  }
}

/** View interna de detalhe — inclui o texto integral (contentMd). */
export function toPublicationDetailView(p: Publication) {
  return { ...toPublicationView(p), contentMd: p.contentMd, reviewReference: p.reviewReference ?? null,
    currentReviewHash: publicationReviewHash(p) }
}

/** View pública de LISTA — sem contentMd e sem código de verificação. */
export function toPublicPublicationListView(p: Publication) {
  return {
    id: p.id,
    number: p.number,
    year: p.year,
    numberLabel: publicationNumberLabel(p.number, p.year),
    kind: p.kind,
    kindLabel: PUBLICATION_KIND_LABEL[p.kind as PublicationKind] ?? p.kind,
    title: p.title,
    status: p.status,
    statusLabel: PUBLICATION_STATUS_LABEL[p.status] ?? p.status,
    publishedAt: p.publishedAt?.toISOString() ?? null,
    revokedAt: p.revokedAt?.toISOString() ?? null,
    rectifiesPublicationId: p.rectifiesPublicationId ?? null,
  }
}

/** View pública de DETALHE — contentMd + código de verificação + motivo. */
export function toPublicPublicationDetailView(p: Publication) {
  return {
    ...toPublicPublicationListView(p),
    contentMd: p.contentMd,
    verificationCode: p.verificationCode || null,
    revokedReason: p.revokedReason ?? null,
    createdAt: p.createdAt.toISOString(),
    sessionId: p.sessionId ?? null,
    publishedContentSha256: p.publishedContentSha256 ?? null,
  }
}

// ─── Audiências públicas ────────────────────────────────────────────────────

export const HEARING_STATUS_LABEL: Record<string, string> = {
  scheduled: 'Agendada',
  open: 'Aberta',
  closed: 'Encerrada',
  canceled: 'Cancelada',
}

/** scheduled → open → closed; scheduled|open → canceled (terminal). */
export const HEARING_TRANSITIONS: Record<string, string[]> = {
  scheduled: ['open', 'canceled'],
  open: ['closed', 'canceled'],
  closed: [],
  canceled: [],
}

export function assertHearingTransition(from: string, to: string): void {
  if (!HEARING_TRANSITIONS[from]?.includes(to)) {
    throw new DomainError(
      'HEARING_INVALID_TRANSITION',
      409,
      'Transição inválida',
      `Audiência em situação "${HEARING_STATUS_LABEL[from] ?? from}" não pode ir para "${HEARING_STATUS_LABEL[to] ?? to}". Ciclo: Agendada → Aberta → Encerrada; Agendada/Aberta → Cancelada (terminal).`
    )
  }
}

export type HearingQuestionCounts = {
  pending: number
  approved: number
  rejected: number
  answered: number
}

export function emptyQuestionCounts(): HearingQuestionCounts {
  return { pending: 0, approved: 0, rejected: 0, answered: 0 }
}

/** Agrega contagens por status a partir das perguntas (em memória). */
export function aggregateQuestionCounts(questions: Array<{ status: string }>): HearingQuestionCounts {
  const counts = emptyQuestionCounts()
  for (const q of questions) {
    if (q.status in counts) counts[q.status as keyof HearingQuestionCounts] += 1
  }
  return counts
}

/** View interna de audiência (com contagens agregadas de perguntas). */
export function toHearingView(h: PublicHearing, counts: HearingQuestionCounts) {
  return {
    id: h.id,
    title: h.title,
    subject: h.subject,
    matterId: h.matterId ?? null,
    scheduledAt: h.scheduledAt.toISOString(),
    location: h.location ?? null,
    status: h.status,
    statusLabel: HEARING_STATUS_LABEL[h.status] ?? h.status,
    questionsOpen: h.questionsOpen,
    questions: counts,
    createdAt: h.createdAt.toISOString(),
  }
}

/** View pública de audiência (sem contagens internas de moderação). */
export function toPublicHearingView(h: PublicHearing, answeredCount: number) {
  return {
    id: h.id,
    title: h.title,
    subject: h.subject,
    matterId: h.matterId ?? null,
    scheduledAt: h.scheduledAt.toISOString(),
    location: h.location ?? null,
    status: h.status,
    statusLabel: HEARING_STATUS_LABEL[h.status] ?? h.status,
    questionsOpen: h.questionsOpen,
    answeredCount,
  }
}

// ─── Perguntas do cidadão ───────────────────────────────────────────────────

export const HEARING_QUESTION_STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  approved: 'Aprovada',
  rejected: 'Rejeitada',
  answered: 'Respondida',
}

/** pending → approved | rejected; approved → answered. Terminais não saem. */
export function assertQuestionTransition(from: string, to: string): void {
  const allowed: Record<string, string[]> = {
    pending: ['approved', 'rejected'],
    approved: ['answered'],
    rejected: [],
    answered: [],
  }
  if (!allowed[from]?.includes(to)) {
    throw new DomainError(
      'HEARING_INVALID_TRANSITION',
      409,
      'Transição inválida',
      `Pergunta em situação "${HEARING_QUESTION_STATUS_LABEL[from] ?? from}" não pode ir para "${HEARING_QUESTION_STATUS_LABEL[to] ?? to}".`
    )
  }
}

/** View INTERNA de pergunta (moderação) — inclui authorEmail (uso legitimado). */
export function toHearingQuestionView(q: HearingQuestion) {
  return {
    id: q.id,
    hearingId: q.hearingId,
    authorName: q.authorName,
    authorEmail: q.authorEmail ?? null,
    district: q.district ?? null,
    question: q.question,
    status: q.status,
    statusLabel: HEARING_QUESTION_STATUS_LABEL[q.status] ?? q.status,
    answer: q.answer ?? null,
    moderatedBy: q.moderatedBy ?? null,
    answeredAt: q.answeredAt?.toISOString() ?? null,
    createdAt: q.createdAt.toISOString(),
  }
}

/** View PÚBLICA de pergunta — authorEmail NUNCA é exposto. */
export function toPublicHearingQuestionView(q: HearingQuestion) {
  return {
    id: q.id,
    hearingId: q.hearingId,
    authorName: q.authorName,
    district: q.district ?? null,
    question: q.question,
    status: q.status,
    statusLabel: HEARING_QUESTION_STATUS_LABEL[q.status] ?? q.status,
    answer: q.answer ?? null,
    answeredAt: q.answeredAt?.toISOString() ?? null,
    createdAt: q.createdAt.toISOString(),
  }
}
