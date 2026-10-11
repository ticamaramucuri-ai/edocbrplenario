'use client'

/**
 * Módulo Auditoria — trilha append-only com cadeia de hashes (integridade),
 * timeline por aggregateType, filtros, verificação da cadeia e exportação JSON.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ChevronDown,
  ChevronRight,
  Download,
  Link2,
  ScrollText,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react'

import { api } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import { fmtDateTime } from '@/lib/format'
import { ROLE_LABEL, type AuditView, type Role } from '@/lib/contracts'
import { EmptyState, PageHeader } from '@/components/app/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { downloadBlob, shortHash, useDebouncedValue } from '@/modules/_shared'

const AGGREGATE_TYPES = [
  { value: 'session', label: 'Sessão' },
  { value: 'voting', label: 'Votação' },
  { value: 'vote', label: 'Voto' },
  { value: 'attendance', label: 'Presença' },
  { value: 'speech', label: 'Discurso' },
  { value: 'matter', label: 'Matéria' },
  { value: 'parliamentarian', label: 'Parlamentar' },
  { value: 'tenant', label: 'Configuração do tenant' },
] as const

const AGGREGATE_LABEL: Record<string, string> = Object.fromEntries(
  AGGREGATE_TYPES.map((a) => [a.value, a.label])
)

/** Cor do marco da timeline por tipo de agregado (decorativa — o rótulo sempre acompanha). */
const AGGREGATE_DOT: Record<string, string> = {
  session: 'bg-emerald-500',
  voting: 'bg-primary',
  vote: 'bg-primary/60',
  attendance: 'bg-amber-500',
  speech: 'bg-orange-500',
  matter: 'bg-lime-600',
  parliamentarian: 'bg-zinc-500',
  tenant: 'bg-rose-500',
}

const LIMITS = [50, 100, 200] as const

