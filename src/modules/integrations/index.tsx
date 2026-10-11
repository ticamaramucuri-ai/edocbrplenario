'use client'

/**
 * Módulo Integrações & API (Onda 5 / Fase 23 — ADR-024).
 *
 * 3 abas:
 *  · Chaves de API — emissão com escopos de leitura (exibição ÚNICA da chave
 *    completa com copiar + aviso âmbar), revogação append-only (AlertDialog) e
 *    tabela com nome/prefixo mono/escopos/último uso/estado;
 *  · Playground — seleção de chave ativa + endpoint → consulta REAL executada
 *    no servidor via delegação assinada de 30s (a chave nunca vai ao browser);
 *  · Documentação — referência dos 4 endpoints externos, envelope de resposta,
 *    formato de erro Problem Details, limite 60 req/min e exemplos curl.
 *
 * RBAC de UI: sem `apikey.manage` (tenant_admin) o módulo é somente leitura —
 * nota explicativa nas abas de gestão; a Documentação fica para todos.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Ban,
  BookOpen,
  Braces,
  Clock,
  Copy,
  Info,
  KeyRound,
  Play,
  Plug,
  RefreshCw,
} from 'lucide-react'

import { apiKeysApi } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import { fmtDateTime } from '@/lib/format'
import {
  API_SCOPES,
  API_SCOPE_ENDPOINT,
  API_SCOPE_LABEL,
  type ApiKeyView,
  type ApiScope,
  type PlaygroundResultView,
} from '@/lib/contracts'
import { EmptyState, PageHeader } from '@/components/app/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
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

/** Endpoint externo → escopo exigido (reverso de API_SCOPE_ENDPOINT, client-safe). */
const ENDPOINT_TO_SCOPE: Record<string, ApiScope> = Object.fromEntries(
  API_SCOPES.map((s) => [API_SCOPE_ENDPOINT[s], s])
)

// ─── Pequenos helpers visuais ───────────────────────────────────────────────

function ScopeBadges({ scopes }: { scopes: ApiScope[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {scopes.map((s) => (
        <Badge key={s} variant="secondary" className="font-mono text-[10px]">
          {s}
        </Badge>
      ))}
    </span>
  )
}

function KeyStateBadge({ revokedAt }: { revokedAt: string | null }) {
  return revokedAt ? (
    <Badge variant="outline" className="text-muted-foreground">
      Revogada
    </Badge>
  ) : (
    <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Ativa</Badge>
  )
}

function HttpStatusBadge({ status }: { status: number }) {
  const tone =
    status >= 200 && status < 300
      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
      : status >= 400 && status < 500
        ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
        : 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums',
        tone
      )}
    >
      HTTP {status}
    </span>
  )
}

function CopyButton({ text, label }: { text: string; label: string }) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 w-7 p-0"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => toast.success(`${label} copiado`))
      }}
      aria-label={`Copiar ${label.toLowerCase()}`}
    >
      <Copy className="size-3.5" />
    </Button>
  )
}

/** Bloco de código mono com botão copiar (exemplos da documentação). */
function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <div className="relative rounded-lg border bg-muted/50">
      <div className="absolute right-1.5 top-1.5">
        <CopyButton text={code} label={label} />
      </div>
      <pre className="custom-scroll max-h-56 overflow-auto whitespace-pre-wrap break-all p-3 pr-12 font-mono text-xs leading-relaxed">
        {code}
      </pre>
    </div>
  )
}

// ─── ABA 1 · Chaves de API ──────────────────────────────────────────────────

