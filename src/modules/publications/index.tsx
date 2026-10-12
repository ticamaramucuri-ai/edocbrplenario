'use client'

/**
 * Módulo Publicações e Audiências (Fase 11) — diário eletrônico numerado
 * (atas, decretos, resoluções, portarias, editais) com revogação auditada e
 * audiências públicas com perguntas do cidadão moderadas.
 *
 * Tabs:
 *  - Publicações: filtro status/tipo/ano + busca; tabela com ações
 *    (publicar, revogar com motivo, editar rascunho, ver com código de
 *    verificação); dialog de criação com vínculos de sessão/matéria e
 *    "criar a partir de modelo" (Fase 14 — render no servidor);
 *  - Audiências: tabela com status, contagem de pendências e Switch de
 *    recebimento de perguntas; ações abrir/encerrar/cancelar (justificado);
 *  - Moderação: fila de perguntas por audiência (aprovar/rejeitar/responder);
 *  - Assinaturas (Fase 19, ADR-020 — exige subscription.manage): cidadãos
 *    que acompanham matérias/sessões/audiências por e-mail com dupla
 *    confirmação; stats, cópia do link de confirmação (sandbox — em produção
 *    o token vai por e-mail) e revogação auditada (AlertDialog).
 * O código de verificação da publicação tem botão de copiar e hint do fluxo
 * público de autenticidade (verificável no portal público — Fase 19).
 *
 * Escrita escondida sem can('publication.write') / can('hearing.write');
 * leitura permitida a todos os papéis. Fetch local com x-actor-id do
 * localStorage (convivência com o modo demo, ADR-005).
 */
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import Markdown from 'react-markdown'
import { toast } from 'sonner'
import {
  Ban,
  Bell,
  CalendarClock,
  CheckCircle2,
  Clock,
  Copy,
  Eye,
  Link2,
  Mail,
  MailCheck,
  MapPin,
  Megaphone,
  MessageCircleQuestion,
  MessagesSquare,
  MoreHorizontal,
  Newspaper,
  Pencil,
  Plus,
  RefreshCw,
  Reply,
  Search,
  ShieldCheck,
  XCircle,
} from 'lucide-react'

import { useApp } from '@/lib/store'
import {
  MATTER_TYPE_LABEL,
  SESSION_TYPE_LABEL,
  SUBSCRIPTION_TARGET_LABEL,
  TEMPLATE_KIND_LABEL,
  type MatterView,
  type SessionSummary,
  type SubscriptionStats,
  type SubscriptionTargetKind,
  type TemplateKind,
} from '@/lib/contracts'
import { EmptyState, PageHeader } from '@/components/app/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useDebouncedValue } from '@/modules/_shared'
import { cn } from '@/lib/utils'

// ─── Fetch local (api-client.ts intocável) ─────────────────────────────────

type Problem = {
  title?: string
  detail?: string
  status?: number
  code?: string
  errors?: Record<string, string[]>
}

class PubApiError extends Error {
  constructor(public readonly problem: Problem) {
    super(problem.detail || problem.title || 'Erro na requisição.')
    this.name = 'PubApiError'
  }
}

/** fetch + JSON + Problem Details; injeta x-actor-id do modo demo. */
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body !== undefined) headers.set('Content-Type', 'application/json')
  const actorId = typeof window !== 'undefined' ? localStorage.getItem('legis.actorId') : null
  if (actorId) headers.set('x-actor-id', actorId)
  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' })
  const text = await res.text()
  const body: unknown = text ? JSON.parse(text) : null
  if (!res.ok) throw new PubApiError((body ?? {}) as Problem)
  return body as T
}

function problemMessage(err: unknown): string {
  if (err instanceof PubApiError) {
    const fields = err.problem.errors
      ? Object.values(err.problem.errors).flat().filter(Boolean).join(' ')
      : ''
    return [err.problem.detail, fields].filter(Boolean).join(' — ')
  }
  return err instanceof Error ? err.message : 'Erro inesperado.'
}

// ─── Tipos e constantes ─────────────────────────────────────────────────────

type PublicationRow = {
  id: string
  number: number
  year: number
  numberLabel: string
  kind: string
  kindLabel: string
  title: string
  status: string
  statusLabel: string
  sessionId: string | null
  matterId: string | null
  publishedAt: string | null
  revokedAt: string | null
  revokedReason: string | null
  verificationCode: string | null
  createdAt: string
  reviewHash: string | null
  reviewedByName: string | null
  reviewedAt: string | null
  publishedContentSha256: string | null
}

type PublicationDetail = PublicationRow & { contentMd: string; currentReviewHash: string; reviewReference: string | null }

/** Modelo de documento ativo (opções do dialog de criação — Fase 14). */
type TemplateOptionRow = {
  id: string
  name: string
  kind: string
  active: boolean
  currentVersion: number
}

type TemplateRenderResponse = {
  rendered: string
  unresolved: string[]
  templateId: string
  version: number
}

type QuestionCounts = { pending: number; approved: number; rejected: number; answered: number }

type HearingRow = {
  id: string
  title: string
  subject: string
  matterId: string | null
  scheduledAt: string
  location: string | null
  status: string
  statusLabel: string
  questionsOpen: boolean
  questions: QuestionCounts
  createdAt: string
}

type QuestionRow = {
  id: string
  hearingId: string
  authorName: string
  authorEmail: string | null
  district: string | null
  question: string
  status: string
  statusLabel: string
  answer: string | null
  moderatedBy: string | null
  answeredAt: string | null
  createdAt: string
}

const PUBLICATION_KIND_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'ata_sessao', label: 'Ata de Sessão' },
  { value: 'decreto', label: 'Decreto' },
  { value: 'resolucao', label: 'Resolução' },
  { value: 'portaria', label: 'Portaria' },
  { value: 'edital', label: 'Edital' },
  { value: 'ata', label: 'Ata' },
]

const kindLabel = (k: string) => PUBLICATION_KIND_OPTIONS.find((o) => o.value === k)?.label ?? k

const templateKindLabel = (k: string) => TEMPLATE_KIND_LABEL[k as TemplateKind] ?? k

const QUESTION_STATUS_OPTIONS = [
  { value: 'pending', label: 'Pendentes' },
  { value: 'approved', label: 'Aprovadas' },
  { value: 'rejected', label: 'Rejeitadas' },
  { value: 'answered', label: 'Respondidas' },
]

/** Datas com date-fns + locale pt-BR. */
const fmtDateTime = (iso: string | null | undefined) =>
  iso ? format(new Date(iso), "d 'de' MMM 'de' yyyy 'às' HH:mm", { locale: ptBR }) : '—'

const fmtDate = (iso: string | null | undefined) =>
  iso ? format(new Date(iso), 'd/MM/yyyy', { locale: ptBR }) : '—'

// ─── Badges ─────────────────────────────────────────────────────────────────

function PublicationStatusBadge({ status }: { status: string }) {
  if (status === 'published')
    return (
      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">Publicada</Badge>
    )
  if (status === 'revoked')
    return <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-300">Revogada</Badge>
  return <Badge variant="outline">Rascunho</Badge>
}

function HearingStatusBadge({ status }: { status: string }) {
  if (status === 'open')
    return (
      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">Aberta</Badge>
    )
  if (status === 'closed') return <Badge variant="outline">Encerrada</Badge>
  if (status === 'canceled')
    return <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-300">Cancelada</Badge>
  return (
    <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300">Agendada</Badge>
  )
}

function QuestionStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    approved: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    rejected: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
    answered: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  }
  const label: Record<string, string> = {
    pending: 'Pendente',
    approved: 'Aprovada',
    rejected: 'Rejeitada',
    answered: 'Respondida',
  }
  return <Badge className={cn('font-medium', map[status] ?? '')}>{label[status] ?? status}</Badge>
}

