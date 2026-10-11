'use client'

/**
 * Tab Mandatos e Afastamentos — por legislatura: mandatos (parlamentar +
 * período + votos) e afastamentos (kind badge, período, motivo, suplente,
 * encerrar). Criação de mandato e de afastamento.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  BadgeCheck,
  CalendarPlus,
  CheckCircle2,
  Clock,
  UserMinus,
  UserRound,
  UserRoundSearch,
} from 'lucide-react'

import { api } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import { fmtDateShort } from '@/lib/format'
import {
  LEAVE_KIND_LABEL,
  type LeaveView,
  type ParliamentarianView,
} from '@/lib/contracts'
import { EmptyState } from '@/components/app/page-header'
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'

const LEAVE_KINDS = ['licenca', 'afastamento', 'suplencia'] as const

export default function MandatesLeavesTab() {
  const can = useApp((s) => s.can)
  const canWrite = can('structure.write')
  const queryClient = useQueryClient()

  const [legislatureFilter, setLegislatureFilter] = useState('')
  const [mandateOpen, setMandateOpen] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [endingLeave, setEndingLeave] = useState<LeaveView | null>(null)

  const legQ = useQuery({ queryKey: ['legislatures'], queryFn: () => api.listLegislatures() })
  const legislatures = legQ.data?.legislatures ?? []
  const currentLegislature = legislatures.find((l) => l.current) ?? legislatures[0] ?? null
  const effectiveFilter = legislatureFilter || currentLegislature?.id || ''

  const mandatesQ = useQuery({
    queryKey: ['mandates', effectiveFilter],
    queryFn: () => api.listMandates({ legislatureId: effectiveFilter || undefined }),
  })
  const leavesQ = useQuery({
    queryKey: ['leaves'],
    queryFn: () => api.listLeaves(),
  })

  const mandates = mandatesQ.data?.mandates ?? []
  const leaves = leavesQ.data?.leaves ?? []

  const endLeave = useMutation({
    mutationFn: (id: string) => api.patchLeave(id, { action: 'encerrar' }),
    onSuccess: (res) => {
      toast.success('Afastamento encerrado', {
        description: `${LEAVE_KIND_LABEL[res.leave.kind]} de ${res.leave.parliamentarianName}`,
      })
      queryClient.invalidateQueries({ queryKey: ['leaves'] })
      setEndingLeave(null)
    },
  })

  return (
    <div className="space-y-6">
      {/* Filtro por legislatura */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="mandate-leg-filter" className="text-xs text-muted-foreground">
            Legislatura
          </Label>
          <Select value={effectiveFilter} onValueChange={setLegislatureFilter}>
            <SelectTrigger id="mandate-leg-filter" className="w-52">
              <SelectValue placeholder="Todas" />
            </SelectTrigger>
            <SelectContent>
              {legislatures.map((l) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.number}ª Legislatura ({l.startYear}–{l.endYear}){l.current ? ' · atual' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {canWrite && (
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={() => setLeaveOpen(true)}>
              <UserMinus /> Registrar afastamento
            </Button>
            <Button onClick={() => setMandateOpen(true)} disabled={!effectiveFilter}>
              <BadgeCheck /> Novo mandato
            </Button>
          </div>
        )}
      </div>

      {/* Mandatos */}
      <Card>
        <CardContent className="space-y-3 p-4 sm:p-6">
          <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <UserRound className="size-4" /> Mandatos
            <span className="font-normal normal-case">({mandates.length})</span>
          </h3>
          {mandatesQ.isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : mandates.length === 0 ? (
            <EmptyState
              icon={<UserRound />}
              title="Nenhum mandato nesta legislatura"
              description="Registre os mandatos dos parlamentares eleitos para a legislatura selecionada."
            />
          ) : (
            <div className="max-h-96 overflow-y-auto custom-scroll rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Parlamentar</TableHead>
                    <TableHead scope="col">Partido</TableHead>
                    <TableHead scope="col">Período</TableHead>
                    <TableHead scope="col" className="text-right">Votos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {mandates.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">{m.parliamentarianName}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono text-[11px]">
                          {m.parliamentarianParty}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {fmtDateShort(m.startDate)} → {m.endDate ? fmtDateShort(m.endDate) : 'vigente'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {m.votes ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Afastamentos */}
      <Card>
        <CardContent className="space-y-3 p-4 sm:p-6">
          <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <UserMinus className="size-4" /> Licenças, afastamentos e suplências
            <span className="font-normal normal-case">({leaves.length})</span>
          </h3>
          {leavesQ.isLoading ? (
            <div className="space-y-2">
              {[...Array(2)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : leaves.length === 0 ? (
            <EmptyState
              icon={<UserMinus />}
              title="Nenhum afastamento registrado"
              description="Licenças, afastamentos e suplências aparecem aqui com período e suplente."
            />
          ) : (
            <ul className="max-h-96 space-y-2 overflow-y-auto custom-scroll pr-1" aria-label="Lista de afastamentos">
              {leaves.map((l) => (
                <li key={l.id} className={`rounded-lg border p-3 ${l.current ? '' : 'opacity-70'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">
                        {l.parliamentarianName}{' '}
                        <LeaveKindBadge kind={l.kind} />
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{l.reason}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="size-3" aria-hidden />
                          {fmtDateShort(l.startDate)} → {l.endDate ? fmtDateShort(l.endDate) : 'vigente'}
                        </span>
                        {l.substituteName && (
                          <span className="inline-flex items-center gap-1">
                            <UserRoundSearch className="size-3" aria-hidden /> Suplente: {l.substituteName}
                          </span>
                        )}
                      </p>
                    </div>
                    {canWrite && l.current && (
                      <Button variant="outline" size="sm" className="h-8" onClick={() => setEndingLeave(l)}>
                        Encerrar
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Novo mandato */}
      <MandateDialog
        open={mandateOpen}
        onOpenChange={setMandateOpen}
        legislatureId={effectiveFilter}
      />

      {/* Novo afastamento */}
      <LeaveDialog open={leaveOpen} onOpenChange={setLeaveOpen} />

      {/* Encerrar afastamento */}
      <AlertDialog open={!!endingLeave} onOpenChange={(v) => !v && setEndingLeave(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Encerrar {endingLeave ? LEAVE_KIND_LABEL[endingLeave.kind].toLowerCase() : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              {endingLeave && (
                <>
                  A vigência de <strong>{endingLeave.parliamentarianName}</strong> será encerrada agora
                  ({fmtDateShort(endingLeave.startDate)} → hoje). O histórico é preservado.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter vigência</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => endingLeave && endLeave.mutate(endingLeave.id)}
              disabled={endLeave.isPending}
            >
              Encerrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function LeaveKindBadge({ kind }: { kind: string }) {
  const map: Record<string, string> = {
    licenca: 'text-emerald-700 dark:text-emerald-400',
    afastamento: 'text-amber-700 dark:text-amber-400',
    suplencia: 'text-primary',
  }
  return (
    <Badge variant="outline" className={`ml-1 align-middle text-[11px] ${map[kind] ?? ''}`}>
      {LEAVE_KIND_LABEL[kind] ?? kind}
    </Badge>
  )
}

function MandateDialog({
  open,
  onOpenChange,
  legislatureId,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  legislatureId: string
}) {
  const queryClient = useQueryClient()
  const [parliamentarianId, setParliamentarianId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [votes, setVotes] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const parlQ = useQuery({ queryKey: ['parliamentarians'], queryFn: () => api.listParliamentarians() })
  const parliamentarians = (parlQ.data?.parliamentarians ?? []).filter((p) => p.active)

  const mandatesQ = useQuery({
    queryKey: ['mandates', legislatureId],
    queryFn: () => api.listMandates({ legislatureId }),
    enabled: !!legislatureId,
  })
  const withMandate = new Set((mandatesQ.data?.mandates ?? []).map((m) => m.parliamentarianId))

  const mutation = useMutation({
    mutationFn: () =>
      api.createMandate({
        parliamentarianId,
        legislatureId,
        startDate: new Date(startDate).toISOString(),
        votes: votes.trim() === '' ? null : Number(votes),
      }),
    onSuccess: () => {
      toast.success('Mandato registrado')
      queryClient.invalidateQueries({ queryKey: ['mandates'] })
      setParliamentarianId('')
      setStartDate('')
      setVotes('')
      setErrors({})
      onOpenChange(false)
    },
  })

  const submit = () => {
    const errs: Record<string, string> = {}
    if (!parliamentarianId) errs.parliamentarianId = 'Selecione o parlamentar.'
    if (!startDate) errs.startDate = 'Informe a data de início.'
    if (votes.trim() !== '' && !/^\d+$/.test(votes.trim())) errs.votes = 'Votos deve ser um número.'
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    mutation.mutate()
  }

  const options = parliamentarians.filter((p) => !withMandate.has(p.id))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo mandato</DialogTitle>
          <DialogDescription>
            Um parlamentar possui um único mandato por legislatura. Parlamentares já com mandato não aparecem.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="mandate-parl">Parlamentar *</Label>
            <Select value={parliamentarianId} onValueChange={setParliamentarianId}>
              <SelectTrigger id="mandate-parl" className="w-full">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {options.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} ({p.party})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.parliamentarianId && <p className="text-xs text-destructive">{errors.parliamentarianId}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="mandate-start">Início *</Label>
              <Input id="mandate-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} aria-invalid={!!errors.startDate} />
              {errors.startDate && <p className="text-xs text-destructive">{errors.startDate}</p>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="mandate-votes">Votos recebidos</Label>
              <Input id="mandate-votes" inputMode="numeric" value={votes} onChange={(e) => setVotes(e.target.value)} placeholder="Ex.: 1250" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? 'Registrando…' : 'Registrar mandato'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function LeaveDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const queryClient = useQueryClient()
  const [parliamentarianId, setParliamentarianId] = useState('')
  const [kind, setKind] = useState<string>('licenca')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState('')
  const [substituteId, setSubstituteId] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const parlQ = useQuery({ queryKey: ['parliamentarians'], queryFn: () => api.listParliamentarians() })
  const parliamentarians: ParliamentarianView[] = parlQ.data?.parliamentarians ?? []

  const mutation = useMutation({
    mutationFn: () =>
      api.createLeave({
        parliamentarianId,
        kind,
        startDate: new Date(startDate).toISOString(),
        endDate: endDate ? new Date(endDate).toISOString() : null,
        reason: reason.trim(),
        substituteId: substituteId || null,
      }),
    onSuccess: () => {
      toast.success('Afastamento registrado', { description: `${LEAVE_KIND_LABEL[kind]} — ${reason.trim()}` })
      queryClient.invalidateQueries({ queryKey: ['leaves'] })
      setParliamentarianId('')
      setKind('licenca')
      setStartDate('')
      setEndDate('')
      setReason('')
      setSubstituteId('')
      setErrors({})
      onOpenChange(false)
    },
  })

  const submit = () => {
    const errs: Record<string, string> = {}
    if (!parliamentarianId) errs.parliamentarianId = 'Selecione o parlamentar.'
    if (!startDate) errs.startDate = 'Informe a data de início.'
    if (reason.trim().length < 3) errs.reason = 'Descreva o motivo.'
    if (endDate && endDate < startDate) errs.endDate = 'Fim anterior ao início.'
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    mutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto custom-scroll sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar afastamento</DialogTitle>
          <DialogDescription>
            Licenças, afastamentos e suplências com vigência. Deixe o fim vazio para vigência aberta.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="leave-parl">Parlamentar *</Label>
            <Select value={parliamentarianId} onValueChange={setParliamentarianId}>
              <SelectTrigger id="leave-parl" className="w-full">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {parliamentarians.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} ({p.party})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.parliamentarianId && <p className="text-xs text-destructive">{errors.parliamentarianId}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="leave-kind">Espécie</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger id="leave-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEAVE_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {LEAVE_KIND_LABEL[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="leave-sub">Suplente</Label>
              <Select value={substituteId || 'nenhum'} onValueChange={(v) => setSubstituteId(v === 'nenhum' ? '' : v)}>
                <SelectTrigger id="leave-sub" className="w-full">
                  <SelectValue placeholder="Sem suplente" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nenhum">Sem suplente</SelectItem>
                  {parliamentarians
                    .filter((p) => p.id !== parliamentarianId)
                    .map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="leave-start">Início *</Label>
              <Input id="leave-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} aria-invalid={!!errors.startDate} />
              {errors.startDate && <p className="text-xs text-destructive">{errors.startDate}</p>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="leave-end">Fim (previsto)</Label>
              <Input id="leave-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} aria-invalid={!!errors.endDate} />
              {errors.endDate && <p className="text-xs text-destructive">{errors.endDate}</p>}
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="leave-reason">Motivo *</Label>
            <Textarea id="leave-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Ex.: licença médica de 30 dias (Of. nº 112)" aria-invalid={!!errors.reason} />
            {errors.reason && <p className="text-xs text-destructive">{errors.reason}</p>}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? 'Registrando…' : 'Registrar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
