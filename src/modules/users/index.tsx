'use client'

/**
 * Módulo Usuários (Fase 9 + Onda 5/F22) — gestão das contas com acesso por
 * senha: listagem com filtros (nome/e-mail + papel), criação (dialog com
 * senha e vínculo com parlamentar), edição, redefinição de senha e
 * ativação/desativação (revoga sessões). RBAC user.manage (tenant_admin,
 * platform_owner). Sem exclusão — desativação é o caminho do domínio.
 *
 * Onda 5 / Fase 22 — card "Meu acesso" (visível a QUALQUER papel
 * autenticado, no topo): estado + setup/desabilitação de MFA TOTP
 * (mfaApi pré-construído) e tabela de SESSÕES ATIVAS com revogação
 * individual (authSessionsApi) — ADR-023.
 */
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Eye,
  EyeOff,
  KeyRound,
  LogOut,
  MonitorSmartphone,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldOff,
  UserCheck,
  UserPlus,
  UserX,
  Users as UsersIcon,
} from 'lucide-react'

import { authSessionsApi, mfaApi } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import {
  ROLE_LABEL,
  type AuthSessionView,
  type MfaSetupView,
  type ParliamentarianView,
  type Role,
} from '@/lib/contracts'
import { fmtDateTime } from '@/lib/format'
import { EmptyState, PageHeader } from '@/components/app/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'

// ─── Tipos locais (contrato das rotas /api/v1/users) ────────────────────────

type UserRow = {
  id: string
  name: string
  email: string
  role: Role
  jobTitle: string | null
  parliamentarianId: string | null
  parliamentarianName: string | null
  active: boolean
  createdAt: string
  tenantId: string | null
  tenantName: string | null
  tenantSlug: string | null
}

type TenantOption = { id: string; slug: string; name: string; active: boolean }

type Problem = {
  title?: string
  detail?: string
  status?: number
  code?: string
  errors?: Record<string, string[]>
}

// ─── Fetch local (api-client.ts é intocável — Fase 9) ───────────────────────

class UsersApiError extends Error {
  constructor(public readonly problem: Problem) {
    super(problem.detail || problem.title || 'Erro na requisição.')
    this.name = 'UsersApiError'
  }
}

/** fetch + JSON + throw com parse do Problem Details; credenciais same-origin. */
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body !== undefined) headers.set('Content-Type', 'application/json')
  // Coexistência com o modo demo (ADR-005): sem sessão, o header ainda resolve o ator.
  const actorId = typeof window !== 'undefined' ? localStorage.getItem('legis.actorId') : null
  if (actorId) headers.set('x-actor-id', actorId)
  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' })
  const text = await res.text()
  const body: unknown = text ? JSON.parse(text) : null
  if (!res.ok) throw new UsersApiError((body ?? {}) as Problem)
  return body as T
}

function problemMessage(err: unknown): string {
  if (err instanceof UsersApiError) {
    const fields = err.problem.errors
      ? Object.values(err.problem.errors).flat().filter(Boolean).join(' ')
      : ''
    return [err.problem.detail, fields].filter(Boolean).join(' — ')
  }
  return err instanceof Error ? err.message : 'Erro inesperado.'
}

// ─── Constantes de exibição ─────────────────────────────────────────────────

const ROLES: Role[] = [
  'tenant_admin',
  'legislative_admin',
  'session_operator',
  'media_operator',
  'presiding_officer',
  'parliamentarian',
  'auditor',
  'platform_owner',
  'platform_support',
]

const ROLE_BADGE: Record<Role, string> = {
  platform_owner: 'bg-primary/15 text-primary',
  platform_support: 'bg-zinc-500/15 text-zinc-700 dark:text-zinc-300',
  platform_monitor: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
  tenant_admin: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  legislative_admin: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  session_operator: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  media_operator: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  presiding_officer: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  parliamentarian: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  auditor: 'bg-stone-500/15 text-stone-700 dark:text-stone-300',
}

type DialogState =
  | { mode: 'create' }
  | { mode: 'edit'; user: UserRow }
  | null

// ─── Dialog criar/editar ────────────────────────────────────────────────────

