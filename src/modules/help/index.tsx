'use client'

/**
 * Fase 15 — Central de Ajuda e Documentação In-App (ADR-016).
 *
 * Conteúdo 100% servido por GET /api/v1/help (nada hardcoded aqui além de
 * rótulos de navegação). Busca local unificada no topo filtra guias + FAQ +
 * glossário simultaneamente, com contagem de matches por aba.
 *
 * Abas: Primeiros passos (guia por papel + chips de módulos clicáveis) ·
 * Glossário (agrupado por inicial) · Perguntas frequentes (accordion) ·
 * Atalhos (tabela) · Novidades (timeline 0.1.0→0.10.0) · Sobre (stack +
 * índice da documentação).
 */
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ArrowUpRight,
  BookOpen,
  CircleHelp,
  History,
  Keyboard,
  MessageCircleQuestion,
  RefreshCw,
  Search,
  SearchX,
  Sparkles,
  ThumbsUp,
} from 'lucide-react'

import { useApp, type ModuleId } from '@/lib/store'
import { growthApi } from '@/lib/api-client'
import {
  ROLE_LABEL,
  type HelpContent,
  type HelpGuide,
  type Role,
} from '@/lib/contracts'
import { EmptyState, PageHeader } from '@/components/app/page-header'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

// ─── Fetch local (api-client.ts intocável — padrão publications) ────────────

type Problem = {
  title?: string
  detail?: string
  status?: number
  code?: string
  errors?: Record<string, string[]>
}