/** Conteúdo Markdown simples (headings/parágrafos/listas) para o dialog Ver. */
function MarkdownContent({ children }: { children: string }) {
  if (!children.trim()) {
    return <p className="text-sm italic text-muted-foreground">Publicação sem conteúdo textual.</p>
  }
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      <Markdown
        components={{
          h1: ({ node: _n, ...props }) => <h3 className="text-base font-bold" {...props} />,
          h2: ({ node: _n, ...props }) => <h3 className="text-base font-bold" {...props} />,
          h3: ({ node: _n, ...props }) => <h4 className="font-semibold" {...props} />,
          ul: ({ node: _n, ...props }) => (
            <ul className="list-disc space-y-1 pl-5" {...props} />
          ),
          ol: ({ node: _n, ...props }) => (
            <ol className="list-decimal space-y-1 pl-5" {...props} />
          ),
          p: ({ node: _n, ...props }) => <p className="leading-relaxed" {...props} />,
          strong: ({ node: _n, ...props }) => <strong className="font-semibold" {...props} />,
        }}
      >
        {children}
      </Markdown>
    </div>
  )
}

// ─── Tab 1: Publicações ─────────────────────────────────────────────────────

type PublicationDialogState =
  | { mode: 'create' }
  | { mode: 'edit'; publication: PublicationRow }
  | null