function UserDialog({
  state,
  tenants,
  isPlatformOwner,
  onClose,
}: {
  state: Extract<DialogState, { mode: 'create' | 'edit' }>
  tenants: TenantOption[]
  isPlatformOwner: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  const editing = state.mode === 'edit' ? state.user : null
  const [tenantSlugRaw, setTenantSlug] = useState('')
  const [name, setName] = useState(editing?.name ?? '')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [role, setRole] = useState<Role>(editing?.role ?? 'session_operator')
  const [jobTitle, setJobTitle] = useState(editing?.jobTitle ?? '')
  const [parliamentarianId, setParliamentarianId] = useState(editing?.parliamentarianId ?? '')

  // Plataforma criando: pré-seleciona o primeiro tenant ativo (derivado no
  // render — sem setState em effect).
  const tenantSlug =
    tenantSlugRaw || (isPlatformOwner && state.mode === 'create'
      ? (tenants.find((t) => t.active) ?? tenants[0])?.slug ?? ''
      : '')

  // Parlamentares do escopo do dialog: criação usa o tenant selecionado
  // (plataforma) ou o escopo do ator; edição usa o tenant do usuário.
  const parlSlug =
    state.mode === 'create' ? (isPlatformOwner ? tenantSlug : '') : (editing?.tenantSlug ?? '')
  const parlQ = useQuery({
    queryKey: ['users-dialog-parliamentarians', parlSlug],
    queryFn: () =>
      apiFetch<{ parliamentarians: ParliamentarianView[] }>(
        parlSlug ? `/api/v1/parliamentarians?tenant=${encodeURIComponent(parlSlug)}` : '/api/v1/parliamentarians'
      ),
    enabled: state.mode === 'edit' || !isPlatformOwner || !!tenantSlug,
  })
  const parliamentarians = parlQ.data?.parliamentarians ?? []
  // Edição de usuário sem tenant (equipe da plataforma): sem vínculo possível.
  const parlDisabled = state.mode === 'edit' && !editing?.tenantSlug

  const save = useMutation({
    mutationFn: async () => {
      if (editing) {
        return apiFetch<{ user: UserRow }>(`/api/v1/users/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: name.trim(),
            role,
            jobTitle: jobTitle.trim() || null,
            parliamentarianId: parliamentarianId || null,
          }),
        })
      }
      const query = isPlatformOwner && tenantSlug ? `?tenant=${encodeURIComponent(tenantSlug)}` : ''
      return apiFetch<{ user: UserRow }>(`/api/v1/users${query}`, {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
          role,
          jobTitle: jobTitle.trim() || undefined,
          parliamentarianId: parliamentarianId || undefined,
        }),
      })
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] })
      toast.success(editing ? 'Usuário atualizado' : 'Usuário criado', {
        description: editing
          ? 'Alterações salvas e auditadas (user.updated).'
          : `${name.trim()} já pode entrar com e-mail e senha.`,
      })
      onClose()
    },
    onError: (err) => toast.error('Falha ao salvar usuário', { description: problemMessage(err) }),
  })

  const needsTenant = !editing && isPlatformOwner
  const canSubmit =
    name.trim().length >= 2 &&
    role !== undefined &&
    (editing || (email.trim().includes('@') && password.length >= 8)) &&
    (!needsTenant || !!tenantSlug) &&
    (role !== 'parliamentarian' || !!parliamentarianId)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto custom-scroll sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="size-5 text-primary" /> {editing ? 'Editar usuário' : 'Novo usuário'}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? 'Altere dados, papel e vínculo. A troca de papel para parlamentar exige vínculo com um parlamentar do tenant.'
              : 'A conta é criada ativa e já pode entrar com e-mail e senha (autenticação real, Fase 9).'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {needsTenant && (
            <div className="space-y-1.5">
              <Label htmlFor="usr-tenant">Tenant da Câmara</Label>
              <Select value={tenantSlug} onValueChange={setTenantSlug}>
                <SelectTrigger id="usr-tenant" aria-label="Selecionar tenant do novo usuário">
                  <SelectValue placeholder="Selecione o tenant" />
                </SelectTrigger>
                <SelectContent>
                  {tenants.map((t) => (
                    <SelectItem key={t.id} value={t.slug}>
                      {t.name}
                      {!t.active ? ' (inativo)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Obrigatório para o operador da plataforma — o usuário pertence a um tenant.
              </p>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="usr-name">Nome completo</Label>
              <Input
                id="usr-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Mariana Souza"
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="usr-role">Papel (RBAC)</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger id="usr-role" aria-label="Selecionar papel">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="usr-email">E-mail{editing ? ' (não editável)' : ''}</Label>
            <Input
              id="usr-email"
              type="email"
              value={editing ? editing.email : email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nome@camara.leg.br"
              disabled={!!editing}
              autoComplete="email"
            />
          </div>

          {!editing && (
            <div className="space-y-1.5">
              <Label htmlFor="usr-password">Senha inicial (mínimo 8 caracteres)</Label>
              <div className="relative">
                <Input
                  id="usr-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="pr-10"
                  autoComplete="new-password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 size-9 text-muted-foreground"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Ocultar senha' : 'Exibir senha'}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </Button>
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="usr-jobtitle">Cargo (opcional)</Label>
              <Input
                id="usr-jobtitle"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder="Ex.: Operador de Sessão"
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="usr-parl">
                Vínculo com parlamentar{role === 'parliamentarian' ? ' (obrigatório)' : ' (opcional)'}
              </Label>
              <Select
                value={parliamentarianId || 'none'}
                onValueChange={(v) => setParliamentarianId(v === 'none' ? '' : v)}
                disabled={parlDisabled}
              >
                <SelectTrigger id="usr-parl" aria-label="Selecionar parlamentar vinculado">
                  <SelectValue placeholder={parlQ.isLoading ? 'Carregando…' : 'Sem vínculo'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sem vínculo</SelectItem>
                  {parliamentarians.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} {p.active ? '' : '(inativo)'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {parlDisabled && (
                <p className="text-xs text-muted-foreground">
                  Usuário da equipe da plataforma — sem vínculo de tenant.
                </p>
              )}
              {role === 'parliamentarian' && !parliamentarianId && !parlDisabled && (
                <p className="text-xs font-medium text-destructive">
                  Papel Parlamentar exige vínculo com um parlamentar do tenant.
                </p>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !canSubmit}>
            {save.isPending && <RefreshCw className="animate-spin" />}
            {editing ? 'Salvar alterações' : 'Criar usuário'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Dialog redefinir senha ─────────────────────────────────────────────────

function ResetPasswordDialog({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const qc = useQueryClient()
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)

  const reset = useMutation({
    mutationFn: () =>
      apiFetch<{ user: UserRow }>(`/api/v1/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ password }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['users'] })
      toast.success('Senha redefinida', {
        description: `As sessões ativas de ${user.name} foram revogadas — novo login obrigatório.`,
      })
      onClose()
    },
    onError: (err) => toast.error('Falha ao redefinir senha', { description: problemMessage(err) }),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-5 text-primary" /> Redefinir senha
          </DialogTitle>
          <DialogDescription>
            Nova senha para <strong>{user.name}</strong> ({user.email}). Todas as sessões ativas do
            usuário serão encerradas.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="usr-new-password">Nova senha (mínimo 8 caracteres)</Label>
          <div className="relative">
            <Input
              id="usr-new-password"
              type={show ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="pr-10"
              autoComplete="new-password"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-0 top-0 size-9 text-muted-foreground"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? 'Ocultar senha' : 'Exibir senha'}
            >
              {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => reset.mutate()} disabled={reset.isPending || password.length < 8}>
            {reset.isPending && <RefreshCw className="animate-spin" />} Redefinir senha
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── F22: card "Meu acesso" (MFA + sessões ativas — qualquer papel) ─────────

/** Resumo legível do User-Agent (navegador · sistema). */
function summarizeUserAgent(ua: string | null): string {
  if (!ua || !ua.trim()) return 'Dispositivo desconhecido'
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : /^curl\//i.test(ua)
              ? 'curl (linha de comando)'
              : /^PostmanRuntime/i.test(ua)
                ? 'Postman'
                : null
  const os = /Windows NT/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /iPhone|iPad/.test(ua)
        ? 'iOS'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /Linux|X11/.test(ua)
            ? 'Linux'
            : null
  if (browser && os) return `${browser} · ${os}`
  if (browser || os) return (browser ?? os) as string
  return ua.length > 42 ? `${ua.slice(0, 42)}…` : ua
}

function mutationError(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'Erro inesperado.'
}

/** Dialog de SETUP: segredo exibido UMA vez + confirmação por código. */
function MfaSetupDialog({ setup, onClose }: { setup: MfaSetupView; onClose: () => void }) {
  const qc = useQueryClient()
  const [totp, setTotp] = useState('')
  const [showUrl, setShowUrl] = useState(false)

  const enable = useMutation({
    mutationFn: () => mfaApi.enable(totp),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['my-mfa'] })
      toast.success('MFA habilitado', {
        description:
          'O login agora exige e-mail, senha e código TOTP de 6 dígitos (RFC 6238, drift ±1).',
      })
      onClose()
    },
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto custom-scroll sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-primary" /> Configurar autenticação de dois fatores
          </DialogTitle>
          <DialogDescription>
            O segredo abaixo é exibido UMA única vez. Guarde-o no seu autenticador antes de
            confirmar — depois de habilitado, ele não pode ser consultado novamente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Segredo TOTP (base32)</Label>
            <p className="rounded-lg border bg-muted/40 px-3 py-2.5 font-mono text-sm font-semibold tracking-wider break-all">
              {setup.secret}
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs text-muted-foreground">URL otpauth (apps com QR)</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => setShowUrl((v) => !v)}
              >
                {showUrl ? 'Ocultar' : 'Exibir'}
              </Button>
            </div>
            {showUrl && (
              <p className="rounded-lg border bg-muted/40 px-3 py-2 font-mono text-[11px] break-all">
                {setup.otpauthUrl}
              </p>
            )}
          </div>

          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Abra o Google Authenticator (ou compatível) e toque em “Adicionar conta”.</li>
            <li>Escolha “Inserir chave de configuração” e digite o segredo acima.</li>
            <li>Confirme com o código de 6 dígitos que o app gerar (janela de 30s).</li>
          </ol>

          <div className="space-y-1.5">
            <Label htmlFor="mfa-enable-code">Código gerado pelo app</Label>
            <InputOTP
              id="mfa-enable-code"
              maxLength={6}
              value={totp}
              onChange={setTotp}
              aria-label="Código TOTP de 6 dígitos para habilitar o MFA"
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
          </div>

          {enable.isError && (
            <p className="text-xs text-destructive" role="alert">
              {mutationError(enable.error)}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={enable.isPending}>
            Cancelar
          </Button>
          <Button onClick={() => enable.mutate()} disabled={enable.isPending || totp.length !== 6}>
            {enable.isPending && <RefreshCw className="animate-spin" />} Habilitar MFA
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Dialog de DESABILITAÇÃO: senha atual + código TOTP (dois fatores p/ sair). */
function MfaDisableDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const [password, setPassword] = useState('')
  const [totp, setTotp] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const disable = useMutation({
    mutationFn: () => mfaApi.disable(password, totp),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['my-mfa'] })
      toast.success('MFA desabilitado', {
        description: 'O segredo TOTP foi removido do banco — o login volta a exigir apenas a senha.',
      })
      onClose()
    },
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldOff className="size-5 text-destructive" /> Desativar MFA
          </DialogTitle>
          <DialogDescription>
            Remover o segundo fator exige confirmação dupla: sua senha atual e um código TOTP
            válido. O segredo será APAGADO do banco (para reativar, gere um novo).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="mfa-disable-password">Senha atual</Label>
            <div className="relative">
              <Input
                id="mfa-disable-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="pr-10"
                autoComplete="current-password"
                minLength={8}
                disabled={disable.isPending}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 size-9 text-muted-foreground"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Ocultar senha' : 'Exibir senha'}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mfa-disable-code">Código TOTP atual</Label>
            <InputOTP
              id="mfa-disable-code"
              maxLength={6}
              value={totp}
              onChange={setTotp}
              aria-label="Código TOTP de 6 dígitos para desabilitar o MFA"
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
          </div>

          {disable.isError && (
            <p className="text-xs text-destructive" role="alert">
              {mutationError(disable.error)}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={disable.isPending}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={() => disable.mutate()}
            disabled={disable.isPending || password.length < 8 || totp.length !== 6}
          >
            {disable.isPending && <RefreshCw className="animate-spin" />} Desativar MFA
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Card "Meu acesso" — MFA do próprio ator + sessões ativas com revogação. */
function MyAccessCard() {
  const qc = useQueryClient()
  const actor = useApp((s) => s.actor)

  const [setup, setSetup] = useState<MfaSetupView | null>(null)
  const [disableOpen, setDisableOpen] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<AuthSessionView | null>(null)

  const mfaQ = useQuery({
    queryKey: ['my-mfa'],
    queryFn: () => apiFetch<{ mfaEnabled: boolean }>('/api/v1/auth/mfa/status'),
    enabled: !!actor,
  })

  const sessionsQ = useQuery({
    queryKey: ['my-sessions'],
    queryFn: () => authSessionsApi.list(),
    enabled: !!actor,
  })

  const setupMfa = useMutation({
    mutationFn: () => mfaApi.setup(),
    onSuccess: (data) => setSetup(data),
  })

  const revoke = useMutation({
    mutationFn: (id: string) => authSessionsApi.revoke(id),
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: ['my-sessions'] })
      const wasCurrent = revokeTarget?.id === id && revokeTarget?.current
      toast.success('Sessão encerrada', {
        description: wasCurrent
          ? 'Era a sessão atual — você será desconectado(a) no próximo clique.'
          : 'O dispositivo perdeu o acesso imediatamente (cookie revogado).',
      })
      setRevokeTarget(null)
    },
    onError: () => setRevokeTarget(null),
  })

  const mfaEnabled = mfaQ.data?.mfaEnabled ?? false
  const sessions = sessionsQ.data?.sessions ?? []

  return (
    <section
      className="grid gap-4 rounded-xl border bg-card p-4 sm:p-6 lg:grid-cols-2"
      aria-labelledby="my-access-title"
    >
      {/* (a) MFA */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="my-access-title" className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="size-4 text-primary" aria-hidden /> Autenticação de dois fatores
          </h3>
          {mfaQ.isLoading ? (
            <Skeleton className="h-6 w-24" />
          ) : mfaEnabled ? (
            <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
              MFA ativo
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground">
              MFA desativado
            </Badge>
          )}
        </div>

        <p className="text-sm text-muted-foreground">
          Segundo fator TOTP (RFC 6238) para{' '}
          <strong className="text-foreground">{actor?.name}</strong>: com o MFA ativo, o login
          exige e-mail, senha e o código de 6 dígitos do seu autenticador.
        </p>

        {mfaEnabled ? (
          <Button variant="outline" onClick={() => setDisableOpen(true)} className="w-full sm:w-auto">
            <ShieldOff /> Desativar MFA
          </Button>
        ) : (
          <Button
            onClick={() => setupMfa.mutate()}
            disabled={setupMfa.isPending}
            className="w-full sm:w-auto"
          >
            {setupMfa.isPending ? <RefreshCw className="animate-spin" /> : <KeyRound />}
            Configurar MFA
          </Button>
        )}
      </div>

      {/* (b) Sessões ativas */}
      <div className="space-y-3 lg:border-l lg:pl-6 lg:dark:border-zinc-800">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <MonitorSmartphone className="size-4 text-primary" aria-hidden /> Sessões ativas
          </h3>
          <Badge variant="outline" className="tabular-nums">
            {sessions.length}
          </Badge>
        </div>

        {sessionsQ.isLoading ? (
          <div className="space-y-2">
            {[...Array(2)].map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : sessions.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
            Nenhuma sessão ativa por senha no momento (modo demonstração com perfil demo não cria
            sessão).
          </p>
        ) : (
          <div className="max-h-72 space-y-1.5 overflow-y-auto custom-scroll pr-1" aria-label="Lista de sessões ativas">
            {sessions.map((s) => (
              <div
                key={s.id}
                className="flex items-start justify-between gap-2 rounded-lg border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                    {summarizeUserAgent(s.userAgent)}
                    {s.current && (
                      <Badge className="bg-primary/15 text-primary">Atual</Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    IP {s.ip ?? '—'} · criada em {fmtDateTime(s.createdAt)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Último uso: {s.lastUsedAt ? fmtDateTime(s.lastUsedAt) : '—'}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 shrink-0 text-destructive hover:text-destructive"
                  onClick={() => setRevokeTarget(s)}
                  aria-label={`Encerrar sessão ${summarizeUserAgent(s.userAgent)}`}
                >
                  <LogOut className="size-3.5" /> Encerrar
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Dialogs */}
      {setup && <MfaSetupDialog setup={setup} onClose={() => setSetup(null)} />}
      {disableOpen && <MfaDisableDialog onClose={() => setDisableOpen(false)} />}

      <AlertDialog
        open={!!revokeTarget}
        onOpenChange={(open) => !open && setRevokeTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Encerrar esta sessão?</AlertDialogTitle>
            <AlertDialogDescription>
              O acesso por <strong>{summarizeUserAgent(revokeTarget?.userAgent ?? null)}</strong> (IP{' '}
              {revokeTarget?.ip ?? '—'}) será revogado imediatamente — o cookie de sessão deixa de
              funcionar.
              {revokeTarget?.current && (
                <strong className="block pt-1 text-amber-700 dark:text-amber-400">
                  Atenção: é esta sessão — você será desconectado(a) do edocBR Plenário.
                </strong>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => revokeTarget && revoke.mutate(revokeTarget.id)}
            >
              Encerrar sessão
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

// ─── Módulo ─────────────────────────────────────────────────────────────────

export default function UsersModule() {
  const qc = useQueryClient()
  const canManage = useApp((s) => s.can('user.manage'))
  const actor = useApp((s) => s.actor)
  const isPlatformOwner = actor?.role === 'platform_owner'

  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [dialog, setDialog] = useState<DialogState>(null)
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null)
  const [deactivateTarget, setDeactivateTarget] = useState<UserRow | null>(null)

  // Plataforma vê todos os tenants (?all=1); tenant_admin, o próprio tenant.
  const usersQ = useQuery({
    queryKey: ['users', isPlatformOwner ? 'all' : 'tenant'],
    queryFn: () =>
      apiFetch<{ users: UserRow[]; tenants?: TenantOption[] }>(
        isPlatformOwner ? '/api/v1/users?all=1' : '/api/v1/users'
      ),
    enabled: canManage,
  })

  const users = usersQ.data?.users ?? []
  const tenants = usersQ.data?.tenants ?? []

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return users.filter(
      (u) =>
        (roleFilter === 'all' || u.role === roleFilter) &&
        (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
    )
  }, [users, search, roleFilter])

  const setActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      apiFetch<{ user: UserRow }>(`/api/v1/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active }),
      }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['users'] })
      toast.success(vars.active ? 'Usuário ativado' : 'Usuário desativado', {
        description: vars.active
          ? 'A conta voltou a aceitar login e o modo demo.'
          : 'As sessões ativas foram revogadas e novos logins são bloqueados.',
      })
      setDeactivateTarget(null)
    },
    onError: (err) => {
      toast.error('Falha ao alterar status', { description: problemMessage(err) })
      setDeactivateTarget(null)
    },
  })

  if (!canManage) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Usuários"
          description="Gestão de contas com acesso por e-mail e senha."
          icon={<UsersIcon />}
        />
        {/* F22 — Meu acesso: do próprio ator, qualquer papel autenticado. */}
        <MyAccessCard />
        <EmptyState
          icon={<UserX />}
          title="Gestão de usuários restrita"
          description="A gestão de contas (user.manage) é restrita ao Administrador da Câmara e ao Operador da Plataforma. Acima, o seu próprio acesso (MFA e sessões) continua disponível."
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Usuários"
        description="Contas com autenticação real (e-mail + senha, sessão httpOnly de 7 dias) convivendo com os perfis de demonstração. Desativar revoga as sessões ativas."
        icon={<UsersIcon />}
        actions={
          <Button onClick={() => setDialog({ mode: 'create' })}>
            <UserPlus /> Novo usuário
          </Button>
        }
      />

      {/* F22 — Meu acesso: do próprio ator, qualquer papel autenticado. */}
      <MyAccessCard />

      {/* Resumo */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Usuários</p>
          <p className="mt-1 text-2xl font-bold tabular-nums">{users.length}</p>
          <p className="truncate text-xs text-muted-foreground">
            {isPlatformOwner ? 'Todos os tenants + equipe da plataforma' : 'Escopo: sua Câmara'}
          </p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Ativos</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
            {users.filter((u) => u.active).length}
          </p>
          <p className="text-xs text-muted-foreground">podem entrar com e-mail e senha</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Inativos</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-rose-600 dark:text-rose-400">
            {users.filter((u) => !u.active).length}
          </p>
          <p className="text-xs text-muted-foreground">sessões revogadas, login bloqueado</p>
        </div>
      </div>

      {/* Lista */}
      {usersQ.isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : users.length === 0 ? (
        <EmptyState
          icon={<UsersIcon />}
          title="Nenhum usuário no escopo"
          description="Crie o primeiro usuário com senha para habilitar o acesso autenticado."
          action={
            <Button onClick={() => setDialog({ mode: 'create' })}>
              <UserPlus /> Novo usuário
            </Button>
          }
        />
      ) : (
        <section className="space-y-3" aria-label="Lista de usuários">
          {/* Filtros */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome ou e-mail…"
                className="pl-8"
                aria-label="Buscar usuários por nome ou e-mail"
              />
            </div>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="w-full sm:w-56" aria-label="Filtrar por papel">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os papéis</SelectItem>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground sm:ml-auto">
              {filtered.length} de {users.length} usuário(s)
            </p>
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              icon={<Search />}
              title="Nenhum resultado"
              description="Ajuste a busca ou o filtro de papel."
            />
          ) : (
            <div className="max-h-[65vh] overflow-auto custom-scroll rounded-xl border bg-card">
              <Table className="min-w-[52rem]">
                <TableHeader className="sticky top-0 z-10 bg-card">
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead className="hidden md:table-cell">E-mail</TableHead>
                    <TableHead>Papel</TableHead>
                    <TableHead className="hidden lg:table-cell">Cargo</TableHead>
                    <TableHead className="hidden xl:table-cell">Vínculo parlamentar</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden lg:table-cell">Criado em</TableHead>
                    <TableHead className="w-12 text-right">
                      <span className="sr-only">Ações</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((u) => (
                    <TableRow key={u.id} className={cn(!u.active && 'opacity-60')}>
                      <TableCell>
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {u.name}
                            {u.id === actor?.id && (
                              <Badge variant="outline" className="ml-2 text-[10px]">
                                você
                              </Badge>
                            )}
                          </p>
                          {isPlatformOwner && u.tenantName && (
                            <p className="truncate text-xs text-muted-foreground">{u.tenantName}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <span className="truncate text-sm text-muted-foreground">{u.email}</span>
                      </TableCell>
                      <TableCell>
                        <Badge className={cn('font-medium', ROLE_BADGE[u.role] ?? '')}>
                          {ROLE_LABEL[u.role] ?? u.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <span className="text-sm text-muted-foreground">{u.jobTitle ?? '—'}</span>
                      </TableCell>
                      <TableCell className="hidden xl:table-cell">
                        <span className="text-sm text-muted-foreground">
                          {u.parliamentarianName ?? '—'}
                        </span>
                      </TableCell>
                      <TableCell>
                        {u.active ? (
                          <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                            Ativo
                          </Badge>
                        ) : (
                          <Badge variant="outline">Inativo</Badge>
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <span className="text-sm text-muted-foreground">{fmtDateTime(u.createdAt)}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={`Ações de ${u.name}`}>
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setDialog({ mode: 'edit', user: u })}>
                              <Pencil /> Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setResetTarget(u)}>
                              <KeyRound /> Redefinir senha
                            </DropdownMenuItem>
                            {u.active ? (
                              u.id !== actor?.id && (
                                <DropdownMenuItem onClick={() => setDeactivateTarget(u)}>
                                  <UserX /> Desativar
                                </DropdownMenuItem>
                              )
                            ) : (
                              <DropdownMenuItem
                                onClick={() => setActive.mutate({ id: u.id, active: true })}
                                disabled={setActive.isPending}
                              >
                                <UserCheck /> Ativar
                              </DropdownMenuItem>
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
        </section>
      )}

      {/* Dialog criar/editar */}
      {dialog && (
        <UserDialog
          state={dialog}
          tenants={tenants}
          isPlatformOwner={!!isPlatformOwner}
          onClose={() => setDialog(null)}
        />
      )}

      {/* Dialog redefinir senha */}
      {resetTarget && <ResetPasswordDialog user={resetTarget} onClose={() => setResetTarget(null)} />}

      {/* Confirmação de desativação */}
      <AlertDialog open={!!deactivateTarget} onOpenChange={(open) => !open && setDeactivateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desativar usuário?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deactivateTarget?.name}</strong> ({deactivateTarget?.email}) deixará de
              entrar com e-mail e senha: TODAS as sessões ativas serão revogadas imediatamente e o
              ator deixa de responder no modo demo. A conta pode ser reativada depois — não há
              exclusão.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                deactivateTarget && setActive.mutate({ id: deactivateTarget.id, active: false })
              }
            >
              Desativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