/** Dialog de criação: nome + checkboxes dos 4 escopos (labels do contracts). */
function NewKeyDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (secret: string, name: string) => void
}) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [scopes, setScopes] = useState<ApiScope[]>(['matters.read'])

  const toggleScope = (scope: ApiScope, checked: boolean) =>
    setScopes((prev) => (checked ? [...new Set([...prev, scope])] : prev.filter((s) => s !== scope)))

  const create = useMutation({
    mutationFn: () => apiKeysApi.create({ name: name.trim(), scopes }),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['api-keys'] })
      toast.success('Chave de API criada', {
        description: `${data.key.name} — ${scopes.length} escopo(s). Copie a chave completa agora.`,
      })
      onCreated(data.secret, data.key.name)
    },
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto custom-scroll sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-5 text-primary" /> Nova chave de API
          </DialogTitle>
          <DialogDescription>
            Chaves concedem acesso de <strong>leitura</strong> aos dados públicos da Câmara via{' '}
            <code className="rounded bg-muted px-1 text-[11px]">/api/v1/external/*</code>. Emita uma
            por integração e revogue quando não usar mais.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="apikey-name">Nome da chave (1–60 caracteres)</Label>
            <Input
              id="apikey-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Painel da Transparência"
              maxLength={60}
            />
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Escopos de leitura</legend>
            <div className="grid gap-1.5 rounded-md border p-3 sm:grid-cols-2">
              {API_SCOPES.map((scope) => (
                <label
                  key={scope}
                  className="flex cursor-pointer items-start gap-2 text-sm"
                  htmlFor={`scope-${scope}`}
                >
                  <Checkbox
                    id={`scope-${scope}`}
                    checked={scopes.includes(scope)}
                    onCheckedChange={(c) => toggleScope(scope, c === true)}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="block leading-tight">{API_SCOPE_LABEL[scope]}</span>
                    <span className="block truncate font-mono text-[10px] text-muted-foreground">
                      {scope}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            {scopes.length === 0 && (
              <p className="text-xs font-medium text-destructive">Selecione ao menos 1 escopo.</p>
            )}
          </fieldset>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={() => create.mutate()}
            disabled={create.isPending || scopes.length === 0 || name.trim().length === 0}
          >
            {create.isPending && <RefreshCw className="animate-spin" />}
            Gerar chave
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Dialog de resultado: a chave COMPLETA exibida UMA única vez. */
function SecretDialog({
  secret,
  name,
  onClose,
}: {
  secret: string
  name: string
  onClose: () => void
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-5 text-primary" /> Chave gerada — guarde agora
          </DialogTitle>
          <DialogDescription>
            Chave <strong className="text-foreground">{name}</strong> criada. Esta é a{' '}
            <strong className="text-foreground">única vez</strong> que a chave completa é exibida — o
            servidor guarda apenas o prefixo e um hash SHA-256.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-3">
            <code className="min-w-0 flex-1 break-all font-mono text-xs font-semibold select-all">
              {secret}
            </code>
            <CopyButton text={secret} label="Chave" />
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-500/10 p-3 text-sm text-amber-800 dark:border-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              <strong>Guarde esta chave — ela não será exibida novamente.</strong> Se perder, revogue
              a chave e emita outra.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Já guardei — fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function KeysTab({ canManage, onCreate }: { canManage: boolean; onCreate: () => void }) {
  const qc = useQueryClient()
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyView | null>(null)

  const keysQ = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => apiKeysApi.list(),
    enabled: canManage,
  })
  const keys = keysQ.data?.keys ?? []

  const revoke = useMutation({
    mutationFn: (id: string) => apiKeysApi.revoke(id),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['api-keys'] })
      toast.success('Chave revogada', {
        description: `${data.key.name} (${data.key.prefix}…) — revogação imediata e permanente (append-only).`,
      })
      setRevokeTarget(null)
    },
  })

  if (!canManage) {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-dashed p-5">
        <Info className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="space-y-1 text-sm">
          <p className="font-medium">Somente leitura</p>
          <p className="text-muted-foreground">
            A listagem e o gerenciamento de chaves de API são restritos ao administrador da Câmara
            (permissão <code className="rounded bg-muted px-1 font-mono text-[11px]">apikey.manage</code>).
            Consulte a aba <strong className="text-foreground">Documentação</strong> — o contrato das
            integrações fica liberado para qualquer perfil autenticado.
          </p>
        </div>
      </div>
    )
  }

  if (keysQ.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    )
  }

  if (keysQ.isError) {
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title="Não foi possível carregar as chaves"
        description="Tente recarregar o módulo. Se persistir, verifique sua conexão com o servidor."
      />
    )
  }

  if (keys.length === 0) {
    return (
      <EmptyState
        icon={<KeyRound />}
        title="Nenhuma chave de API emitida"
        description="Emita uma chave para integrar painéis de transparência, TV Câmara ou qualquer sistema externo com leitura dos dados públicos da Casa."
        action={
          <Button onClick={onCreate}>
            <KeyRound /> Nova chave
          </Button>
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      {/* Resumo */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Chaves</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{keys.length}</p>
          <p className="text-xs text-muted-foreground">prefixo legk_ + hash sha256 persistido</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Ativas</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
            {keys.filter((k) => !k.revokedAt).length}
          </p>
          <p className="text-xs text-muted-foreground">autenticam em /api/v1/external/*</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Revogadas</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-muted-foreground">
            {keys.filter((k) => k.revokedAt).length}
          </p>
          <p className="text-xs text-muted-foreground">append-only — o registro nunca é apagado</p>
        </div>
      </div>

      {/* Tabela de chaves (max-h + custom-scroll quando longa) */}
      <div className="custom-scroll max-h-96 overflow-y-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Chave</TableHead>
              <TableHead>Escopos</TableHead>
              <TableHead className="hidden whitespace-nowrap sm:table-cell">Último uso</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-28 text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.map((k) => (
              <TableRow key={k.id} className={cn(k.revokedAt && 'opacity-60')}>
                <TableCell className="max-w-56">
                  <p className={cn('truncate font-medium', k.revokedAt && 'line-through')}>{k.name}</p>
                  <code className="font-mono text-[11px] text-muted-foreground select-all">
                    {k.prefix}…
                  </code>
                </TableCell>
                <TableCell>
                  <ScopeBadges scopes={k.scopes} />
                </TableCell>
                <TableCell className="hidden whitespace-nowrap text-xs text-muted-foreground sm:table-cell">
                  {k.lastUsedAt ? fmtDateTime(k.lastUsedAt) : 'Nunca usada'}
                </TableCell>
                <TableCell>
                  <KeyStateBadge revokedAt={k.revokedAt} />
                </TableCell>
                <TableCell className="text-right">
                  {!k.revokedAt ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setRevokeTarget(k)}
                      aria-label={`Revogar chave ${k.name}`}
                    >
                      <Ban className="size-3.5" /> Revogar
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        A chave completa é exibida apenas na criação — aqui só o prefixo{' '}
        <code className="rounded bg-muted px-1 font-mono">legk_xxxxxxxx</code> é visível.
      </p>

      {/* Confirmação de revogação (destrutiva) */}
      <AlertDialog open={!!revokeTarget} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revogar chave de API?</AlertDialogTitle>
            <AlertDialogDescription>
              A chave <strong className="text-foreground">{revokeTarget?.name}</strong>{' '}
              (
                <code className="rounded bg-muted px-1 font-mono text-xs">
                  {revokeTarget?.prefix}…
                </code>
              ) deixará de autenticar imediatamente — integrações que a usam passarão a receber 401.
              A revogação é append-only: o registro permanece para auditoria e não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => revokeTarget && revoke.mutate(revokeTarget.id)}
            >
              {revoke.isPending && <RefreshCw className="animate-spin" />} Revogar definitivamente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── ABA 2 · Playground ─────────────────────────────────────────────────────

function PlaygroundTab({ canManage }: { canManage: boolean }) {
  const [keyId, setKeyId] = useState('')
  const [endpoint, setEndpoint] = useState('')
  const [result, setResult] = useState<PlaygroundResultView | null>(null)

  const keysQ = useQuery({
    queryKey: ['api-keys'],
    queryFn: () => apiKeysApi.list(),
    enabled: canManage,
  })
  const activeKeys = (keysQ.data?.keys ?? []).filter((k) => !k.revokedAt)
  const selectedKey = activeKeys.find((k) => k.id === keyId) ?? null

  const run = useMutation({
    mutationFn: () => apiKeysApi.playground({ keyId, endpoint }),
    onSuccess: (data) => setResult(data.result),
    onError: () => setResult(null),
  })

  const selectKey = (id: string) => {
    setKeyId(id)
    setResult(null)
    // Endpoint selecionado cujo escopo a nova chave não tem → limpa a seleção.
    const k = activeKeys.find((key) => key.id === id)
    if (endpoint && k && !k.scopes.includes(ENDPOINT_TO_SCOPE[endpoint])) setEndpoint('')
  }

  const selectEndpoint = (path: string) => {
    setEndpoint(path)
    setResult(null)
  }

  const canRun = canManage && !!keyId && !!endpoint && !run.isPending

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-xl border bg-card p-4">
        <Info className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <p className="text-sm text-muted-foreground">
          A consulta é executada <strong className="text-foreground">no servidor</strong> com a chave
          selecionada — ela nunca é exposta ao navegador. O servidor assina uma{' '}
          <strong className="text-foreground">delegação de 30 segundos</strong> (HMAC) e consulta o
          endpoint real, medindo status e latência.
        </p>
      </div>

      {!canManage ? (
        <div className="flex items-start gap-3 rounded-xl border border-dashed p-5 text-sm">
          <Info className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <p className="text-muted-foreground">
            A execução de consultas é restrita ao administrador da Câmara (permissão{' '}
            <code className="rounded bg-muted px-1 font-mono text-[11px]">apikey.manage</code>).
          </p>
        </div>
      ) : keysQ.isLoading ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : activeKeys.length === 0 ? (
        <EmptyState
          icon={<Play />}
          title="Nenhuma chave ativa"
          description="Emita uma chave na aba Chaves de API para executar consultas de teste aqui."
        />
      ) : (
        <div className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pg-key">Chave de API</Label>
            <Select value={keyId} onValueChange={selectKey}>
              <SelectTrigger id="pg-key" className="w-full" aria-label="Selecionar chave de API">
                <SelectValue placeholder="Selecione uma chave ativa" />
              </SelectTrigger>
              <SelectContent>
                {activeKeys.map((k) => (
                  <SelectItem key={k.id} value={k.id}>
                    {k.name} · {k.prefix}…
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pg-endpoint">Endpoint</Label>
            <Select value={endpoint} onValueChange={selectEndpoint}>
              <SelectTrigger id="pg-endpoint" className="w-full" aria-label="Selecionar endpoint">
                <SelectValue placeholder="Selecione o endpoint" />
              </SelectTrigger>
              <SelectContent>
                {API_SCOPES.map((scope) => {
                  const path = API_SCOPE_ENDPOINT[scope]
                  const allowed = selectedKey ? selectedKey.scopes.includes(scope) : true
                  return (
                    <SelectItem key={scope} value={path} disabled={!allowed}>
                      <span className="truncate">{path}</span>
                      {!allowed && (
                        <span className="ml-1 whitespace-nowrap text-xs text-muted-foreground">
                          — sem escopo
                        </span>
                      )}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
            {selectedKey && (
              <p className="text-xs text-muted-foreground">
                Escopos da chave: {selectedKey.scopes.join(', ') || '—'}
              </p>
            )}
          </div>
          <div className="sm:col-span-2">
            <Button onClick={() => run.mutate()} disabled={!canRun} aria-label="Executar consulta">
              {run.isPending ? (
                <RefreshCw className="animate-spin" />
              ) : (
                <Play className="size-4" />
              )}
              {run.isPending ? 'Executando…' : 'Executar consulta'}
            </Button>
          </div>
        </div>
      )}

      {/* Painel de resultado */}
      {(result || run.isPending) && (
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-center gap-3">
            {run.isPending ? (
              <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                <RefreshCw className="size-4 animate-spin" /> Consultando {endpoint}…
              </span>
            ) : (
              result && (
                <>
                  <HttpStatusBadge status={result.status} />
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="size-3.5" aria-hidden /> {result.latencyMs} ms
                  </span>
                  <code className="ml-auto font-mono text-[11px] text-muted-foreground">
                    GET {endpoint}
                  </code>
                </>
              )
            )}
          </div>
          {result && (
            <pre className="custom-scroll max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted/50 p-3 font-mono text-xs leading-relaxed">
              {JSON.stringify(result.body, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}

// ─── ABA 3 · Documentação ───────────────────────────────────────────────────

const ENDPOINT_DOCS: Array<{ scope: ApiScope; description: string }> = [
  {
    scope: 'matters.read',
    description:
      'Matérias legislativas do tenant — mesmas fields do portal público (tipo, número, ementa, autores, situação, regime).',
  },
  {
    scope: 'sessions.read',
    description:
      'Sessões agendadas/realizadas com pauta publicada (número, tipo, data, situação, agendaPublished).',
  },
  {
    scope: 'publications.read',
    description:
      'Publicações do diário eletrônico SOMENTE com status published (numeração, título, tipo, datas).',
  },
  {
    scope: 'calendar.read',
    description:
      'Eventos do calendário legislativo do mês (sessões, audiências, reuniões de comissão e prazos). Aceita ?year=&month=.',
  },
]

const CURL_EXAMPLE = `curl -H "Authorization: Bearer legk_..." \\
  "https://SEU_DOMINIO/api/v1/external/matters?page=1&pageSize=20"`

const PROBLEM_EXAMPLE = `{
  "type": "https://legis-saas/errors/forbidden-scope",
  "title": "Escopo insuficiente",
  "status": 403,
  "detail": "A chave não possui o escopo \\"matters.read\\" exigido por este endpoint.",
  "code": "FORBIDDEN_SCOPE",
  "correlationId": "3f2c1d9a-…"
}`

const ENVELOPE_EXAMPLE = `{
  "data": [ /* itens da página */ ],
  "page": 1,
  "pageSize": 20,
  "total": 27
}`

function DocsTab() {
  return (
    <div className="space-y-6">
      {/* Como emitir */}
      <section className="space-y-2" aria-labelledby="doc-emitir">
        <h3 id="doc-emitir" className="flex items-center gap-2 text-base font-semibold">
          <KeyRound className="size-4 text-primary" aria-hidden /> Como emitir uma chave
        </h3>
        <p className="text-sm text-muted-foreground">
          No console da Câmara: <strong className="text-foreground">Governança → Integrações & API →
          Nova chave</strong> (papel de administrador). Dê um nome descritivo por integração (ex.:
          “Painel da Transparência”), marque os escopos necessários e copie a chave completa no ato —
          ela é exibida <strong className="text-foreground">uma única vez</strong>. O servidor persiste
          apenas o prefixo <code className="rounded bg-muted px-1 font-mono text-[11px]">legk_xxxxxxxx</code>{' '}
          e um hash SHA-256; a revogação é imediata e permanente.
        </p>
      </section>

      {/* Referência dos endpoints */}
      <section className="space-y-3" aria-labelledby="doc-endpoints">
        <h3 id="doc-endpoints" className="flex items-center gap-2 text-base font-semibold">
          <BookOpen className="size-4 text-primary" aria-hidden /> Referência dos endpoints
        </h3>
        <div className="grid gap-3 lg:grid-cols-2">
          {ENDPOINT_DOCS.map(({ scope, description }) => (
            <article key={scope} className="space-y-2 rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">GET</Badge>
                <code className="break-all font-mono text-xs font-semibold">
                  {API_SCOPE_ENDPOINT[scope]}
                </code>
              </div>
              <ScopeBadges scopes={[scope]} />
              <p className="text-sm text-muted-foreground">{description}</p>
            </article>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Paginação em todos os endpoints: <code className="rounded bg-muted px-1 font-mono">?page=1</code>{' '}
          (≥ 1) e <code className="rounded bg-muted px-1 font-mono">?pageSize=20</code> (1–50, default
          20). Os dados são sempre do tenant da chave — nunca de outra Câmara.
        </p>
      </section>

      {/* Envelope + erros */}
      <section className="grid gap-4 lg:grid-cols-2" aria-labelledby="doc-formato">
        <div className="space-y-2">
          <h3 id="doc-formato" className="flex items-center gap-2 text-base font-semibold">
            <Braces className="size-4 text-primary" aria-hidden /> Envelope de resposta
          </h3>
          <CodeBlock code={ENVELOPE_EXAMPLE} label="Exemplo de envelope" />
        </div>
        <div className="space-y-2">
          <h3 className="flex items-center gap-2 text-base font-semibold">
            <AlertTriangle className="size-4 text-primary" aria-hidden /> Erros (Problem Details)
          </h3>
          <CodeBlock code={PROBLEM_EXAMPLE} label="Exemplo de erro" />
          <p className="text-xs text-muted-foreground">
            Códigos estáveis: <code className="rounded bg-muted px-1 font-mono">UNAUTHENTICATED</code>{' '}
            (401 — sem chave, inválida ou revogada),{' '}
            <code className="rounded bg-muted px-1 font-mono">FORBIDDEN_SCOPE</code> (403 — escopo
            ausente) e <code className="rounded bg-muted px-1 font-mono">RATE_LIMITED</code> (429).
          </p>
        </div>
      </section>

      {/* Limites */}
      <section className="space-y-2" aria-labelledby="doc-limites">
        <h3 id="doc-limites" className="flex items-center gap-2 text-base font-semibold">
          <Clock className="size-4 text-primary" aria-hidden /> Limites de uso
        </h3>
        <div className="rounded-xl border border-amber-300 bg-amber-500/10 p-4 text-sm text-amber-800 dark:border-amber-800 dark:text-amber-300">
          <p>
            <strong>60 requisições por minuto por chave</strong> (janela deslizante). Acima disso o
            endpoint responde <strong>429</strong> com o header{' '}
            <code className="rounded bg-muted px-1 font-mono text-[11px]">Retry-After</code>{' '}
            indicando os segundos até a liberação — trate com backoff exponencial no cliente.
          </p>
        </div>
      </section>

      {/* Exemplos curl */}
      <section className="space-y-2" aria-labelledby="doc-curl">
        <h3 id="doc-curl" className="flex items-center gap-2 text-base font-semibold">
          <Play className="size-4 text-primary" aria-hidden /> Exemplos
        </h3>
        <CodeBlock code={CURL_EXAMPLE} label="Exemplo curl" />
        <p className="text-xs text-muted-foreground">
          Outros endpoints: substitua o path por{' '}
          <code className="rounded bg-muted px-1 font-mono">/api/v1/external/sessions</code>,{' '}
          <code className="rounded bg-muted px-1 font-mono">/publications</code> ou{' '}
          <code className="rounded bg-muted px-1 font-mono">/calendar</code> (este aceita{' '}
          <code className="rounded bg-muted px-1 font-mono">?year=2026&amp;month=10</code>).
        </p>
      </section>
    </div>
  )
}

// ─── Módulo ─────────────────────────────────────────────────────────────────

export default function IntegrationsModule() {
  const canManage = useApp((s) => s.can('apikey.manage'))
  const [tab, setTab] = useState('keys')
  const [showNew, setShowNew] = useState(false)
  const [secretResult, setSecretResult] = useState<{ secret: string; name: string } | null>(null)

  return (
    <div className="space-y-6">
      <PageHeader
        icon={<Plug />}
        title="Integrações & API"
        description="Acesso programático autenticado e escopado para integradores — chaves legk_ com exibição única, playground de consultas reais e documentação para desenvolvedores."
        actions={
          <>
            <Badge variant="outline">Fase 23 · Onda 5</Badge>
            {canManage && (
              <Button onClick={() => setShowNew(true)}>
                <KeyRound /> Nova chave
              </Button>
            )}
          </>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto w-full flex-wrap justify-start sm:w-auto">
          <TabsTrigger value="keys" className="gap-1.5">
            <KeyRound className="size-3.5" /> Chaves de API
          </TabsTrigger>
          <TabsTrigger value="playground" className="gap-1.5">
            <Play className="size-3.5" /> Playground
          </TabsTrigger>
          <TabsTrigger value="docs" className="gap-1.5">
            <BookOpen className="size-3.5" /> Documentação
          </TabsTrigger>
        </TabsList>

        <TabsContent value="keys" className="mt-4">
          <KeysTab canManage={canManage} onCreate={() => setShowNew(true)} />
        </TabsContent>

        <TabsContent value="playground" className="mt-4">
          <PlaygroundTab canManage={canManage} />
        </TabsContent>

        <TabsContent value="docs" className="mt-4">
          <DocsTab />
        </TabsContent>
      </Tabs>

      {/* Dialog de criação (exibição única da chave completa logo em seguida) */}
      {showNew && (
        <NewKeyDialog
          onClose={() => setShowNew(false)}
          onCreated={(secret, name) => {
            setShowNew(false)
            setSecretResult({ secret, name })
          }}
        />
      )}
      {secretResult && (
        <SecretDialog
          secret={secretResult.secret}
          name={secretResult.name}
          onClose={() => setSecretResult(null)}
        />
      )}
    </div>
  )
}
