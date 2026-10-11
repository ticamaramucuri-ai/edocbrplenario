'use client'

/**
 * Módulo Parlamentares — cadastro da legislatura: grid de cards com filtros,
 * criação/edição (Dialog) e desativação (AlertDialog, soft delete).
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Mail, MoreVertical, Pencil, Phone, ShieldOff, Users } from 'lucide-react'

import { api } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import { initials } from '@/lib/format'
import { BOARD_ROLE_LABEL, type ParliamentarianView } from '@/lib/contracts'
import { EmptyState, PageHeader } from '@/components/app/page-header'
import { PartyBadge } from '@/components/app/badges'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'

const BLOCOS = ['Situação', 'Oposição', 'Independente'] as const
const BOARD_ROLES = Object.keys(BOARD_ROLE_LABEL)

type FormState = {
  name: string
  party: string
  bloc: string
  boardRole: string
  committee: string
  email: string
  phone: string
}

const emptyForm: FormState = {
  name: '',
  party: '',
  bloc: '',
  boardRole: 'vereador',
  committee: '',
  email: '',
  phone: '',
}

function formFromParliamentarian(p: ParliamentarianView): FormState {
  return {
    name: p.name,
    party: p.party,
    bloc: p.bloc ?? '',
    boardRole: p.boardRole || 'vereador',
    committee: p.committee ?? '',
    email: p.email ?? '',
    phone: p.phone ?? '',
  }
}

function ParliamentarianForm({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  editing: ParliamentarianView | null
}) {
  const queryClient = useQueryClient()
  // Inicializado na montagem (o pai remonta o form a cada abertura com key)
  const [form, setForm] = useState<FormState>(() => (editing ? formFromParliamentarian(editing) : emptyForm))
  const [errors, setErrors] = useState<Record<string, string>>({})

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        party: form.party.trim().toUpperCase(),
        bloc: form.bloc || null,
        boardRole: form.boardRole,
        committee: form.committee.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
      }
      return editing ? api.updateParliamentarian(editing.id, payload) : api.createParliamentarian(payload)
    },
    onSuccess: () => {
      toast.success(editing ? 'Parlamentar atualizado' : 'Parlamentar cadastrado', {
        description: form.name.trim(),
      })
      queryClient.invalidateQueries({ queryKey: ['parliamentarians'] })
      onOpenChange(false)
    },
  })

  const submit = () => {
    const errs: Record<string, string> = {}
    if (form.name.trim().length < 3) errs.name = 'Informe o nome completo (mín. 3 caracteres).'
    const party = form.party.trim()
    if (party.length < 2 || party.length > 10) errs.party = 'Sigla com 2 a 10 caracteres.'
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))
      errs.email = 'E-mail inválido.'
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    mutation.mutate()
  }

  const set = (field: keyof FormState, value: string) => setForm((f) => ({ ...f, [field]: value }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto custom-scroll sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? 'Editar parlamentar' : 'Novo parlamentar'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'Atualize os dados cadastrais. Alterações são auditadas.'
              : 'Cadastre um integrante da legislatura. O cadastro entra em vigor imediatamente.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="parl-name">Nome completo *</Label>
            <Input
              id="parl-name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Ex.: Maria Aparecida Souza"
              aria-invalid={!!errors.name}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="parl-party">Partido (sigla) *</Label>
              <Input
                id="parl-party"
                value={form.party}
                onChange={(e) => set('party', e.target.value.toUpperCase())}
                placeholder="Ex.: PSD"
                maxLength={10}
                aria-invalid={!!errors.party}
              />
              {errors.party && <p className="text-xs text-destructive">{errors.party}</p>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="parl-bloc">Bloco</Label>
              <Select value={form.bloc} onValueChange={(v) => set('bloc', v === 'nenhum' ? '' : v)}>
                <SelectTrigger id="parl-bloc" className="w-full">
                  <SelectValue placeholder="Sem bloco" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nenhum">Sem bloco</SelectItem>
                  {BLOCOS.map((b) => (
                    <SelectItem key={b} value={b}>
                      {b}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="parl-role">Cargo na mesa</Label>
              <Select value={form.boardRole} onValueChange={(v) => set('boardRole', v)}>
                <SelectTrigger id="parl-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BOARD_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {BOARD_ROLE_LABEL[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="parl-committee">Comissão</Label>
              <Input
                id="parl-committee"
                value={form.committee}
                onChange={(e) => set('committee', e.target.value)}
                placeholder="Ex.: Constituição e Justiça"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="parl-email">E-mail</Label>
              <Input
                id="parl-email"
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                placeholder="vereador@camara.gov.br"
                aria-invalid={!!errors.email}
              />
              {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="parl-phone">Telefone</Label>
              <Input
                id="parl-phone"
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
                placeholder="(00) 00000-0000"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? 'Salvando…' : editing ? 'Salvar alterações' : 'Cadastrar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function ParliamentariansModule() {
  const can = useApp((s) => s.can)
  const canWrite = can('parliamentarian.write')
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({ queryKey: ['parliamentarians'], queryFn: () => api.listParliamentarians() })

  const [partyFilter, setPartyFilter] = useState('todas')
  const [blocFilter, setBlocFilter] = useState('todos')
  const [onlyActive, setOnlyActive] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogKey, setDialogKey] = useState(0)
  const [editing, setEditing] = useState<ParliamentarianView | null>(null)
  const [deactivating, setDeactivating] = useState<ParliamentarianView | null>(null)

  const parliamentarians = data?.parliamentarians ?? []
  const parties = useMemo(() => [...new Set(parliamentarians.map((p) => p.party))].sort(), [parliamentarians])
  const blocs = useMemo(
    () => [...new Set(parliamentarians.map((p) => p.bloc).filter((b): b is string => !!b))].sort(),
    [parliamentarians]
  )

  const filtered = parliamentarians.filter((p) => {
    if (onlyActive && !p.active) return false
    if (partyFilter !== 'todas' && p.party !== partyFilter) return false
    if (blocFilter !== 'todos' && p.bloc !== blocFilter) return false
    return true
  })

  const deactivate = useMutation({
    mutationFn: (id: string) => api.deleteParliamentarian(id),
    onSuccess: () => {
      toast.success('Parlamentar desativado', { description: 'O histórico legislativo é preservado (desativação reversível).' })
      queryClient.invalidateQueries({ queryKey: ['parliamentarians'] })
      setDeactivating(null)
    },
  })

  const openCreate = () => {
    setEditing(null)
    setDialogKey((k) => k + 1)
    setDialogOpen(true)
  }
  const openEdit = (p: ParliamentarianView) => {
    setEditing(p)
    setDialogKey((k) => k + 1)
    setDialogOpen(true)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Parlamentares"
        description={
          isLoading
            ? 'Carregando legislatura…'
            : `${parliamentarians.length} cadastros · ${parliamentarians.filter((p) => p.active).length} ativos`
        }
        icon={<Users />}
        actions={
          canWrite ? (
            <Button onClick={openCreate}>
              <Users /> Novo parlamentar
            </Button>
          ) : undefined
        }
      />

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-3" role="search" aria-label="Filtros de parlamentares">
        <div className="grid gap-1.5">
          <Label htmlFor="filter-party" className="text-xs text-muted-foreground">
            Partido
          </Label>
          <Select value={partyFilter} onValueChange={setPartyFilter}>
            <SelectTrigger id="filter-party" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todos</SelectItem>
              {parties.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="filter-bloc" className="text-xs text-muted-foreground">
            Bloco
          </Label>
          <Select value={blocFilter} onValueChange={setBlocFilter}>
            <SelectTrigger id="filter-bloc" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {blocs.map((b) => (
                <SelectItem key={b} value={b}>
                  {b}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex h-9 items-center gap-2 pb-0.5">
          <Switch id="filter-active" checked={onlyActive} onCheckedChange={setOnlyActive} />
          <Label htmlFor="filter-active" className="text-sm">
            Somente ativos
          </Label>
        </div>
        <p className="ml-auto self-center text-sm text-muted-foreground tabular-nums" aria-live="polite">
          {filtered.length} exibindo
        </p>
      </div>

      {/* Grid de cards */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Users />}
          title="Nenhum parlamentar encontrado"
          description="Ajuste os filtros ou cadastre um novo parlamentar."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((p) => (
            <Card key={p.id} className={p.active ? undefined : 'opacity-75'}>
              <CardContent className="flex h-full flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar className="size-11">
                      <AvatarFallback className="bg-primary/15 text-sm font-bold text-primary">
                        {initials(p.name) || '—'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate font-semibold leading-tight">{p.name}</p>
                      <p className="text-xs text-muted-foreground">{BOARD_ROLE_LABEL[p.boardRole] ?? p.boardRole}</p>
                    </div>
                  </div>
                  {canWrite && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 shrink-0"
                          aria-label={`Ações de ${p.name}`}
                        >
                          <MoreVertical className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>{p.name}</DropdownMenuLabel>
                        <DropdownMenuItem onClick={() => openEdit(p)}>
                          <Pencil /> Editar
                        </DropdownMenuItem>
                        {p.active && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onClick={() => setDeactivating(p)}
                              disabled={deactivate.isPending}
                            >
                              <ShieldOff /> Desativar
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <PartyBadge party={p.party} bloc={p.bloc} />
                  {!p.active && <Badge variant="destructive">Inativo</Badge>}
                </div>

                <div className="mt-auto space-y-1 text-xs text-muted-foreground">
                  {p.committee && (
                    <p className="truncate" title={`Comissão: ${p.committee}`}>
                      Comissão: {p.committee}
                    </p>
                  )}
                  {p.email ? (
                    <p className="flex items-center gap-1.5 truncate">
                      <Mail className="size-3.5 shrink-0" aria-hidden />
                      <a className="truncate underline-offset-2 hover:underline" href={`mailto:${p.email}`}>
                        {p.email}
                      </a>
                    </p>
                  ) : (
                    <p className="flex items-center gap-1.5">
                      <Mail className="size-3.5 shrink-0" aria-hidden /> Sem e-mail
                    </p>
                  )}
                  {p.phone && (
                    <p className="flex items-center gap-1.5 truncate">
                      <Phone className="size-3.5 shrink-0" aria-hidden /> {p.phone}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Dialog criar/editar */}
      <ParliamentarianForm key={dialogKey} open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} />

      {/* Confirmação de desativação */}
      <AlertDialog open={!!deactivating} onOpenChange={(v) => !v && setDeactivating(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desativar parlamentar?</AlertDialogTitle>
            <AlertDialogDescription>
              {deactivating?.name} deixará de constar nas listas operacionais e no quórum das sessões. O histórico de
              votos, presenças e discursos é preservado. A desativação pode ser revertida pela edição do cadastro.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter cadastro</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => deactivating && deactivate.mutate(deactivating.id)}
            >
              Desativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