/** Dialog criar publicação / editar rascunho (título + conteúdo + vínculos). */
function PublicationFormDialog({
  state,
  onClose,
}: {
  state: Extract<PublicationDialogState, { mode: 'create' | 'edit' }>
  onClose: () => void
}) {
  const qc = useQueryClient()
  const editing = state.mode === 'edit' ? state.publication : null

  // Edição precisa do contentMd (a lista não o traz).
  const detailQ = useQuery({
    queryKey: ['publication-detail', editing?.id],
    queryFn: () =>
      apiFetch<{ publication: PublicationDetail }>(`/api/v1/publications/${editing!.id}`),
    enabled: !!editing,
  })

  const [kind, setKind] = useState(editing?.kind ?? 'ata_sessao')
  const [title, setTitle] = useState(editing?.title ?? '')
  const [sessionId, setSessionId] = useState('none')
  const [matterId, setMatterId] = useState('none')
  const [contentMd, setContentMd] = useState('')
  const [templateId, setTemplateId] = useState('none')
  // true quando o usuário digita o conteúdo manualmente (não re-renderiza ao
  // trocar vínculos para não sobrescrever edição humana).
  const [contentDirty, setContentDirty] = useState(false)

  // Vínculos opcionais: sessões e matérias do escopo do ator.
  const sessionsQ = useQuery({
    queryKey: ['publications-dialog-sessions'],
    queryFn: () => apiFetch<{ sessions: SessionSummary[] }>('/api/v1/sessions'),
  })
  const mattersQ = useQuery({
    queryKey: ['publications-dialog-matters'],
    queryFn: () => apiFetch<{ matters: MatterView[] }>('/api/v1/matters'),
  })

  // Fase 14 — modelos ATIVOS para "criar a partir de modelo" (só na criação).
  const templatesQ = useQuery({
    queryKey: ['templates'],
    queryFn: () => apiFetch<{ templates: TemplateOptionRow[] }>('/api/v1/templates'),
    enabled: !editing,
  })

  // Render no SERVIDOR com os vínculos JÁ escolhidos no diálogo (preview —
  // não audita). Tokens não resolvidos avisam o usuário, nunca bloqueiam.
  const renderTemplate = useMutation({
    mutationFn: (vars: { tplId: string; sess?: string; mat?: string }) =>
      apiFetch<TemplateRenderResponse>(`/api/v1/templates/${vars.tplId}/render`, {
        method: 'POST',
        body: JSON.stringify({
          ...(vars.sess ? { sessionId: vars.sess } : {}),
          ...(vars.mat ? { matterId: vars.mat } : {}),
        }),
      }),
    onSuccess: (data) => {
      setContentMd(data.rendered)
      setContentDirty(false)
      if (data.unresolved.length > 0) {
        toast.info(
          `${data.unresolved.length} placeholders não resolvidos — revise antes de publicar`,
          {
            description: `Sem contexto: ${data.unresolved.map((t) => `{{${t}}}`).join(', ')}.`,
          }
        )
      }
    },
    onError: (err) => {
      toast.error('Falha ao renderizar o modelo', { description: problemMessage(err) })
      setTemplateId('none')
    },
  })

  function runRender(tplId: string, sess: string, mat: string) {
    renderTemplate.mutate({
      tplId,
      ...(sess !== 'none' ? { sess } : {}),
      ...(mat !== 'none' ? { mat } : {}),
    })
  }

  function handleTemplateChange(v: string) {
    setTemplateId(v)
    if (v !== 'none') runRender(v, sessionId, matterId)
  }

  function handleKindChange(v: string) {
    setKind(v)
    // As opções de modelo são pré-filtradas pelo tipo — origem anterior perde
    // sentido quando o tipo muda.
    setTemplateId('none')
  }

  function handleSessionChange(v: string) {
    setSessionId(v)
    if (templateId !== 'none' && !contentDirty && !renderTemplate.isPending) {
      runRender(templateId, v, matterId)
    }
  }

  function handleMatterChange(v: string) {
    setMatterId(v)
    if (templateId !== 'none' && !contentDirty && !renderTemplate.isPending) {
      runRender(templateId, sessionId, v)
    }
  }

  // Popula o formulário quando o detalhe chega (modo edição) — reset
  // derivado no render. O guarda usa o ID DO ALVO (não do detalhe): com cache
  // quente o detalhe já está disponível no primeiro render e a população
  // precisa acontecer mesmo assim (a cada abertura do diálogo).
  const detailPub = detailQ.data?.publication
  const [populatedFor, setPopulatedFor] = useState<string | null>(null)
  if (editing && detailPub && populatedFor !== editing.id) {
    setPopulatedFor(editing.id)
    setTitle(detailPub.title)
    setContentMd(detailPub.contentMd)
    setSessionId(detailPub.sessionId ?? 'none')
    setMatterId(detailPub.matterId ?? 'none')
  }

  const save = useMutation({
    mutationFn: async () => {
      if (editing) {
        return apiFetch<{ publication: PublicationRow }>(`/api/v1/publications/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ action: 'edit', title: title.trim(), contentMd }),
        })
      }
      return apiFetch<{ publication: PublicationRow }>('/api/v1/publications', {
        method: 'POST',
        body: JSON.stringify({
          kind,
          title: title.trim(),
          contentMd,
          ...(sessionId !== 'none' ? { sessionId } : {}),
          ...(matterId !== 'none' ? { matterId } : {}),
          ...(templateId !== 'none' ? { templateId } : {}),
        }),
      })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['publications'] })
      if (editing) void qc.invalidateQueries({ queryKey: ['publication-detail', editing.id] })
      toast.success(editing ? 'Rascunho atualizado' : 'Rascunho criado', {
        description: editing
          ? 'Alterações de título e conteúdo salvas com auditoria.'
          : 'A publicação recebeu número sequencial e código de verificação; publique-a quando pronta.',
      })
      onClose()
    },
    onError: (err) => toast.error('Falha ao salvar publicação', { description: problemMessage(err) }),
  })

  const sessions = sessionsQ.data?.sessions ?? []
  const matters = mattersQ.data?.matters ?? []
  const titleValid = title.trim().length >= 5 && title.trim().length <= 200

  // Modelos ativos: preferência pelo tipo escolhido (ata também aceita
  // ata_sessao); sem correspondência, lista todos os ativos COM o tipo no label.
  const activeTemplates = (templatesQ.data?.templates ?? []).filter((t) => t.active)
  const kindMatched = activeTemplates.filter(
    (t) => t.kind === kind || (kind === 'ata' && t.kind === 'ata_sessao')
  )
  const templateOptions = kindMatched.length > 0 ? kindMatched : activeTemplates

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto custom-scroll sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Newspaper className="size-5 text-primary" />
            {editing ? `Editar rascunho nº ${editing.numberLabel}` : 'Nova publicação'}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? 'Apenas rascunhos são editáveis — publicações já publicadas são imutáveis (revogação é o único caminho).'
              : 'A publicação nasce como rascunho com numeração sequencial por ano. A publicação no diário é definitiva e auditada.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pub-kind">Tipo</Label>
              <Select
                value={kind}
                onValueChange={handleKindChange}
                disabled={!!editing}
              >
                <SelectTrigger id="pub-kind" aria-label="Tipo da publicação">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PUBLICATION_KIND_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pub-title">Título (5 a 200 caracteres)</Label>
              <Input
                id="pub-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex.: Ata da 2ª Sessão Ordinária de 2026"
                aria-invalid={!titleValid}
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pub-session">Sessão vinculada {kind === 'ata_sessao' ? '(obrigatória)' : '(opcional)'}</Label>
              <Select value={sessionId} onValueChange={handleSessionChange} disabled={!!editing}>
                <SelectTrigger id="pub-session" aria-label="Sessão vinculada">
                  <SelectValue placeholder="Sem vínculo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem vínculo</SelectItem>
                  {sessions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {SESSION_TYPE_LABEL[s.type]} nº {s.number}/{s.year} —{' '}
                      {format(new Date(s.scheduledAt), 'd/MM/yyyy', { locale: ptBR })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pub-matter">Matéria vinculada (opcional)</Label>
              <Select value={matterId} onValueChange={handleMatterChange} disabled={!!editing}>
                <SelectTrigger id="pub-matter" aria-label="Matéria vinculada">
                  <SelectValue placeholder="Sem vínculo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem vínculo</SelectItem>
                  {matters.slice(0, 60).map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {MATTER_TYPE_LABEL[m.type]} nº {m.number}/{m.year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {!editing && (
            <div className="space-y-1.5">
              <Label htmlFor="pub-template">Criar a partir de modelo (opcional)</Label>
              <Select
                value={templateId}
                onValueChange={handleTemplateChange}
                disabled={renderTemplate.isPending}
              >
                <SelectTrigger id="pub-template" aria-label="Modelo de documento">
                  <SelectValue placeholder="Começar em branco" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Começar em branco</SelectItem>
                  {templateOptions.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} · {templateKindLabel(t.kind)} · v{t.currentVersion}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {renderTemplate.isPending ? (
                  <span className="inline-flex items-center gap-1.5">
                    <RefreshCw className="size-3 animate-spin" aria-hidden /> Renderizando modelo no
                    servidor…
                  </span>
                ) : (
                  'Modelos ativos desta Casa — o corpo é preenchido com os placeholders resolvidos conforme os vínculos escolhidos.'
                )}
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="pub-content">Conteúdo</Label>
            <Textarea
              id="pub-content"
              value={contentMd}
              onChange={(e) => {
                setContentMd(e.target.value)
                setContentDirty(true)
              }}
              placeholder="Texto integral da publicação — atas, considerandos, artigos…"
              className="min-h-52 custom-scroll"
              aria-describedby="pub-content-hint"
            />
            <p id="pub-content-hint" className="text-xs text-muted-foreground">
              Markdown suportado (títulos com <code className="rounded bg-muted px-1">#</code>, listas
              com <code className="rounded bg-muted px-1">-</code>, negrito com{' '}
              <code className="rounded bg-muted px-1">**texto**</code>).
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !titleValid || (!editing && kind === 'ata_sessao' && sessionId === 'none')}>
            {save.isPending && <RefreshCw className="animate-spin" />}
            {editing ? 'Salvar rascunho' : 'Criar rascunho'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Dialog somente leitura com conteúdo + código de verificação em destaque. */
function ViewPublicationDialog({
  publication,
  onClose,
}: {
  publication: PublicationRow
  onClose: () => void
}) {
  const detailQ = useQuery({
    queryKey: ['publication-detail', publication.id],
    queryFn: () =>
      apiFetch<{ publication: PublicationDetail }>(`/api/v1/publications/${publication.id}`),
  })
  const detail = detailQ.data?.publication ?? null

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto custom-scroll sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
            <Newspaper className="size-5 text-primary" />
            <span className="font-mono">{publication.numberLabel}</span>
            <span className="text-muted-foreground">·</span>
            {publication.kindLabel}
            <PublicationStatusBadge status={publication.status} />
          </DialogTitle>
          <DialogDescription className="text-sm font-medium text-foreground">
            {publication.title}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
            <span>Criada em {fmtDateTime(publication.createdAt)}</span>
            {publication.publishedAt && <span>Publicada em {fmtDateTime(publication.publishedAt)}</span>}
            {publication.revokedAt && <span>Revogada em {fmtDateTime(publication.revokedAt)}</span>}
          </div>

          {publication.status === 'revoked' && (
            <div
              role="alert"
              className="rounded-lg border border-rose-300 bg-rose-500/10 p-3 text-sm dark:border-rose-800"
            >
              <p className="font-semibold text-rose-700 dark:text-rose-300">Publicação revogada</p>
              <p className="mt-1 whitespace-pre-wrap text-rose-800 dark:text-rose-200">
                {publication.revokedReason ?? '—'}
              </p>
            </div>
          )}

          {detail ? (
            <section aria-label="Conteúdo integral">
              <MarkdownContent>{detail.contentMd}</MarkdownContent>
            </section>
          ) : (
            <div className="space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-24 w-full rounded-lg" />
            </div>
          )}

          <div className="rounded-lg border bg-muted/40 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Código de verificação
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <p className="font-mono text-lg font-bold tracking-[0.35em]">
                {publication.verificationCode ?? '—'}
              </p>
              {publication.verificationCode && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(publication.verificationCode ?? '')
                      .then(() =>
                        toast.success('Código copiado', {
                          description: `${publication.verificationCode} — ${publication.numberLabel}.`,
                        })
                      )
                      .catch(() =>
                        toast.error('Não foi possível copiar', {
                          description: 'Copie manualmente: selecione o código acima.',
                        })
                      )
                  }}
                  aria-label={`Copiar código de verificação da publicação ${publication.numberLabel}`}
                >
                  <Copy className="size-3.5" /> Copiar
                </Button>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Verificável no portal público: qualquer pessoa confirma a autenticidade desta
              publicação informando o código na aba Publicações do portal (consulta pública
              /api/v1/public/verify).
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Dialog de revogação — motivo obrigatório (mín. 10), auditado. */
function RevokePublicationDialog({
  publication,
  onClose,
}: {
  publication: PublicationRow
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [reason, setReason] = useState('')

  const revoke = useMutation({
    mutationFn: () =>
      apiFetch<{ publication: PublicationRow }>(`/api/v1/publications/${publication.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'revoke', reason: reason.trim() }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['publications'] })
      void qc.invalidateQueries({ queryKey: ['publication-detail', publication.id] })
      toast.success('Publicação revogada', {
        description: `A revogação da ${publication.numberLabel} ficou registrada na auditoria e no portal público.`,
      })
      onClose()
    },
    onError: (err) =>
      toast.error('Falha ao revogar', { description: problemMessage(err) }),
  })

  const reasonValid = reason.trim().length >= 10

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Ban className="size-5 text-destructive" /> Revogar {publication.numberLabel}?
          </DialogTitle>
          <DialogDescription>
            <strong className="text-foreground">{publication.title}</strong> — a revogação é
            DEFINITIVA (a publicação permanece no diário com selo de revogada e o motivo fica
            público). A ação é auditada com o motivo informado.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="revoke-reason">Motivo da revogação (mín. 10 caracteres)</Label>
          <Textarea
            id="revoke-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex.: Erro material no artigo 3º identificado após a publicação; republicação em novo número."
            className="min-h-28"
            aria-invalid={!reasonValid}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={() => revoke.mutate()}
            disabled={revoke.isPending || !reasonValid}
          >
            {revoke.isPending && <RefreshCw className="animate-spin" />} Revogar definitivamente
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PublicationsTab({ canWrite }: { canWrite: boolean }) {
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('all')
  const [kindFilter, setKindFilter] = useState('all')
  const [yearInput, setYearInput] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const search = useDebouncedValue(searchInput, 450)
  const [dialog, setDialog] = useState<PublicationDialogState>(null)
  const [viewTarget, setViewTarget] = useState<PublicationRow | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<PublicationRow | null>(null)
  const [publishTarget, setPublishTarget] = useState<PublicationRow | null>(null)
  const [reviewTarget, setReviewTarget] = useState<PublicationRow | null>(null)
  const [reviewReference, setReviewReference] = useState('')
  const reviewDetailQ = useQuery({ queryKey: ['publication-detail', reviewTarget?.id],
    queryFn: () => apiFetch<{ publication: PublicationDetail }>(`/api/v1/publications/${reviewTarget!.id}`),
    enabled: !!reviewTarget })
  const review = useMutation({
    mutationFn: (vars: { id: string; expectedHash: string; reference: string }) =>
      apiFetch<{ publication: PublicationRow }>(`/api/v1/publications/${vars.id}`, { method: 'PATCH',
        body: JSON.stringify({ action: 'review', expectedHash: vars.expectedHash, reference: vars.reference }) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['publications'] });
      if (reviewTarget) void qc.invalidateQueries({ queryKey: ['publication-detail', reviewTarget.id] });
      setReviewTarget(null); setReviewReference(''); toast.success('Ata revisada; outra pessoa poderá publicá-la.') },
    onError: (err) => toast.error('Falha na revisão', { description: problemMessage(err) }),
  })

  const filtersKey = JSON.stringify({ statusFilter, kindFilter, yearInput, search })
  const publicationsQ = useQuery({
    queryKey: ['publications', filtersKey],
    queryFn: () => {
      const params = new URLSearchParams()
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (kindFilter !== 'all') params.set('kind', kindFilter)
      if (/^\d{4}$/.test(yearInput.trim())) params.set('year', yearInput.trim())
      if (search.trim()) params.set('q', search.trim())
      const qs = params.toString()
      return apiFetch<{ publications: PublicationRow[] }>(
        `/api/v1/publications${qs ? `?${qs}` : ''}`
      )
    },
  })
  const publications = publicationsQ.data?.publications ?? []

  const publish = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ publication: PublicationRow }>(`/api/v1/publications/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'publish' }),
      }),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['publications'] })
      toast.success('Publicação publicada', {
        description: `${data.publication.numberLabel} — ${data.publication.title} agora consta no diário eletrônico e no portal público.`,
      })
      setPublishTarget(null)
    },
    onError: (err) => {
      toast.error('Falha ao publicar', { description: problemMessage(err) })
      setPublishTarget(null)
    },
  })

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:flex-wrap">
        <div className="relative lg:w-64">
          <Search
            className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar por título…"
            className="pl-8"
            aria-label="Buscar publicações por título"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="lg:w-40" aria-label="Filtrar por situação">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as situações</SelectItem>
            <SelectItem value="draft">Rascunhos</SelectItem>
            <SelectItem value="published">Publicadas</SelectItem>
            <SelectItem value="revoked">Revogadas</SelectItem>
          </SelectContent>
        </Select>
        <Select value={kindFilter} onValueChange={setKindFilter}>
          <SelectTrigger className="lg:w-44" aria-label="Filtrar por tipo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            {PUBLICATION_KIND_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="number"
          inputMode="numeric"
          value={yearInput}
          onChange={(e) => setYearInput(e.target.value)}
          placeholder="Ano"
          min={1990}
          max={2100}
          className="lg:w-24"
          aria-label="Filtrar por ano"
        />
        <div className="lg:ml-auto">
          {canWrite && (
            <Button onClick={() => setDialog({ mode: 'create' })}>
              <Plus /> Nova publicação
            </Button>
          )}
        </div>
      </div>

      {/* Tabela */}
      {publicationsQ.isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : publications.length === 0 ? (
        <EmptyState
          icon={<Newspaper />}
          title="Nenhuma publicação encontrada"
          description={
            canWrite
              ? 'Crie a primeira publicação do diário eletrônico (ata, decreto, resolução, portaria ou edital).'
              : 'Ainda não há publicações no diário eletrônico desta Casa Legislativa.'
          }
          action={
            canWrite ? (
              <Button onClick={() => setDialog({ mode: 'create' })}>
                <Plus /> Nova publicação
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="max-h-[62vh] overflow-auto custom-scroll rounded-xl border bg-card">
          <Table className="min-w-[54rem]">
            <caption className="sr-only">Publicações do diário eletrônico</caption>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead className="w-24">Nº</TableHead>
                <TableHead className="w-36">Tipo</TableHead>
                <TableHead>Título</TableHead>
                <TableHead className="w-28">Situação</TableHead>
                <TableHead className="hidden w-40 md:table-cell">Publicada em</TableHead>
                <TableHead className="w-12 text-right">
                  <span className="sr-only">Ações</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {publications.map((p) => (
                <TableRow key={p.id} className={cn(p.status === 'revoked' && 'opacity-75')}>
                  <TableCell className="font-mono text-xs font-semibold">{p.numberLabel}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-[11px]">
                      {p.kindLabel}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <p className="max-w-md truncate font-medium" title={p.title}>
                      {p.title}
                    </p>
                    {p.status === 'revoked' && p.revokedReason && (
                      <p className="max-w-md truncate text-xs text-rose-600 dark:text-rose-400" title={p.revokedReason}>
                        Revogada: {p.revokedReason}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <PublicationStatusBadge status={p.status} />
                    {p.kind === 'ata_sessao' && p.reviewHash && p.status === 'draft' && <Badge variant="outline" className="ml-1">Revisada</Badge>}
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                    {fmtDate(p.publishedAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Ações da publicação ${p.numberLabel}`}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setViewTarget(p)}>
                          <Eye /> Ver
                        </DropdownMenuItem>
                        {canWrite && p.status === 'draft' && (
                          <>
                            {p.kind === 'ata_sessao' && <DropdownMenuItem onClick={() => { setReviewReference(''); setReviewTarget(p) }}>
                              <ShieldCheck /> Revisar ata
                            </DropdownMenuItem>}
                            <DropdownMenuItem onClick={() => setPublishTarget(p)}>
                              <Megaphone /> Publicar
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setDialog({ mode: 'edit', publication: p })}>
                              <Pencil /> Editar rascunho
                            </DropdownMenuItem>
                          </>
                        )}
                        {canWrite && p.status === 'published' && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => setRevokeTarget(p)}
                            >
                              <Ban /> Revogar…
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Dialogs */}
      {dialog && <PublicationFormDialog state={dialog} onClose={() => setDialog(null)} />}
      {viewTarget && (
        <ViewPublicationDialog publication={viewTarget} onClose={() => setViewTarget(null)} />
      )}
      <Dialog open={!!reviewTarget} onOpenChange={(open) => { if (!open) setReviewTarget(null) }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>Revisar ata {reviewTarget?.numberLabel}</DialogTitle>
            <DialogDescription>Confira o texto completo e a sessão vinculada. O hash congela esta revisão; outra pessoa deverá publicar.</DialogDescription>
          </DialogHeader>
          {reviewDetailQ.data?.publication ? <div className="space-y-3 text-sm">
            <p><strong>{reviewDetailQ.data.publication.title}</strong> · sessão {reviewDetailQ.data.publication.sessionId ?? 'não vinculada'}</p>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded border p-3 font-sans">{reviewDetailQ.data.publication.contentMd}</pre>
            <p className="break-all font-mono text-xs">Hash da revisão: {reviewDetailQ.data.publication.currentReviewHash}</p>
            {reviewDetailQ.data.publication.reviewHash && <p>Revisada por {reviewDetailQ.data.publication.reviewedByName}. Edite o rascunho para iniciar nova revisão.</p>}
            <div className="grid gap-1"><Label htmlFor="ata-review-reference">Referência da conferência</Label>
              <Input id="ata-review-reference" value={reviewReference} onChange={(e) => setReviewReference(e.target.value)}
                placeholder="Ex.: conferência interna 2026/001" maxLength={200} /></div>
          </div> : <Skeleton className="h-24 w-full" />}
          <DialogFooter><Button variant="outline" onClick={() => setReviewTarget(null)}>Cancelar</Button>
            <Button disabled={review.isPending || reviewReference.trim().length < 5 || !reviewDetailQ.data?.publication || !!reviewDetailQ.data.publication.reviewHash}
              onClick={() => { const detail = reviewDetailQ.data?.publication; if (reviewTarget && detail) review.mutate({
                id: reviewTarget.id, expectedHash: detail.currentReviewHash, reference: reviewReference.trim() }) }}>
              Confirmar revisão
            </Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {revokeTarget && (
        <RevokePublicationDialog
          publication={revokeTarget}
          onClose={() => setRevokeTarget(null)}
        />
      )}

      {/* Confirmação de publicação */}
      <AlertDialog
        open={!!publishTarget}
        onOpenChange={(open) => !open && setPublishTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publicar {publishTarget?.numberLabel}?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground">{publishTarget?.title}</strong> será publicada no
              diário eletrônico com número e código de verificação definitivos. A partir daí o
              conteúdo fica imutável — apenas a revogação (com motivo) é possível.
              {publishTarget?.kind === 'ata_sessao' && <span className="block mt-2">Ata de sessão: exige revisão vigente por outra pessoa e sessão encerrada.
                {publishTarget.reviewedByName ? ` Revisada por ${publishTarget.reviewedByName}.` : ' Ainda não revisada.'}</span>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => publishTarget && publish.mutate(publishTarget.id)}
              disabled={publish.isPending}
            >
              {publish.isPending && <RefreshCw className="animate-spin" />} Publicar agora
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── Tab 2: Audiências ──────────────────────────────────────────────────────

/** Dialog criar audiência pública. */
function HearingFormDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState('')
  const [matterId, setMatterId] = useState('none')
  const [scheduledAt, setScheduledAt] = useState('')
  const [location, setLocation] = useState('')

  const mattersQ = useQuery({
    queryKey: ['publications-dialog-matters'],
    queryFn: () => apiFetch<{ matters: MatterView[] }>('/api/v1/matters'),
  })
  const matters = mattersQ.data?.matters ?? []

  const create = useMutation({
    mutationFn: () =>
      apiFetch<{ hearing: HearingRow }>('/api/v1/hearings', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          subject: subject.trim(),
          scheduledAt,
          location: location.trim() || undefined,
          ...(matterId !== 'none' ? { matterId } : {}),
        }),
      }),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['hearings'] })
      toast.success('Audiência agendada', {
        description: `"${data.hearing.title}" já aceita perguntas do cidadão pelo portal público.`,
      })
      onClose()
    },
    onError: (err) =>
      toast.error('Falha ao criar audiência', { description: problemMessage(err) }),
  })

  const titleValid = title.trim().length >= 5 && title.trim().length <= 200
  const subjectValid = subject.trim().length >= 5 && subject.trim().length <= 500
  const dateValid = scheduledAt.length > 0 && !Number.isNaN(Date.parse(scheduledAt))

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto custom-scroll sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="size-5 text-primary" /> Nova audiência pública
          </DialogTitle>
          <DialogDescription>
            A audiência nasce <strong>Agendada</strong> e com recebimento de perguntas aberto no
            portal. Abra no dia do evento e encerre ao final.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="hearing-title">Título (5 a 200 caracteres)</Label>
            <Input
              id="hearing-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Audiência Pública do Orçamento Participativo 2027"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hearing-subject">Assunto (5 a 500 caracteres)</Label>
            <Textarea
              id="hearing-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Objeto da audiência: pauta, matéria em discussão, convocações…"
              className="min-h-20"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="hearing-date">Data e hora</Label>
              <Input
                id="hearing-date"
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                aria-invalid={!dateValid}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hearing-location">Local (opcional, máx. 200)</Label>
              <Input
                id="hearing-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Ex.: Plenário Anísio Teixeira"
                maxLength={200}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hearing-matter">Matéria vinculada (opcional)</Label>
            <Select value={matterId} onValueChange={setMatterId}>
              <SelectTrigger id="hearing-matter" aria-label="Matéria vinculada">
                <SelectValue placeholder="Sem vínculo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sem vínculo</SelectItem>
                {matters.slice(0, 60).map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {MATTER_TYPE_LABEL[m.type]} nº {m.number}/{m.year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={() => create.mutate()}
            disabled={create.isPending || !titleValid || !subjectValid || !dateValid}
          >
            {create.isPending && <RefreshCw className="animate-spin" />} Agendar audiência
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function HearingsTab({ hearings, isLoading, canWrite }: { hearings: HearingRow[]; isLoading: boolean; canWrite: boolean }) {
  const qc = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [closeTarget, setCloseTarget] = useState<HearingRow | null>(null)
  const [cancelTarget, setCancelTarget] = useState<HearingRow | null>(null)
  const [cancelReason, setCancelReason] = useState('')

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['hearings'] })
    void qc.invalidateQueries({ queryKey: ['hearing-questions'] })
  }

  const transition = useMutation({
    mutationFn: ({ id, action, justification }: { id: string; action: string; justification?: string }) =>
      apiFetch<{ hearing: HearingRow }>(`/api/v1/hearings/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(
          justification !== undefined ? { action, justification } : { action }
        ),
      }),
    onSuccess: (data, vars) => {
      invalidate()
      const labels: Record<string, string> = {
        open: 'Audiência aberta',
        close: 'Audiência encerrada',
        cancel: 'Audiência cancelada',
      }
      toast.success(labels[vars.action] ?? 'Audiência atualizada', {
        description:
          vars.action === 'close'
            ? `"${data.hearing.title}" foi encerrada e o recebimento de perguntas foi fechado.`
            : vars.action === 'cancel'
              ? `"${data.hearing.title}" foi cancelada com justificativa auditada.`
              : `"${data.hearing.title}" está aberta — perguntas podem ser moderadas ao vivo.`,
      })
      setCloseTarget(null)
      setCancelTarget(null)
      setCancelReason('')
    },
    onError: (err) => {
      toast.error('Falha na transição da audiência', { description: problemMessage(err) })
      setCloseTarget(null)
      setCancelTarget(null)
      setCancelReason('')
    },
  })

  const toggleQuestions = useMutation({
    mutationFn: ({ id, questionsOpen }: { id: string; questionsOpen: boolean }) =>
      apiFetch<{ hearing: HearingRow }>(`/api/v1/hearings/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'toggle_questions', questionsOpen }),
      }),
    onSuccess: (data) => {
      invalidate()
      toast.success(
        data.hearing.questionsOpen ? 'Perguntas reabertas' : 'Perguntas encerradas',
        { description: `"${data.hearing.title}" — ${data.hearing.questionsOpen ? 'o portal volta a aceitar perguntas.' : 'o portal deixou de aceitar novas perguntas.'}` }
      )
    },
    onError: (err) =>
      toast.error('Falha ao alternar perguntas', { description: problemMessage(err) }),
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {hearings.length} audiência(s) · {hearings.reduce((acc, h) => acc + h.questions.pending, 0)}{' '}
          pergunta(s) aguardando moderação
        </p>
        {canWrite && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus /> Nova audiência
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : hearings.length === 0 ? (
        <EmptyState
          icon={<CalendarClock />}
          title="Nenhuma audiência pública"
          description={
            canWrite
              ? 'Agende a primeira audiência para receber perguntas do cidadão pelo portal público.'
              : 'Não há audiências públicas agendadas nesta Casa Legislativa.'
          }
          action={
            canWrite ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus /> Nova audiência
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="max-h-[62vh] overflow-auto custom-scroll rounded-xl border bg-card">
          <Table className="min-w-[60rem]">
            <caption className="sr-only">Audiências públicas</caption>
            <TableHeader className="sticky top-0 z-10 bg-card">
              <TableRow>
                <TableHead>Audiência</TableHead>
                <TableHead className="hidden w-44 lg:table-cell">Data/hora</TableHead>
                <TableHead className="hidden w-40 xl:table-cell">Local</TableHead>
                <TableHead className="w-28">Situação</TableHead>
                <TableHead className="w-32">Perguntas</TableHead>
                <TableHead className="w-32">Recebimento</TableHead>
                <TableHead className="w-12 text-right">
                  <span className="sr-only">Ações</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {hearings.map((h) => (
                <TableRow key={h.id} className={cn(h.status === 'canceled' && 'opacity-60')}>
                  <TableCell>
                    <p className="max-w-xs truncate font-medium" title={h.title}>
                      {h.title}
                    </p>
                    <p className="max-w-xs truncate text-xs text-muted-foreground" title={h.subject}>
                      {h.subject}
                    </p>
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                    {fmtDateTime(h.scheduledAt)}
                  </TableCell>
                  <TableCell className="hidden xl:table-cell">
                    {h.location ? (
                      <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                        <MapPin className="size-3.5" aria-hidden /> {h.location}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <HearingStatusBadge status={h.status} />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1">
                      {h.questions.pending > 0 ? (
                        <Badge className="bg-rose-600 text-white">{h.questions.pending} pendente(s)</Badge>
                      ) : (
                        <Badge variant="outline">0 pendentes</Badge>
                      )}
                      {h.questions.answered > 0 && (
                        <Badge variant="secondary" className="text-[11px]">
                          {h.questions.answered} respondida(s)
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <label
                      className="flex items-center gap-2 text-xs font-medium"
                      htmlFor={`q-open-${h.id}`}
                    >
                      <Switch
                        id={`q-open-${h.id}`}
                        checked={h.questionsOpen}
                        disabled={
                          !canWrite ||
                          h.status === 'closed' ||
                          h.status === 'canceled' ||
                          toggleQuestions.isPending
                        }
                        onCheckedChange={(checked) =>
                          toggleQuestions.mutate({ id: h.id, questionsOpen: checked })
                        }
                      />
                      <span className="sr-only">
                        Recebimento de perguntas de {h.title}
                      </span>
                      {h.questionsOpen ? 'Aberto' : 'Fechado'}
                    </label>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Ações da audiência ${h.title}`}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {canWrite && h.status === 'scheduled' && (
                          <DropdownMenuItem
                            onClick={() => transition.mutate({ id: h.id, action: 'open' })}
                          >
                            <Megaphone /> Abrir audiência
                          </DropdownMenuItem>
                        )}
                        {canWrite && h.status === 'open' && (
                          <DropdownMenuItem onClick={() => setCloseTarget(h)}>
                            <CheckCircle2 /> Encerrar…
                          </DropdownMenuItem>
                        )}
                        {canWrite && (h.status === 'scheduled' || h.status === 'open') && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              onClick={() => {
                                setCancelReason('')
                                setCancelTarget(h)
                              }}
                            >
                              <Ban /> Cancelar…
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Dialog criar */}
      {createOpen && <HearingFormDialog onClose={() => setCreateOpen(false)} />}

      {/* Confirmação encerrar */}
      <AlertDialog open={!!closeTarget} onOpenChange={(open) => !open && setCloseTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Encerrar audiência?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground">{closeTarget?.title}</strong> será marcada como
              Encerrada e o recebimento de novas perguntas será fechado. As perguntas já recebidas
              continuam disponíveis para moderação e resposta.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => closeTarget && transition.mutate({ id: closeTarget.id, action: 'close' })}
            >
              Encerrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancelamento com justificativa */}
      <AlertDialog open={!!cancelTarget} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar audiência?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong className="text-foreground">{cancelTarget?.title}</strong> será cancelada
              definitivamente (ação terminal, auditada e com justificativa obrigatória). A
              audiência sai do portal público.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="cancel-reason">Justificativa (mín. 10 caracteres)</Label>
            <Textarea
              id="cancel-reason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Ex.: Ausência de quórum de convidados; reagendamento para nova data."
              aria-invalid={cancelReason.trim().length < 10}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter audiência</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={cancelReason.trim().length < 10 || transition.isPending}
              onClick={() =>
                cancelTarget &&
                transition.mutate({
                  id: cancelTarget.id,
                  action: 'cancel',
                  justification: cancelReason.trim(),
                })
              }
            >
              Cancelar definitivamente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── Tab 3: Moderação ───────────────────────────────────────────────────────

/** Dialog de resposta à pergunta aprovada. */
function AnswerDialog({ question, onClose }: { question: QuestionRow; onClose: () => void }) {
  const qc = useQueryClient()
  const [answer, setAnswer] = useState('')

  const answerMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ question: QuestionRow }>(`/api/v1/hearing-questions/${question.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'answer', answer: answer.trim() }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['hearing-questions'] })
      void qc.invalidateQueries({ queryKey: ['hearings'] })
      toast.success('Resposta registrada', {
        description: 'A pergunta passa a exibir a resposta no portal público.',
      })
      onClose()
    },
    onError: (err) => toast.error('Falha ao responder', { description: problemMessage(err) }),
  })

  const answerValid = answer.trim().length >= 5 && answer.trim().length <= 2000

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Reply className="size-5 text-primary" /> Responder pergunta
          </DialogTitle>
          <DialogDescription>
            De <strong className="text-foreground">{question.authorName}</strong>
            {question.district ? ` (${question.district})` : ''} — a resposta fica pública junto à
            pergunta no portal.
          </DialogDescription>
        </DialogHeader>
        <blockquote className="whitespace-pre-wrap rounded-lg border-l-2 border-primary bg-muted/40 p-3 text-sm">
          {question.question}
        </blockquote>
        <div className="space-y-1.5">
          <Label htmlFor="answer-text">Resposta (5 a 2000 caracteres)</Label>
          <Textarea
            id="answer-text"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Resposta oficial da Mesa/relatoria…"
            className="min-h-32"
            aria-invalid={!answerValid}
            maxLength={2000}
          />
          <p className="text-right text-xs text-muted-foreground">{answer.length}/2000</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={() => answerMutation.mutate()}
            disabled={answerMutation.isPending || !answerValid}
          >
            {answerMutation.isPending && <RefreshCw className="animate-spin" />} Registrar resposta
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ModerationTab({
  hearings,
  isLoading,
  canModerate,
}: {
  hearings: HearingRow[]
  isLoading: boolean
  canModerate: boolean
}) {
  const qc = useQueryClient()
  const [hearingId, setHearingId] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState('pending')
  const [answerTarget, setAnswerTarget] = useState<QuestionRow | null>(null)

  // Pré-seleciona a primeira audiência com pendências (ou a primeira).
  const suggested =
    hearings.find((h) => h.questions.pending > 0) ?? hearings[0] ?? null
  const selectedHearingId = hearingId || suggested?.id || ''
  const selectedHearing = hearings.find((h) => h.id === selectedHearingId) ?? null

  const questionsQ = useQuery({
    queryKey: ['hearing-questions', selectedHearingId],
    queryFn: () =>
      apiFetch<{ hearing: HearingRow; questions: QuestionRow[] }>(
        `/api/v1/hearings/${selectedHearingId}/questions`
      ),
    enabled: !!selectedHearingId,
  })
  const questions = (questionsQ.data?.questions ?? []).filter(
    (q) => statusFilter === 'all' || q.status === statusFilter
  )

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['hearing-questions'] })
    void qc.invalidateQueries({ queryKey: ['hearings'] })
  }

  const moderate = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approve' | 'reject' }) =>
      apiFetch<{ question: QuestionRow }>(`/api/v1/hearing-questions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action }),
      }),
    onSuccess: (data) => {
      invalidate()
      toast.success(
        data.question.status === 'approved' ? 'Pergunta aprovada' : 'Pergunta rejeitada',
        {
          description:
            data.question.status === 'approved'
              ? 'A pergunta agora aparece no portal público (sem o e-mail do autor).'
              : 'A pergunta foi rejeitada e não será publicada no portal.',
        }
      )
    },
    onError: (err) => toast.error('Falha na moderação', { description: problemMessage(err) }),
  })

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full max-w-md rounded-lg" />
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-32 w-full rounded-xl" />
        ))}
      </div>
    )
  }

  if (hearings.length === 0) {
    return (
      <EmptyState
        icon={<MessagesSquare />}
        title="Sem audiências para moderar"
        description="Agende uma audiência pública na aba Audiências para começar a receber perguntas do cidadão."
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Select value={selectedHearingId} onValueChange={setHearingId}>
          <SelectTrigger className="sm:w-80" aria-label="Selecionar audiência">
            <SelectValue placeholder="Selecione a audiência" />
          </SelectTrigger>
          <SelectContent>
            {hearings.map((h) => (
              <SelectItem key={h.id} value={h.id}>
                {h.title} {h.questions.pending > 0 ? `(${h.questions.pending} pendente(s))` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="sm:w-44" aria-label="Filtrar perguntas por situação">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as situações</SelectItem>
            {QUESTION_STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedHearing && (
          <p className="text-xs text-muted-foreground sm:ml-auto">
            {selectedHearing.statusLabel} · recebimento{' '}
            {selectedHearing.questionsOpen ? 'aberto' : 'fechado'} ·{' '}
            {selectedHearing.questions.pending} pendente(s) / {selectedHearing.questions.answered}{' '}
            respondida(s)
          </p>
        )}
      </div>

      {questionsQ.isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
      ) : !selectedHearingId ? null : questions.length === 0 ? (
        <EmptyState
          icon={<MessageCircleQuestion />}
          title="Nenhuma pergunta nesta situação"
          description={
            statusFilter === 'pending'
              ? 'Novas perguntas enviadas pelo portal aparecem aqui para moderação.'
              : 'Ajuste o filtro de situação para ver outras perguntas.'
          }
        />
      ) : (
        <div className="max-h-[62vh] space-y-3 overflow-y-auto custom-scroll pr-1">
          {questions.map((q) => (
            <article
              key={q.id}
              className="rounded-xl border bg-card p-4"
              aria-label={`Pergunta de ${q.authorName}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {q.authorName}
                    {q.district && (
                      <span className="font-normal text-muted-foreground"> · {q.district}</span>
                    )}
                  </p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <Mail className="size-3 shrink-0" aria-hidden />
                    <span className="truncate">{q.authorEmail ?? 'sem e-mail'}</span>
                    <span className="italic">(uso interno — nunca exibido no portal)</span>
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <QuestionStatusBadge status={q.status} />
                  <span className="text-[11px] text-muted-foreground">{fmtDateTime(q.createdAt)}</span>
                </div>
              </div>

              <p className="mt-3 whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-sm leading-relaxed">
                {q.question}
              </p>

              {q.status === 'rejected' && q.moderatedBy && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Rejeitada por <strong>{q.moderatedBy}</strong> — não aparece no portal.
                </p>
              )}

              {q.answer && (
                <div className="mt-3 rounded-lg border-l-2 border-primary bg-primary/5 p-3 text-sm">
                  <p className="font-semibold">
                    Resposta oficial {q.answeredAt ? `· ${fmtDateTime(q.answeredAt)}` : ''}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap leading-relaxed">{q.answer}</p>
                </div>
              )}

              {canModerate && (q.status === 'pending' || q.status === 'approved') && (
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  {q.status === 'pending' && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => moderate.mutate({ id: q.id, action: 'approve' })}
                        disabled={moderate.isPending}
                      >
                        <CheckCircle2 className="size-3.5" /> Aprovar
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => moderate.mutate({ id: q.id, action: 'reject' })}
                        disabled={moderate.isPending}
                      >
                        <XCircle className="size-3.5" /> Rejeitar
                      </Button>
                    </>
                  )}
                  {q.status === 'approved' && (
                    <Button size="sm" onClick={() => setAnswerTarget(q)}>
                      <Reply className="size-3.5" /> Responder
                    </Button>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {answerTarget && (
        <AnswerDialog question={answerTarget} onClose={() => setAnswerTarget(null)} />
      )}
    </div>
  )
}

// ─── Tab 4: Assinaturas (Fase 19 — exige subscription.manage) ───────────────

type SubscriptionRow = {
  id: string
  email: string
  targetKind: SubscriptionTargetKind
  targetId: string
  targetLabel: string | null
  confirmedAt: string | null
  revokedAt: string | null
  createdAt: string
  /** Presente apenas em pendentes ativas — copiar link de confirmação (sandbox). */
  confirmToken: string | null
}

type SubscriptionsResponse = {
  subscriptions: SubscriptionRow[]
  stats: SubscriptionStats
}

type MailQueueResponse = {
  configured: boolean
  stats: { pending: number; sent: number; canceled: number; dead: number }
  deliveries: Array<{ id: string; subscriptionId: string; status: string; attempts: number;
    nextAttemptAt: string | null; lastErrorCode: string | null; createdAt: string }>
}

function SubscriptionStatusBadge({ row }: { row: SubscriptionRow }) {
  if (row.revokedAt)
    return (
      <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-300">
        <XCircle className="size-3" /> Revogada
      </Badge>
    )
  if (row.confirmedAt)
    return (
      <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
        <MailCheck className="size-3" /> Confirmada
      </Badge>
    )
  return (
    <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300">
      <Clock className="size-3" /> Pendente
    </Badge>
  )
}

/** Assinantes do cidadão (double opt-in) com stats, cópia de link e revogação. */
function SubscriptionsTab() {
  const qc = useQueryClient()
  const [revokeTarget, setRevokeTarget] = useState<SubscriptionRow | null>(null)

  const subsQ = useQuery({
    queryKey: ['citizen-subscriptions'],
    queryFn: () => apiFetch<SubscriptionsResponse>('/api/v1/subscriptions'),
  })
  const mailQ = useQuery({
    queryKey: ['mail-deliveries'],
    queryFn: () => apiFetch<MailQueueResponse>('/api/v1/mail-deliveries'),
  })
  const rows = subsQ.data?.subscriptions ?? []
  const stats = subsQ.data?.stats

  const requeue = useMutation({
    mutationFn: (id: string) => apiFetch<{ ok: boolean }>('/api/v1/mail-deliveries', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }),
    }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['mail-deliveries'] }); toast.success('Entrega recolocada na fila') },
    onError: (err) => toast.error('Não foi possível retomar a entrega', { description: problemMessage(err) }),
  })

  const revoke = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: boolean; message: string; subscription: SubscriptionRow }>(
        `/api/v1/subscriptions?id=${encodeURIComponent(id)}`,
        { method: 'DELETE' }
      ),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['citizen-subscriptions'] })
      toast.success('Assinatura revogada', { description: data.message })
      setRevokeTarget(null)
    },
    onError: (err) => {
      toast.error('Falha ao revogar assinatura', { description: problemMessage(err) })
      setRevokeTarget(null)
    },
  })

  const copyConfirmLink = (row: SubscriptionRow) => {
    const url = `${window.location.origin}/api/v1/public/subscriptions/confirm?token=${row.confirmToken}`
    void navigator.clipboard
      .writeText(url)
      .then(() =>
        toast.success('Link de confirmação copiado', {
          description:
            'No sandbox o link é copiado para demonstrar o double opt-in; em produção o token chega apenas por e-mail.',
        })
      )
      .catch(() =>
        toast.error('Não foi possível copiar', {
          description: 'O navegador bloqueou a área de transferência.',
        })
      )
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Cidadãos que acompanham matérias, sessões e audiências por e-mail, com dupla confirmação
          (double opt-in). Assinaturas pendentes aguardam o clique no link de confirmação; o envio exige SMTP institucional ativo.
          revogação é auditada e não apaga o histórico (LGPD).
        </p>

        <Card className="py-4">
          <CardContent className="space-y-2 px-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong>Correio de confirmação</strong>
              <Button size="sm" variant="outline" onClick={() => void mailQ.refetch()} aria-label="Atualizar fila de e-mails">
                <RefreshCw className="size-3.5" /> Atualizar
              </Button>
            </div>
            {mailQ.isError ? <p className="text-destructive">{problemMessage(mailQ.error)}</p> : mailQ.data ? (
              <>
                <p className="text-muted-foreground">
                  {mailQ.data.configured ? 'SMTP configurado' : 'SMTP ainda não configurado'} · {mailQ.data.stats.pending} pendentes · {mailQ.data.stats.sent} enviados · {mailQ.data.stats.dead} esgotados · {mailQ.data.stats.canceled} cancelados
                </p>
                {mailQ.data.stats.dead > 0 && <p className="text-amber-700 dark:text-amber-300">Entregas esgotadas exigem verificação do transporte antes de retomar. Reprocessar não confirma a assinatura automaticamente.</p>}
                {mailQ.data.deliveries.filter((delivery) => delivery.status === 'dead').map((delivery) => {
                  const subscriber = rows.find((row) => row.id === delivery.subscriptionId)
                  return <div key={delivery.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
                    <span>{subscriber?.email ?? 'Assinatura não encontrada'} · {delivery.attempts} tentativas · {delivery.lastErrorCode ?? 'falha de entrega'}</span>
                    <Button size="sm" variant="outline" disabled={requeue.isPending || !mailQ.data.configured || !subscriber || !!subscriber.confirmedAt || !!subscriber.revokedAt}
                      onClick={() => requeue.mutate(delivery.id)}>Retomar entrega</Button>
                  </div>
                })}
              </>
            ) : <p className="text-muted-foreground">Consultando fila…</p>}
          </CardContent>
        </Card>

        {/* Stats */}
        {stats ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="py-4">
              <CardContent className="px-4">
                <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Bell className="size-3.5" /> Total no registro
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums">{stats.total}</p>
                <p className="text-[11px] text-muted-foreground">inclui revogadas</p>
              </CardContent>
            </Card>
            <Card className="py-4">
              <CardContent className="px-4">
                <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <MailCheck className="size-3.5" /> Confirmadas
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {stats.confirmed}
                </p>
                <p className="text-[11px] text-muted-foreground">ativas, recebem novidades</p>
              </CardContent>
            </Card>
            <Card className="py-4">
              <CardContent className="px-4">
                <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Clock className="size-3.5" /> Pendentes
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
                  {stats.pending}
                </p>
                <p className="text-[11px] text-muted-foreground">aguardando confirmação por e-mail</p>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        )}

        {/* Tabela de assinantes */}
        {subsQ.isLoading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : subsQ.isError ? (
          <EmptyState
            icon={<Bell />}
            title="Não foi possível carregar as assinaturas"
            description={problemMessage(subsQ.error)}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Bell />}
            title="Nenhum assinante ainda"
            description="Assinaturas aparecem aqui quando cidadãos usam a aba “Acompanhar” do portal público."
          />
        ) : (
          <div className="max-h-[62vh] overflow-auto custom-scroll rounded-xl border bg-card">
            <Table className="min-w-[52rem]">
              <caption className="sr-only">Assinaturas de acompanhamento do cidadão</caption>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  <TableHead className="w-56">E-mail</TableHead>
                  <TableHead>Acompanha</TableHead>
                  <TableHead className="w-32">Situação</TableHead>
                  <TableHead className="hidden w-40 md:table-cell">Datas</TableHead>
                  <TableHead className="w-56 text-right">
                    <span className="sr-only">Ações</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} className={cn(row.revokedAt && 'opacity-75')}>
                    <TableCell>
                      <span className="flex items-center gap-1.5 font-medium">
                        <Mail className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        <span className="truncate" title={row.email}>
                          {row.email}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell>
                      <p className="max-w-sm truncate font-medium" title={row.targetLabel ?? row.targetId}>
                        {row.targetLabel ?? '—'}
                      </p>
                      <Badge variant="secondary" className="mt-0.5 text-[10px]">
                        {SUBSCRIPTION_TARGET_LABEL[row.targetKind]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <SubscriptionStatusBadge row={row} />
                    </TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                      <p>Registrada em {fmtDate(row.createdAt)}</p>
                      {row.confirmedAt && <p>Confirmada em {fmtDate(row.confirmedAt)}</p>}
                      {row.revokedAt && <p>Revogada em {fmtDate(row.revokedAt)}</p>}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1.5">
                        {row.confirmToken && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8"
                                onClick={() => copyConfirmLink(row)}
                                aria-label={`Copiar link de confirmação de ${row.email}`}
                              >
                                <Link2 className="size-3.5" /> Copiar link
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-64">
                              No sandbox o link de confirmação é copiado aqui para demonstrar a
                              dupla confirmação; em produção o token é enviado apenas por e-mail ao
                              cidadão.
                            </TooltipContent>
                          </Tooltip>
                        )}
                        {!row.revokedAt && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 text-destructive hover:text-destructive"
                            onClick={() => setRevokeTarget(row)}
                            aria-label={`Revogar assinatura de ${row.email}`}
                          >
                            <Ban className="size-3.5" /> Revogar
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Confirmação de revogação */}
        <AlertDialog open={!!revokeTarget} onOpenChange={(open) => !open && setRevokeTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Revogar assinatura?</AlertDialogTitle>
              <AlertDialogDescription>
                <strong className="text-foreground">{revokeTarget?.email}</strong> deixará de
                receber novidades de{' '}
                <strong className="text-foreground">{revokeTarget?.targetLabel ?? '—'}</strong>. A
                ação é auditada e o registro permanece (LGPD); o cidadão pode assinar novamente —
                uma nova confirmação por e-mail será exigida.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => revokeTarget && revoke.mutate(revokeTarget.id)}
                disabled={revoke.isPending}
                className="bg-destructive text-white hover:bg-destructive/90"
              >
                {revoke.isPending && <RefreshCw className="animate-spin" />} Revogar assinatura
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  )
}

