'use client'

/**
 * Tab Mesa Diretora — composição vigente (grid de cards por cargo), histórico
 * com vigência e ações: designar, confirmar/cancelar eleição, encerrar e transferir.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowRightLeft, CalendarCheck2, Gavel, History, UserRoundCheck, UserRoundMinus } from 'lucide-react'

import { api } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import { initials, fmtDateShort } from '@/lib/format'
import { legislatureLabel } from '@/lib/legislature-label'
import { civilDayStartUtc, civilDayEndUtc } from '@/lib/civil-time'
import { BOARD_ROLE_LABEL, type BoardPositionView, type ParliamentarianView, type LegislatureView } from '@/lib/contracts'
import { EmptyState } from '@/components/app/page-header'
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

const BOARD_ROLES = ['presidente', 'vice_presidente', 'primeiro_secretario', 'segundo_secretario'] as const

export default function BoardTab() {
  const can = useApp((s) => s.can)
  const canWrite = can('structure.write')
  const queryClient = useQueryClient()

  const [designateOpen, setDesignateOpen] = useState(false)
  const [transferring, setTransferring] = useState<BoardPositionView | null>(null)
  const [ending, setEnding] = useState<BoardPositionView | null>(null)
  const [electionAction, setElectionAction] = useState<{
    position: BoardPositionView; action: 'confirmar_posse' | 'cancelar_eleicao'
  } | null>(null)

  const boardQ = useQuery({ queryKey: ['board'], queryFn: () => api.listBoard() })
  const parlQ = useQuery({ queryKey: ['parliamentarians'], queryFn: () => api.listParliamentarians() })
  const legQ = useQuery({ queryKey: ['legislatures'], queryFn: () => api.listLegislatures() })

  const positions = boardQ.data?.board ?? []
  const activeParliamentarians = (parlQ.data?.parliamentarians ?? []).filter((p) => p.active)
  const legislatures = legQ.data?.legislatures ?? []
  const currentLegislature = legislatures.find((l) => l.current) ?? legislatures[0] ?? null
  const current = positions.filter((p) => p.current && p.legislatureId === currentLegislature?.id)
  const history = positions.filter((p) => !p.current || p.legislatureId !== currentLegislature?.id)

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['board'] })
  }

  const endMutation = useMutation({
    mutationFn: (id: string) => api.patchBoardPosition(id, { action: 'encerrar' }),
    onSuccess: (res) => {
      toast.success('Vigência encerrada', {
        description: `${BOARD_ROLE_LABEL[res.position.role]} — ${res.position.parliamentarianName}`,
      })
      invalidate()
      setEnding(null)
    },
  })

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4 p-4 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <Gavel className="size-4" /> Composição vigente
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {currentLegislature
                  ? `${legislatureLabel(currentLegislature.number, currentLegislature.startYear, currentLegislature.endYear)} (${currentLegislature.startYear}–${currentLegislature.endYear})`
                  : 'Cadastre uma legislatura para designar a Mesa.'}
              </p>
            </div>
            {canWrite && (
              <Button onClick={() => setDesignateOpen(true)} disabled={!currentLegislature}>
                <UserRoundCheck /> Designar cargo
              </Button>
            )}
          </div>

          {boardQ.isLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-36 rounded-xl" />
              ))}
            </div>
          ) : current.length === 0 ? (
            <EmptyState
              icon={<Gavel />}
              title="Nenhum cargo em vigência"
              description="Designe os ocupantes dos cargos da Mesa Diretora para a legislatura atual."
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {BOARD_ROLES.map((role) => {
                const pos = current.find((p) => p.role === role)
                return (
                  <Card key={role} className={pos ? undefined : 'border-dashed'}>
                    <CardContent className="flex h-full flex-col gap-3 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {BOARD_ROLE_LABEL[role]}
                      </p>
                      {pos ? (
                        <>
                          <div className="flex items-center gap-3">
                            <Avatar className="size-11">
                              <AvatarFallback className="bg-primary/15 text-sm font-bold text-primary">
                                {initials(pos.parliamentarianName)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold leading-tight">{pos.parliamentarianName}</p>
                              <PartyBadge party={pos.parliamentarianParty} />
                            </div>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            <CalendarCheck2 className="mr-1 inline size-3" aria-hidden />
                            Desde {fmtDateShort(pos.startDate)}
                          </p>
                          {canWrite && (
                            <div className="mt-auto flex gap-1.5 pt-1">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 flex-1"
                                onClick={() => setTransferring(pos)}
                              >
                                <ArrowRightLeft className="size-3.5" /> Transferir
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8"
                                aria-label={`Encerrar vigência de ${pos.parliamentarianName}`}
                                onClick={() => setEnding(pos)}
                              >
                                <UserRoundMinus className="size-3.5" />
                              </Button>
                            </div>
                          )}
                        </>
                      ) : (
                        <p className="flex flex-1 items-center text-sm text-muted-foreground">
                          {canWrite ? 'Vago — use “Designar cargo”.' : 'Cargo vago.'}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4 sm:p-6">
          <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <History className="size-4" /> Histórico e próximas composições da Mesa
          </h3>
          {boardQ.isLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma composição encerrada ou futura cadastrada.
            </p>
          ) : (
            <div className="max-h-96 overflow-y-auto custom-scroll rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Cargo</TableHead>
                    <TableHead scope="col">Parlamentar</TableHead>
                    <TableHead scope="col">Legislatura</TableHead>
                    <TableHead scope="col">Vigência</TableHead>
                    <TableHead scope="col" className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-sm">{BOARD_ROLE_LABEL[p.role] ?? p.role}</TableCell>
                      <TableCell className="text-sm font-medium">{p.parliamentarianName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{p.legislatureNumber === null ? 'Número pendente' : `${p.legislatureNumber}ª`}</TableCell>
                      <TableCell className="text-sm tabular-nums text-muted-foreground">
                        {fmtDateShort(p.startDate)} → {fmtDateShort(p.endDate)}
                        {p.status === 'elected' && <Badge variant="outline" className="ml-2">Eleita · posse pendente</Badge>}
                        {p.status === 'cancelled' && <Badge variant="outline" className="ml-2">Eleição cancelada</Badge>}
                        {p.status === 'confirmed' && new Date(p.startDate) > new Date() && <Badge variant="outline" className="ml-2">Programada</Badge>}
                      </TableCell>
                      <TableCell className="text-right">
                        {canWrite && p.status === 'elected' && <div className="flex justify-end gap-2">
                          <Button variant="outline" size="sm" onClick={() => setElectionAction({ position: p, action: 'confirmar_posse' })}>Confirmar posse</Button>
                          <Button variant="ghost" size="sm" onClick={() => setElectionAction({ position: p, action: 'cancelar_eleicao' })}>Cancelar eleição</Button>
                        </div>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Designar cargo */}
      <DesignateDialog
        open={designateOpen}
        onOpenChange={setDesignateOpen}
        parliamentarians={activeParliamentarians}
        legislatures={legislatures}
        defaultLegislatureId={currentLegislature?.id ?? null}
        occupiedRoles={current.map((p) => p.role)}
      />

      {/* Transferir cargo */}
      <TransferDialog
        position={transferring}
        onOpenChange={(v) => !v && setTransferring(null)}
        parliamentarians={activeParliamentarians}
      />

      <ElectionDecisionDialog
        key={electionAction ? `${electionAction.position.id}:${electionAction.action}` : 'closed'}
        decision={electionAction}
        onClose={() => setElectionAction(null)}
      />

      {/* Encerrar vigência */}
      <AlertDialog open={!!ending} onOpenChange={(v) => !v && setEnding(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Encerrar vigência do cargo?</AlertDialogTitle>
            <AlertDialogDescription>
              {ending && (
                <>
                  <strong>{BOARD_ROLE_LABEL[ending.role]}</strong> — {ending.parliamentarianName} deixará o cargo com
                  vigência encerrada em agora. O registro histórico é preservado e o cargo fica vago.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Manter vigência</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => ending && endMutation.mutate(ending.id)}
              disabled={endMutation.isPending}
            >
              Encerrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function ElectionDecisionDialog({
  decision, onClose,
}: {
  decision: { position: BoardPositionView; action: 'confirmar_posse' | 'cancelar_eleicao' } | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const timeZone = useApp((state) => state.bootstrap?.tenant.timezone ?? 'America/Sao_Paulo')
  const [reference, setReference] = useState('')
  const [date, setDate] = useState(decision?.position.startDate.slice(0, 10) ?? '')
  const confirm = decision?.action === 'confirmar_posse'
  const mutation = useMutation({
    mutationFn: () => {
      if (!decision) throw new Error('Selecione uma posição da Mesa.')
      const dateChanged = confirm && date !== decision.position.startDate.slice(0, 10)
      return api.patchBoardPosition(decision.position.id, {
        action: decision.action,
        confirmationReference: reference.trim(),
        ...(dateChanged ? { startDate: civilDayStartUtc(date, timeZone) } : {}),
      })
    },
    onSuccess: () => {
      toast.success(confirm ? 'Posse registrada' : 'Eleição cancelada')
      queryClient.invalidateQueries({ queryKey: ['board'] })
      queryClient.invalidateQueries({ queryKey: ['parliamentarians'] })
      queryClient.invalidateQueries({ queryKey: ['official-configuration'] })
      onClose()
    },
    onError: (error) => toast.error(error.message),
  })

  return (
    <Dialog open={!!decision} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{confirm ? 'Confirmar posse' : 'Cancelar eleição'}</DialogTitle>
          <DialogDescription>
            {decision && `${BOARD_ROLE_LABEL[decision.position.role]} — ${decision.position.parliamentarianName}. `}
            {confirm ? 'A Mesa só entra em exercício após este registro auditado.' : 'O registro da eleição será preservado no histórico.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {confirm && <div className="grid gap-2">
            <Label htmlFor="board-possession-date">Data civil da posse</Label>
            <Input id="board-possession-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            <p className="text-xs text-muted-foreground">A confirmação exige que a posse já tenha ocorrido. Se a data mudou, informe o dia efetivo.</p>
          </div>}
          <div className="grid gap-2">
            <Label htmlFor="board-decision-reference">Referência do ato *</Label>
            <Input id="board-decision-reference" value={reference} onChange={(event) => setReference(event.target.value)}
              placeholder={confirm ? 'Ex.: Ata da sessão de posse' : 'Ex.: Resolução que tornou a eleição sem efeito'} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Voltar</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || reference.trim().length < 5 || (confirm && !/^\d{4}-\d{2}-\d{2}$/.test(date))}>
            {mutation.isPending ? 'Registrando…' : confirm ? 'Confirmar posse' : 'Registrar cancelamento'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DesignateDialog({
  open,
  onOpenChange,
  parliamentarians,
  legislatures,
  defaultLegislatureId,
  occupiedRoles,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  parliamentarians: ParliamentarianView[]
  legislatures: LegislatureView[]
  defaultLegislatureId: string | null
  occupiedRoles: string[]
}) {
  const queryClient = useQueryClient()
  const timeZone = useApp((state) => state.bootstrap?.tenant.timezone ?? 'America/Sao_Paulo')
  const [legislatureId, setLegislatureId] = useState(defaultLegislatureId ?? '')
  const [role, setRole] = useState<string>('presidente')
  const [parliamentarianId, setParliamentarianId] = useState('')
  const [kind, setKind] = useState<'confirmed' | 'elected'>('confirmed')
  const [startDay, setStartDay] = useState('')
  const [endDay, setEndDay] = useState('')
  const [electionReference, setElectionReference] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const mutation = useMutation({
    mutationFn: () =>
      api.createBoardPosition({ legislatureId, role, parliamentarianId, status: kind,
        ...(kind === 'elected' ? { startDate: civilDayStartUtc(startDay, timeZone),
          endDate: endDay ? civilDayEndUtc(endDay, timeZone) : null,
          electionReference: electionReference.trim() } : {}),
      }),
    onSuccess: (res) => {
      toast.success(kind === 'elected' ? 'Eleição registrada; posse pendente' : 'Cargo designado', {
        description: `${BOARD_ROLE_LABEL[res.position.role]}: ${res.position.parliamentarianName}`,
      })
      queryClient.invalidateQueries({ queryKey: ['board'] })
      queryClient.invalidateQueries({ queryKey: ['official-configuration'] })
      setRole('presidente')
      setParliamentarianId('')
      setKind('confirmed')
      setStartDay('')
      setEndDay('')
      setElectionReference('')
      setErrors({})
      onOpenChange(false)
    },
  })

  const submit = () => {
    const errs: Record<string, string> = {}
    if (!legislatureId) errs.legislatureId = 'Selecione a legislatura.'
    if (!parliamentarianId) errs.parliamentarianId = 'Selecione o parlamentar.'
    if (kind === 'confirmed' && occupiedRoles.includes(role)) errs.role = 'Cargo em exercício — encerre ou transfira antes.'
    if (kind === 'elected') {
      if (electionReference.trim().length < 5) errs.electionReference = 'Informe a referência do ato de eleição.'
      try { civilDayStartUtc(startDay, timeZone) } catch { errs.startDay = 'Informe a data prevista de posse.' }
      if (endDay) {
        try { civilDayEndUtc(endDay, timeZone) } catch { errs.endDay = 'Informe uma data final válida.' }
        if (endDay < startDay) errs.endDay = 'O período termina antes da posse.'
      }
    }
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    mutation.mutate()
  }

  const availableRoles = kind === 'elected' ? BOARD_ROLES : BOARD_ROLES.filter((r) => !occupiedRoles.includes(r))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Designar cargo da Mesa</DialogTitle>
          <DialogDescription>
            Registre quem exerce o cargo agora ou uma eleição para posse futura. A eleição não ativa a Mesa automaticamente.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="board-kind">Situação</Label>
            <Select value={kind} onValueChange={(value) => setKind(value as 'confirmed' | 'elected')}>
              <SelectTrigger id="board-kind" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="confirmed">Cargo em exercício</SelectItem>
                <SelectItem value="elected">Eleição para posse futura</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="board-legislature">Legislatura *</Label>
            <Select value={legislatureId} onValueChange={setLegislatureId}>
              <SelectTrigger id="board-legislature" className="w-full">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {legislatures.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {legislatureLabel(l.number, l.startYear, l.endYear)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.legislatureId && <p className="text-xs text-destructive">{errors.legislatureId}</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="board-role">Cargo *</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger id="board-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableRoles.map((r) => (
                  <SelectItem key={r} value={r}>
                    {BOARD_ROLE_LABEL[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.role && <p className="text-xs text-destructive">{errors.role}</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="board-parl">Parlamentar *</Label>
            <Select value={parliamentarianId} onValueChange={setParliamentarianId}>
              <SelectTrigger id="board-parl" className="w-full">
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
          {kind === 'elected' && <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="board-start-day">Data prevista da posse *</Label>
              <Input id="board-start-day" type="date" value={startDay} onChange={(event) => setStartDay(event.target.value)} aria-invalid={!!errors.startDay} />
              {errors.startDay && <p className="text-xs text-destructive">{errors.startDay}</p>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="board-end-day">Fim do período (opcional)</Label>
              <Input id="board-end-day" type="date" value={endDay} onChange={(event) => setEndDay(event.target.value)} aria-invalid={!!errors.endDay} />
              {errors.endDay && <p className="text-xs text-destructive">{errors.endDay}</p>}
            </div>
          </div>}
          {kind === 'elected' && <div className="grid gap-2">
            <Label htmlFor="board-election-reference">Referência do ato de eleição *</Label>
            <Input id="board-election-reference" value={electionReference} onChange={(event) => setElectionReference(event.target.value)}
              placeholder="Ex.: Ata da eleição da Mesa 1/2026" aria-invalid={!!errors.electionReference} />
            {errors.electionReference && <p className="text-xs text-destructive">{errors.electionReference}</p>}
          </div>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? 'Registrando…' : kind === 'elected' ? 'Registrar eleição' : 'Designar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TransferDialog({
  position,
  onOpenChange,
  parliamentarians,
}: {
  position: BoardPositionView | null
  onOpenChange: (v: boolean) => void
  parliamentarians: ParliamentarianView[]
}) {
  const queryClient = useQueryClient()
  const [parliamentarianId, setParliamentarianId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: (id: string) =>
      api.patchBoardPosition(position!.id, { action: 'transferir', parliamentarianId: id }),
    onSuccess: (res) => {
      toast.success('Cargo transferido', {
        description: res.successor
          ? `${BOARD_ROLE_LABEL[res.successor.role]}: ${res.successor.parliamentarianName}`
          : undefined,
      })
      queryClient.invalidateQueries({ queryKey: ['board'] })
      setParliamentarianId('')
      setError(null)
      onOpenChange(false)
    },
  })

  const submit = () => {
    if (!parliamentarianId) {
      setError('Selecione o novo ocupante do cargo.')
      return
    }
    setError(null)
    mutation.mutate(parliamentarianId)
  }

  return (
    <Dialog open={!!position} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Transferir {position ? BOARD_ROLE_LABEL[position.role] : 'cargo'}
          </DialogTitle>
          <DialogDescription>
            {position && (
              <>
                Vigência de <strong>{position.parliamentarianName}</strong> é encerrada agora e o parlamentar
                selecionado assume com nova vigência — histórico preservado.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="transfer-parl">Novo ocupante *</Label>
          <Select value={parliamentarianId} onValueChange={setParliamentarianId}>
            <SelectTrigger id="transfer-parl" className="w-full">
              <SelectValue placeholder="Selecione o parlamentar" />
            </SelectTrigger>
            <SelectContent>
              {parliamentarians
                .filter((p) => p.id !== position?.parliamentarianId)
                .map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name} ({p.party})
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? 'Transferindo…' : 'Transferir cargo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