function pretty(value: string | null): string {
  if (!value) return '—'
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

function AuditEventCard({ event }: { event: AuditView }) {
  const [open, setOpen] = useState(false)
  const roleLabel = ROLE_LABEL[event.actorRole as Role] ?? event.actorRole

  return (
    <li className="relative pb-5 pl-6 last:pb-0">
      <span
        className="absolute -left-[7px] top-1.5 flex size-3.5 items-center justify-center rounded-full border-2 border-background"
        aria-hidden
      >
        <span className={cn('size-2 rounded-full', AGGREGATE_DOT[event.aggregateType] ?? 'bg-muted-foreground')} />
      </span>

      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="rounded-lg border bg-card p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="min-w-0 text-sm">
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                {event.action}
              </code>{' '}
              <span className="font-medium">{event.summary}</span>
            </p>
            <time className="text-xs tabular-nums text-muted-foreground" dateTime={event.createdAt}>
              {fmtDateTime(event.createdAt)}
            </time>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>
              {event.actorName} · {roleLabel}
            </span>
            <Badge variant="outline" className="text-[10px]">
              {AGGREGATE_LABEL[event.aggregateType] ?? event.aggregateType}
            </Badge>
          </div>
          {event.justification && (
            <p className="mt-2 rounded-md border border-amber-300/60 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/50 dark:text-amber-200">
              <strong>Justificativa:</strong> {event.justification}
            </p>
          )}

          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="mt-1 h-7 px-2 text-xs text-muted-foreground" aria-expanded={open}>
              {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              {open ? 'Ocultar detalhes' : 'Antes / Depois'}
            </Button>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {(
                [
                  { title: 'Antes (before)', value: event.beforeValue },
                  { title: 'Depois (after)', value: event.afterValue },
                ] as const
              ).map((block) => (
                <div key={block.title}>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {block.title}
                  </p>
                  <ScrollArea className="max-h-48 rounded-md border bg-muted/40">
                    <pre className="p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                      {pretty(block.value)}
                    </pre>
                  </ScrollArea>
                </div>
              ))}
            </div>
            <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">
              hash: {shortHash(event.chainHash, 12)}
              {event.prevHash && <> · anterior: {shortHash(event.prevHash, 8)}</>}
            </p>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </li>
  )
}

export default function AuditModule() {
  const can = useApp((s) => s.can)
  const canRead = can('audit.read')

  const [aggregateType, setAggregateType] = useState('todos')
  const [actionSearch, setActionSearch] = useState('')
  const debouncedAction = useDebouncedValue(actionSearch, 400)
  const [limit, setLimit] = useState<string>('50')
  const [verifyRequested, setVerifyRequested] = useState(false)

  const filters = useMemo(
    () => ({
      aggregateType: aggregateType !== 'todos' ? aggregateType : undefined,
      action: debouncedAction.trim() || undefined,
      limit: Number(limit),
      verify: verifyRequested || undefined,
    }),
    [aggregateType, debouncedAction, limit, verifyRequested]
  )

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['audit', filters],
    queryFn: () => api.listAudit(filters),
    enabled: canRead,
    placeholderData: (prev) => prev,
  })

  if (!canRead) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Auditoria"
          description="Trilha append-only com cadeia de integridade de todos os atos do sistema."
          icon={<ScrollText />}
        />
        <EmptyState
          icon={<ShieldAlert />}
          title="Seu perfil não possui permissão para consultar a auditoria"
          description="A auditoria é restrita aos papéis Auditor, Administrador da Câmara e Operador da Plataforma. Solicite acesso ao administrador do tenant."
        />
      </div>
    )
  }

  const events = data?.events ?? []
  const chain = data?.chain

  const exportJson = () => {
    downloadBlob(
      `auditoria-legis-${new Date().toISOString().slice(0, 10)}.json`,
      JSON.stringify({ exportedAt: new Date().toISOString(), filtros: filters, chain: chain ?? null, events }, null, 2),
      'application/json'
    )
    toast.success('JSON exportado', { description: `${events.length} evento(s) no filtro atual.` })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Auditoria"
        description="Trilha append-only com cadeia de integridade de todos os atos do sistema."
        icon={<ScrollText />}
        actions={
          <Button variant="outline" onClick={exportJson}>
            <Download /> Exportar JSON
          </Button>
        }
      />

      {/* Cadeia de integridade */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="size-4 text-primary" /> Cadeia de integridade
          </CardTitle>
          <CardDescription>
            Cada evento carrega o hash do anterior (blockchain interna). A verificação recalcula a cadeia completa.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {chain ? (
            <div className="flex flex-wrap items-center gap-3">
              {chain.valid ? (
                <Badge className="gap-1 bg-emerald-600 text-white hover:bg-emerald-600">
                  <ShieldCheck className="size-3.5" /> Cadeia válida
                </Badge>
              ) : (
                <Badge className="gap-1 bg-rose-600 text-white hover:bg-rose-600">
                  <ShieldAlert className="size-3.5" /> CADEIA QUEBRADA
                </Badge>
              )}
              <p className="font-mono text-xs text-muted-foreground" title={chain.head ?? undefined}>
                head: {chain.head ? shortHash(chain.head, 14) : '—'}
              </p>
              <p className="text-xs text-muted-foreground tabular-nums">{events.length} evento(s) nesta consulta</p>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={() => refetch()}
                disabled={isFetching}
              >
                <ShieldCheck /> Verificar novamente
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-muted-foreground">
                Cadeia ainda não verificada nesta consulta ({events.length} evento(s) carregados).
              </p>
              <Button
                size="sm"
                className="ml-auto"
                onClick={() => setVerifyRequested(true)}
                disabled={isFetching}
              >
                <ShieldCheck /> Verificar cadeia
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3" role="search" aria-label="Filtros de auditoria">
        <div className="grid gap-1.5">
          <Label htmlFor="audit-aggregate" className="text-xs text-muted-foreground">
            Tipo de agregado
          </Label>
          <Select value={aggregateType} onValueChange={setAggregateType}>
            <SelectTrigger id="audit-aggregate" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {AGGREGATE_TYPES.map((a) => (
                <SelectItem key={a.value} value={a.value}>
                  {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid flex-1 gap-1.5 sm:max-w-64">
          <Label htmlFor="audit-action" className="text-xs text-muted-foreground">
            Ação (contém)
          </Label>
          <Input
            id="audit-action"
            value={actionSearch}
            onChange={(e) => setActionSearch(e.target.value)}
            placeholder="Ex.: session., vote.cast"
            className="h-9 font-mono text-xs"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="audit-limit" className="text-xs text-muted-foreground">
            Limite
          </Label>
          <Select value={limit} onValueChange={setLimit}>
            <SelectTrigger id="audit-limit" className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LIMITS.map((l) => (
                <SelectItem key={l} value={String(l)}>
                  {l} eventos
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Timeline */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : events.length === 0 ? (
        <EmptyState
          icon={<ScrollText />}
          title="Nenhum evento de auditoria"
          description="Nenhum evento corresponde aos filtros atuais. Ajuste a ação ou o tipo de agregado."
        />
      ) : (
        <section aria-label="Eventos de auditoria" aria-live="polite">
          <ol className="relative ml-1.5 border-l-2">
            {events.map((e) => (
              <AuditEventCard key={e.id} event={e} />
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}