export default function PublicationsModule() {
  const can = useApp((s) => s.can)
  const canWritePublications = can('publication.write')
  const canWriteHearings = can('hearing.write')
  const canManageSubscriptions = can('subscription.manage')
  const [tab, setTab] = useState('publications')

  const hearingsQ = useQuery({
    queryKey: ['hearings'],
    queryFn: () => apiFetch<{ hearings: HearingRow[] }>('/api/v1/hearings'),
  })
  const hearings = hearingsQ.data?.hearings ?? []
  const pendingQuestions = hearings.reduce((acc, h) => acc + h.questions.pending, 0)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Publicações e Audiências"
        description="Diário eletrônico numerado (atas, decretos, resoluções, portarias e editais) com revogação auditada e audiências públicas com participação popular moderada."
        icon={<Newspaper />}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto w-full flex-wrap justify-start">
          <TabsTrigger value="publications">
            <Newspaper className="size-4" /> Publicações
          </TabsTrigger>
          <TabsTrigger value="hearings">
            <CalendarClock className="size-4" /> Audiências
          </TabsTrigger>
          <TabsTrigger value="moderation" className="gap-1.5">
            <ShieldCheck className="size-4" /> Moderação
            {pendingQuestions > 0 && (
              <Badge className="ml-1 bg-rose-600 text-white">{pendingQuestions}</Badge>
            )}
          </TabsTrigger>
          {canManageSubscriptions && (
            <TabsTrigger value="subscriptions" className="gap-1.5">
              <Bell className="size-4" /> Assinaturas
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="publications" className="mt-4">
          <PublicationsTab canWrite={canWritePublications} />
        </TabsContent>
        <TabsContent value="hearings" className="mt-4">
          <HearingsTab
            hearings={hearings}
            isLoading={hearingsQ.isLoading}
            canWrite={canWriteHearings}
          />
        </TabsContent>
        <TabsContent value="moderation" className="mt-4">
          <ModerationTab
            hearings={hearings}
            isLoading={hearingsQ.isLoading}
            canModerate={canWriteHearings}
          />
        </TabsContent>
        {canManageSubscriptions && (
          <TabsContent value="subscriptions" className="mt-4">
            <SubscriptionsTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