class HelpApiError extends Error {
  constructor(public readonly problem: Problem) {
    super(problem.detail || problem.title || 'Erro na requisição.')
    this.name = 'HelpApiError'
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
  if (!res.ok) throw new HelpApiError((body ?? {}) as Problem)
  return body as T
}

function problemMessage(err: unknown): string {
  if (err instanceof HelpApiError) {
    const fields = err.problem.errors
      ? Object.values(err.problem.errors).flat().filter(Boolean).join(' ')
      : ''
    return [err.problem.detail, fields].filter(Boolean).join(' — ')
  }
  return err instanceof Error ? err.message : 'Erro inesperado.'
}

// ─── Constantes de UI ───────────────────────────────────────────────────────

/** Ordem dos papéis no seletor (o conteúdo vem da API). */
const GUIDE_ROLES: Role[] = [
  'tenant_admin',
  'legislative_admin',
  'session_operator',
  'presiding_officer',
  'parliamentarian',
  'auditor',
  'platform_owner',
]

/** Rótulos dos módulos citados nos guias (chips clicáveis → setModule). */
const MODULE_LABEL: Record<string, string> = {
  dashboard: 'Painel',
  agenda: 'Agenda Legislativa',
  sessions: 'Sessões',
  plenary: 'Mesa do Plenário',
  display: 'Telão',
  pwa: 'App do Parlamentar',
  workflow: 'Protocolo e Tramitação',
  parliamentarians: 'Parlamentares',
  matters: 'Matérias',
  structure: 'Estrutura Institucional',
  audit: 'Auditoria',
  reports: 'Relatórios',
  publications: 'Publicações e Audiências',
  analytics: 'Analytics',
  portal: 'Portal Público',
  webhooks: 'Webhooks',
  users: 'Usuários',
  templates: 'Modelos de Documento',
  settings: 'Configurações',
  console: 'Console da Plataforma',
  migration: 'Migração de Dados',
  help: 'Central de Ajuda',
}

const VALID_MODULES = new Set(Object.keys(MODULE_LABEL))

/** Busca sem acentos/caixa (pt-BR): "tramitacao" encontra "Tramitação". */
function norm(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function matches(haystacks: string[], query: string): boolean {
  const q = norm(query.trim())
  if (!q) return true
  return haystacks.some((h) => norm(h).includes(q))
}

function guideMatches(g: HelpGuide, query: string): boolean {
  return matches(
    [g.title, g.description, ...g.steps.flatMap((s) => [s.title, s.body])],
    query
  )
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('pt-BR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d)
}

// ─── Skeletons ──────────────────────────────────────────────────────────────

function HelpSkeleton() {
  return (
    <div className="space-y-6">
      <div className="max-w-xl space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-10 w-full" />
      </div>
      <Skeleton className="h-10 w-full max-w-2xl" />
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    </div>
  )
}

// ─── Subcomponentes ─────────────────────────────────────────────────────────

function StepList({ guide, showRole }: { guide: HelpGuide; showRole: boolean }) {
  const setModule = useApp((s) => s.setModule)
  return (
    <section className="space-y-4" aria-label={`Guia: ${guide.title}`}>
      {showRole && (
        <Badge variant="outline" className="text-xs">
          {ROLE_LABEL[guide.role] ?? guide.role}
        </Badge>
      )}
      <div className="space-y-1.5">
        <h2 className="text-base font-semibold sm:text-lg">{guide.title}</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">{guide.description}</p>
      </div>
      <ol className="space-y-3">
        {guide.steps.map((step, i) => (
          <li key={step.title}>
            <Card className="p-4 sm:p-5">
              <div className="flex gap-4">
                <div
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
                  aria-hidden="true"
                >
                  {i + 1}
                </div>
                <div className="min-w-0 space-y-1">
                  <h3 className="text-sm font-medium sm:text-base">{step.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ol>
      {guide.modules.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Módulos citados neste guia
          </p>
          <div className="flex flex-wrap gap-2">
            {guide.modules.map((m) => {
              const valid = VALID_MODULES.has(m)
              return (
                <button
                  key={m}
                  type="button"
                  disabled={!valid}
                  onClick={() => valid && setModule(m as ModuleId)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    valid
                      ? 'cursor-pointer hover:border-primary/40 hover:bg-primary/10 hover:text-primary'
                      : 'cursor-not-allowed opacity-60'
                  )}
                  title={valid ? `Ir para ${MODULE_LABEL[m]}` : 'Módulo desconhecido'}
                >
                  <ArrowUpRight className="size-3" aria-hidden="true" />
                  {MODULE_LABEL[m] ?? m}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </section>
  )
}

function NoResults({ query }: { query: string }) {
  return (
    <EmptyState
      icon={<SearchX />}
      title="Nenhum resultado"
      description={`Nada encontrado para “${query.trim()}” nesta aba. Tente outro termo ou veja as demais abas — a contagem aparece no nome de cada aba.`}
    />
  )
}

// ─── Widget NPS (Onda 5 / Fase 24 — ADR-025) ─────────────────────────────────────

/** Grupo do score: 9–10 promotores (verde) · 7–8 neutros · 0–6 detratores (âmbar). */
function npsGroup(score: number): 'promoter' | 'neutral' | 'detractor' {
  if (score >= 9) return 'promoter'
  if (score >= 7) return 'neutral'
  return 'detractor'
}

const NPS_BUTTON_TONE: Record<'promoter' | 'neutral' | 'detractor', { base: string; selected: string }> = {
  promoter: {
    base: 'border-emerald-600/40 text-emerald-700 hover:border-emerald-600 hover:bg-emerald-600/10 dark:text-emerald-400',
    selected: 'border-emerald-600 bg-emerald-700 text-white hover:bg-emerald-700',
  },
  neutral: {
    base: 'border-muted-foreground/30 text-foreground hover:bg-accent',
    selected: 'border-primary bg-primary text-primary-foreground hover:bg-primary',
  },
  detractor: {
    base: 'border-amber-600/40 text-amber-700 hover:border-amber-600 hover:bg-amber-600/10 dark:text-amber-400',
    selected: 'border-amber-600 bg-amber-700 text-white hover:bg-amber-700',
  },
}

/**
 * “Como está sua experiência com o Legis SaaS?” — 11 botões 0–10 + comentário
 * opcional. Idempotente por (usuário, versão): reenvio ATUALIZA a própria
 * resposta (nunca duplica). Se já respondeu, inicia no estado respondido com
 * opção de editar. A consolidação sai apenas agregada em /platform/metrics.
 */
function NpsWidget() {
  const qc = useQueryClient()
  const [picked, setPicked] = useState<number | null>(null)
  const [comment, setComment] = useState('')
  const [editing, setEditing] = useState(false)

  const myNpsQ = useQuery({
    queryKey: ['help', 'my-nps'],
    queryFn: () => growthApi.myNps(),
  })

  const submit = useMutation({
    mutationFn: () => growthApi.submitNps(picked ?? 0, comment.trim() || undefined),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['help', 'my-nps'] })
      toast.success('Obrigado pela sua avaliação!', {
        description:
          data.score !== null
            ? `Você avaliou ${data.score}/10 na versão ${data.version}. Pode editar a resposta quando quiser.`
            : 'Resposta registrada.',
      })
      setEditing(false)
      setPicked(null)
      setComment('')
    },
  })

  const responded = myNpsQ.data?.score ?? null
  const alreadyAnswered = responded !== null && !editing
  const canSubmit = picked !== null && !submit.isPending

  return (
    <Card className="space-y-4 p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
        >
          <ThumbsUp className="size-4.5" />
        </span>
        <div>
          <h2 className="text-base font-semibold">Como está sua experiência com o edocBR Plenário?</h2>
          <p className="text-sm text-muted-foreground">
            De 0 (muito insatisfeito) a 10 (muito satisfeito) — a nota e o comentário são seus e
            ficam associados à sua conta nesta versão; o resultado só aparece de forma agregada.
          </p>
        </div>
      </div>

      {myNpsQ.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : alreadyAnswered ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-600/30 bg-emerald-600/10 px-4 py-3">
          <p className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
            Você avaliou <span className="text-lg font-bold tabular-nums">{responded}/10</span> —
            obrigado!
            {myNpsQ.data?.comment && (
              <span className="block text-xs font-normal text-muted-foreground">
                “{myNpsQ.data.comment}”
              </span>
            )}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => {
              setEditing(true)
              setPicked(responded)
              setComment(myNpsQ.data?.comment ?? '')
            }}
          >
            Editar resposta
          </Button>
        </div>
      ) : (
        <div className="space-y-4" aria-label="Avaliação de 0 a 10">
          <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-11">
            {Array.from({ length: 11 }, (_, score) => {
              const tone = NPS_BUTTON_TONE[npsGroup(score)]
              const selected = picked === score
              return (
                <button
                  key={score}
                  type="button"
                  aria-label={`Nota ${score}${score >= 9 ? ' (ótimo)' : score <= 6 ? ' (insatisfeito)' : ''}`}
                  aria-pressed={selected}
                  onClick={() => setPicked(score)}
                  className={cn(
                    'h-10 rounded-md border text-sm font-semibold tabular-nums transition-colors',
                    selected ? tone.selected : tone.base
                  )}
                >
                  {score}
                </button>
              )
            })}
          </div>
          <div className="flex justify-between text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <span>0–6 · precisa melhorar</span>
            <span className="hidden sm:inline">7–8 · neutro</span>
            <span>9–10 · excelente</span>
          </div>

          {picked !== null && (
            <div className="space-y-2">
              <Label htmlFor="nps-comment" className="text-sm text-muted-foreground">
                Quer deixar um comentário? (opcional, máx. 300 caracteres)
              </Label>
              <Textarea
                id="nps-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                maxLength={300}
                placeholder={
                  picked >= 9
                    ? 'O que mais te agradou?'
                    : picked <= 6
                      ? 'O que podemos melhorar?'
                      : 'Alguma observação?'
                }
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">{comment.length}/300</p>
                <Button onClick={() => submit.mutate()} disabled={!canSubmit}>
                  {submit.isPending && <RefreshCw className="animate-spin" />}
                  {editing ? 'Atualizar avaliação' : 'Enviar avaliação'}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

// ─── Módulo ─────────────────────────────────────────────────────────────────

export default function HelpModule() {
  const actor = useApp((s) => s.actor)
  const [query, setQuery] = useState('')
  const [roleOverride, setRoleOverride] = useState<Role | null>(null)

  const helpQ = useQuery({
    queryKey: ['help'],
    queryFn: () => apiFetch<HelpContent>('/api/v1/help'),
    staleTime: 5 * 60_000,
    retry: 1,
  })

  useEffect(() => {
    if (helpQ.isError) {
      toast.error('Falha ao carregar a Central de Ajuda', {
        description: problemMessage(helpQ.error),
      })
    }
  }, [helpQ.isError, helpQ.error])

  // Papel do guia: escolha explícita → papel do ator → fallback tenant_admin.
  const effectiveRole: Role =
    roleOverride ??
    (actor && GUIDE_ROLES.includes(actor.role) ? actor.role : 'tenant_admin')

  const data = helpQ.data
  const searching = query.trim().length > 0

  const matchedGuides = useMemo(
    () => (data ? (searching ? data.guides.filter((g) => guideMatches(g, query)) : []) : []),
    [data, searching, query]
  )
  const selectedGuide = useMemo(
    () => data?.guides.find((g) => g.role === effectiveRole) ?? null,
    [data, effectiveRole]
  )
  const filteredGlossary = useMemo(
    () =>
      data
        ? data.glossary.filter((t) => matches([t.term, t.definition], query))
        : [],
    [data, query]
  )
  const filteredFaq = useMemo(
    () => (data ? data.faq.filter((f) => matches([f.question, f.answer], query)) : []),
    [data, query]
  )
  const glossaryGroups = useMemo(() => {
    const map = new Map<string, typeof filteredGlossary>()
    for (const term of filteredGlossary) {
      const letter = norm(term.term.charAt(0)).toUpperCase()
      const bucket = map.get(letter) ?? []
      bucket.push(term)
      map.set(letter, bucket)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'))
  }, [filteredGlossary])

  const guidesCount = searching ? matchedGuides.length : selectedGuide ? 1 : 0
  const withCount = (label: string, count: number) =>
    searching ? `${label} (${count})` : label

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<CircleHelp />}
        title="Central de Ajuda"
        description="Guias por perfil, glossário legislativo, perguntas frequentes, atalhos de teclado e novidades do produto — sem sair do sistema."
      />

      {helpQ.isLoading ? (
        <HelpSkeleton />
      ) : helpQ.isError || !data ? (
        <EmptyState
          icon={<SearchX />}
          title="Não foi possível carregar a Central de Ajuda"
          description="Verifique sua conexão e tente novamente. O conteúdo é servido por /api/v1/help para qualquer perfil autenticado."
          action={
            <button
              type="button"
              onClick={() => helpQ.refetch()}
              className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Tentar novamente
            </button>
          }
        />
      ) : (
        <>
          {/* Busca local unificada — filtra guias, FAQ e glossário */}
          <div className="max-w-xl">
            <Label htmlFor="help-search" className="sr-only">
              Buscar na Central de Ajuda
            </Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="help-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar no glossário, perguntas e guias…"
                className="pl-9"
                autoComplete="off"
              />
            </div>
            {searching && (
              <p className="mt-1.5 text-xs text-muted-foreground" role="status">
                {guidesCount + filteredFaq.length + filteredGlossary.length} resultado(s) em
                guias ({guidesCount}), perguntas ({filteredFaq.length}) e glossário (
                {filteredGlossary.length}). Atalhos, novidades e Sobre não são filtrados.
              </p>
            )}
          </div>

          <Tabs defaultValue="start" className="gap-4">
            <TabsList className="h-auto w-full flex-wrap justify-start sm:w-auto">
              <TabsTrigger value="start">
                <Sparkles className="size-4" aria-hidden="true" />
                {withCount('Primeiros passos', guidesCount)}
              </TabsTrigger>
              <TabsTrigger value="glossary">
                <BookOpen className="size-4" aria-hidden="true" />
                {withCount('Glossário', filteredGlossary.length)}
              </TabsTrigger>
              <TabsTrigger value="faq">
                <MessageCircleQuestion className="size-4" aria-hidden="true" />
                {withCount('Perguntas frequentes', filteredFaq.length)}
              </TabsTrigger>
              <TabsTrigger value="shortcuts">
                <Keyboard className="size-4" aria-hidden="true" />
                Atalhos
              </TabsTrigger>
              <TabsTrigger value="changelog">
                <History className="size-4" aria-hidden="true" />
                Novidades
              </TabsTrigger>
              <TabsTrigger value="about">
                <CircleHelp className="size-4" aria-hidden="true" />
                Sobre
              </TabsTrigger>
            </TabsList>

            {/* 1 · Primeiros passos */}
            <TabsContent value="start" className="space-y-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Label htmlFor="help-role" className="text-sm text-muted-foreground">
                  Ver o guia do papel:
                </Label>
                <div className="w-full sm:w-72">
                  <Select
                    value={effectiveRole}
                    onValueChange={(v) => setRoleOverride(v as Role)}
                  >
                    <SelectTrigger id="help-role" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {GUIDE_ROLES.map((r) => (
                        <SelectItem key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {searching ? (
                matchedGuides.length > 0 ? (
                  <div className="space-y-8">
                    {matchedGuides.map((g) => (
                      <StepList key={g.role} guide={g} showRole />
                    ))}
                  </div>
                ) : (
                  <NoResults query={query} />
                )
              ) : selectedGuide ? (
                <StepList guide={selectedGuide} showRole={false} />
              ) : (
                <EmptyState
                  icon={<CircleHelp />}
                  title="Guia em preparação"
                  description={`Ainda não há guia de primeiros passos para ${ROLE_LABEL[effectiveRole]}.`}
                />
              )}
            </TabsContent>

            {/* 2 · Glossário */}
            <TabsContent value="glossary">
              {glossaryGroups.length > 0 ? (
                <div className="max-h-[62vh] space-y-6 overflow-y-auto custom-scroll pr-1">
                  {glossaryGroups.map(([letter, terms]) => (
                    <section key={letter} aria-label={`Termos com a letra ${letter}`}>
                      <h3 className="flex items-center gap-3 text-sm font-semibold text-muted-foreground">
                        {letter}
                        <Separator className="flex-1" />
                      </h3>
                      <dl className="mt-3 space-y-4">
                        {terms.map((t) => (
                          <div key={t.term} className="grid gap-0.5">
                            <dt className="text-sm font-semibold">{t.term}</dt>
                            <dd className="text-sm leading-relaxed text-muted-foreground">
                              {t.definition}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </section>
                  ))}
                </div>
              ) : (
                <NoResults query={query} />
              )}
            </TabsContent>

            {/* 3 · Perguntas frequentes */}
            <TabsContent value="faq">
              {filteredFaq.length > 0 ? (
                <Accordion type="single" collapsible className="w-full">
                  {filteredFaq.map((item, i) => (
                    <AccordionItem key={item.question} value={`faq-${i}`}>
                      <AccordionTrigger className="text-sm sm:text-base">
                        {item.question}
                      </AccordionTrigger>
                      <AccordionContent className="max-w-3xl leading-relaxed text-muted-foreground">
                        {item.answer}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              ) : (
                <NoResults query={query} />
              )}
            </TabsContent>

            {/* 4 · Atalhos */}
            <TabsContent value="shortcuts">
              <div className="max-w-3xl rounded-xl border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-40">Tecla</TableHead>
                      <TableHead>Descrição</TableHead>
                      <TableHead className="w-48">Onde funciona</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.shortcuts.map((s) => (
                      <TableRow key={s.keys}>
                        <TableCell>
                          <kbd className="pointer-events-none inline-flex h-6 select-none items-center rounded border bg-muted px-2 font-mono text-xs font-medium text-muted-foreground">
                            {s.keys}
                          </kbd>
                        </TableCell>
                        <TableCell className="text-sm">{s.description}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {s.scope}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            {/* 5 · Novidades */}
            <TabsContent value="changelog">
              <ol className="relative max-w-3xl space-y-8 border-l pl-6">
                {data.changelog.map((entry, idx) => {
                  const current = idx === 0
                  return (
                    <li key={entry.version} className="relative">
                      <span
                        aria-hidden="true"
                        className={cn(
                          'absolute top-1.5 -left-[27px] size-2.5 rounded-full border-2 border-background',
                          current ? 'bg-emerald-500' : 'bg-primary'
                        )}
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          className={cn(
                            current &&
                              'border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400'
                          )}
                          variant={current ? 'outline' : 'secondary'}
                        >
                          {entry.version}
                        </Badge>
                        {current && (
                          <Badge className="border-emerald-600/30 bg-emerald-600/10 text-emerald-700 dark:text-emerald-400" variant="outline">
                            Atual
                          </Badge>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {formatDate(entry.date)}
                        </span>
                      </div>
                      <h3 className="mt-2 text-sm font-semibold sm:text-base">
                        {entry.title}
                      </h3>
                      <ul className="mt-2 space-y-1.5">
                        {entry.highlights.map((h, i) => (
                          <li
                            key={i}
                            className="flex gap-2 text-sm leading-relaxed text-muted-foreground"
                          >
                            <span
                              aria-hidden="true"
                              className={cn(
                                'mt-1.5 size-1.5 shrink-0 rounded-full',
                                current ? 'bg-emerald-500' : 'bg-primary/50'
                              )}
                            />
                            {h}
                          </li>
                        ))}
                      </ul>
                    </li>
                  )
                })}
              </ol>
            </TabsContent>

            {/* 6 · Sobre */}
            <TabsContent value="about" className="space-y-4">
              <Card className="space-y-5 p-5 sm:p-6">
                <div>
                  <div className="flex flex-wrap items-baseline gap-2">
                    <h2 className="text-lg font-semibold">{data.about.productName}</h2>
                    <Badge variant="secondary">versão {data.about.version}</Badge>
                  </div>
                  <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                    {data.about.summary}
                  </p>
                </div>
                <div className="space-y-2">
                  <h3 className="text-sm font-medium">Stack tecnológica</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {data.about.stack.map((s) => (
                      <Badge key={s} variant="outline" className="font-normal">
                        {s}
                      </Badge>
                    ))}
                  </div>
                </div>
              </Card>
              <div className="max-w-4xl rounded-xl border bg-card">
                <div className="border-b px-4 py-3 sm:px-5">
                  <h3 className="text-sm font-semibold">Documentação do produto</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Arquivos versionados no repositório — a fonte de verdade sempre atualizada
                    junto com o código.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-56">Documento</TableHead>
                        <TableHead className="w-80">Caminho</TableHead>
                        <TableHead>Descrição</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.about.documents.map((doc) => (
                        <TableRow key={doc.path}>
                          <TableCell className="text-sm font-medium">{doc.name}</TableCell>
                          <TableCell>
                            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                              {doc.path}
                            </code>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {doc.description}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          {/* Widget NPS — Onda 5 / Fase 24: a voz do usuário dentro do produto */}
          {actor ? (
            <NpsWidget />
          ) : (
            <Card className="p-5 text-sm text-muted-foreground">
              A avaliação de experiência (NPS) fica disponível após entrar com o seu perfil.
            </Card>
          )}
        </>
      )}
    </div>
  )
}
