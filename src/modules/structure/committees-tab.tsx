'use client'

/**
 * Tab Comissões — lista de comissões (cards), criar, drawer de detalhe com
 * membros (adicionar/encerrar), reuniões (agendar, realizada/cancelada).
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  CalendarPlus,
  CheckCircle2,
  CircleOff,
  ClipboardList,
  Plus,
  ShieldOff,
  UserPlus,
  Users,
  XCircle,
} from 'lucide-react'

import { api } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import { initials, fmtDateTime } from '@/lib/format'
import {
  COMMITTEE_KIND_LABEL,
  COMMITTEE_MEMBER_ROLE_LABEL,
  COMMITTEE_MEETING_STATUS_LABEL,
  type CommitteeMemberView,
  type CommitteeView,
  type ParliamentarianView,
} from '@/lib/contracts'
import { EmptyState } from '@/components/app/page-header'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'

const MEMBER_ROLES = ['presidente', 'vice', 'relator', 'titular', 'suplente'] as const

export default function CommitteesTab() {
  const can = useApp((s) => s.can)
  const canWrite = can('structure.write')
  const queryClient = useQueryClient()

  const [createOpen, setCreateOpen] = useState(false)
  const [selected, setSelected] = useState<CommitteeView | null>(null)

  const { data, isLoading } = useQuery({ queryKey: ['committees'], queryFn: () => api.listCommittees() })
  const committees = data?.committees ?? []

  const toggleActive = useMutation({
    mutationFn: (c: CommitteeView) => api.updateCommittee(c.id, { active: !c.active }),
    onSuccess: (res) => {
      toast.success(res.committee.active ? 'Comissão reativada' : 'Comissão desativada', {
        description: res.committee.acronym,
      })
      queryClient.invalidateQueries({ queryKey: ['committees'] })
    },
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {committees.filter((c) => c.active).length} comissões ativas · composição e reuniões no detalhe
        </p>
        {canWrite && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus /> Nova comissão
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : committees.length === 0 ? (
        <EmptyState
          icon={<ClipboardList />}
          title="Nenhuma comissão cadastrada"
          description="Crie comissões permanentes, temporárias ou especiais e monte a composição."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {committees.map((c) => (
            <Card key={c.id} className={c.active ? undefined : 'opacity-75'}>
              <CardContent className="flex h-full flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono text-xs font-bold uppercase text-primary">{c.acronym}</p>
                    <p className="truncate font-semibold leading-tight" title={c.name}>
                      {c.name}
                    </p>
                  </div>
                  <Badge variant="outline" className="gap-1 shrink-0">
                    <ClipboardList className="size-3" /> {COMMITTEE_KIND_LABEL[c.kind] ?? c.kind}
                  </Badge>
                </div>
                {c.description && (
                  <p className="line-clamp-2 text-xs text-muted-foreground">{c.description}</p>
                )}
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Users className="size-3.5" aria-hidden /> {c.activeMemberCount} membro(s) ativo(s)
                  {!c.active && (
                    <Badge variant="outline" className="gap-1 text-muted-foreground">
                      <CircleOff className="size-3" /> Inativa
                    </Badge>
                  )}
                </div>
                <div className="mt-auto flex gap-1.5 pt-1">
                  <Button size="sm" variant="outline" className="h-8 flex-1" onClick={() => setSelected(c)}>
                    Detalhes
                  </Button>
                  {canWrite && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8"
                      aria-label={c.active ? `Desativar ${c.acronym}` : `Reativar ${c.acronym}`}
                      onClick={() => toggleActive.mutate(c)}
                      disabled={toggleActive.isPending}
                    >
                      <ShieldOff className="size-3.5" />
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CreateCommitteeDialog open={createOpen} onOpenChange={setCreateOpen} />
      {selected && <CommitteeDetailSheet committee={selected} onOpenChange={() => setSelected(null)} />}
    </div>
  )
}

function CreateCommitteeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [acronym, setAcronym] = useState('')
  const [kind, setKind] = useState('permanente')
  const [description, setDescription] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const mutation = useMutation({
    mutationFn: () =>
      api.createCommittee({ name: name.trim(), acronym: acronym.trim().toUpperCase(), kind, description: description.trim() || null }),
    onSuccess: (res) => {
      toast.success('Comissão criada', { description: `${res.committee.acronym} — ${res.committee.name}` })
      queryClient.invalidateQueries({ queryKey: ['committees'] })
      setName('')
      setAcronym('')
      setKind('permanente')
      setDescription('')
      setErrors({})
      onOpenChange(false)
    },
  })

  const submit = () => {
    const errs: Record<string, string> = {}
    if (name.trim().length < 4) errs.name = 'Nome da comissão (mín. 4 caracteres).'
    if (acronym.trim().length < 2) errs.acronym = 'Sigla com 2–12 caracteres.'
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    mutation.mutate()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nova comissão</DialogTitle>
          <DialogDescription>Comissões permanentes acompanham a tramitação; temporárias e especiais têm finalidade específica.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="comm-name">Nome *</Label>
            <Input id="comm-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Comissão de Constituição e Justiça" aria-invalid={!!errors.name} />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="comm-acronym">Sigla *</Label>
              <Input id="comm-acronym" value={acronym} onChange={(e) => setAcronym(e.target.value.toUpperCase())} placeholder="CCJ" maxLength={12} aria-invalid={!!errors.acronym} />
              {errors.acronym && <p className="text-xs text-destructive">{errors.acronym}</p>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="comm-kind">Espécie</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger id="comm-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(COMMITTEE_KIND_LABEL).map(([k, label]) => (
                    <SelectItem key={k} value={k}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="comm-desc">Descrição</Label>
            <Textarea id="comm-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Competência da comissão (opcional)." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? 'Criando…' : 'Criar comissão'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CommitteeDetailSheet({
  committee,
  onOpenChange,
}: {
  committee: CommitteeView
  onOpenChange: () => void
}) {
  const can = useApp((s) => s.can)
  const canWrite = can('structure.write')
  const queryClient = useQueryClient()

  const membersQ = useQuery({
    queryKey: ['committee-members', committee.id],
    queryFn: () => api.listCommitteeMembers(committee.id),
  })
  const meetingsQ = useQuery({
    queryKey: ['committee-meetings', committee.id],
    queryFn: () => api.listCommitteeMeetings(committee.id),
  })
  const parlQ = useQuery({ queryKey: ['parliamentarians'], queryFn: () => api.listParliamentarians() })

  const members = membersQ.data?.members ?? []
  const activeMembers = members.filter((m) => m.current)
  const meetings = meetingsQ.data?.meetings ?? []
  const parliamentarians = (parlQ.data?.parliamentarians ?? []).filter((p) => p.active)

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['committee-members', committee.id] })
    queryClient.invalidateQueries({ queryKey: ['committee-meetings', committee.id] })
    queryClient.invalidateQueries({ queryKey: ['committees'] })
  }

  const endMember = useMutation({
    mutationFn: (memberId: string) => api.endCommitteeMembership(memberId),
    onSuccess: () => {
      toast.success('Membro desligado', { description: 'Vigência encerrada — histórico preservado.' })
      invalidate()
    },
  })

  return (
    <Sheet open onOpenChange={(v) => !v && onOpenChange()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto custom-scroll p-0 sm:max-w-lg">
        <SheetHeader className="border-b p-4">
          <SheetTitle className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-sm font-bold uppercase text-primary">{committee.acronym}</span>
            {committee.name}
          </SheetTitle>
          <SheetDescription>
            {COMMITTEE_KIND_LABEL[committee.kind] ?? committee.kind} · {activeMembers.length} membro(s) ativo(s)
            {committee.description ? ` · ${committee.description}` : ''}
          </SheetDescription>
        </SheetHeader>

        {/* Membros */}
        <section aria-label="Membros da comissão" className="space-y-3 border-b p-4">
          <div className="flex items-center justify-between gap-2">
            <h4 className="flex items-center gap-2 text-sm font-semibold">
              <Users className="size-4 text-primary" /> Membros
            </h4>
            {canWrite && <AddMemberDialog committeeId={committee.id} parliamentarians={parliamentarians} activeMembers={activeMembers} onDone={invalidate} />}
          </div>
          {membersQ.isLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : members.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum membro cadastrado.</p>
          ) : (
            <ul className="max-h-72 space-y-2 overflow-y-auto custom-scroll pr-1" aria-label="Lista de membros">
              {members.map((m) => (
                <li key={m.id} className={`flex items-center gap-3 rounded-lg border p-2.5 ${m.current ? '' : 'opacity-60'}`}>
                  <Avatar className="size-9">
                    <AvatarFallback className="bg-primary/15 text-xs font-bold text-primary">
                      {initials(m.parliamentarianName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium leading-tight">{m.parliamentarianName}</p>
                    <p className="text-xs text-muted-foreground">
                      {COMMITTEE_MEMBER_ROLE_LABEL[m.role] ?? m.role} · {m.parliamentarianParty}
                      {!m.current && ' · encerrado'}
                    </p>
                  </div>
                  {canWrite && m.current && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-muted-foreground"
                      onClick={() => endMember.mutate(m.id)}
                      disabled={endMember.isPending}
                    >
                      Encerrar
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Reuniões */}
        <section aria-label="Reuniões da comissão" className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <h4 className="flex items-center gap-2 text-sm font-semibold">
              <CalendarPlus className="size-4 text-primary" /> Reuniões
            </h4>
            {canWrite && <ScheduleMeetingDialog committeeId={committee.id} onDone={invalidate} />}
          </div>
          {meetingsQ.isLoading ? (
            <div className="space-y-2">
              {[...Array(2)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : meetings.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma reunião registrada.</p>
          ) : (
            <ul className="max-h-72 space-y-2 overflow-y-auto custom-scroll pr-1" aria-label="Lista de reuniões">
              {meetings.map((mt) => (
                <li key={mt.id} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-tight">{mt.subject}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{fmtDateTime(mt.scheduledAt)}</p>
                    </div>
                    <MeetingStatusBadge status={mt.status} />
                  </div>
                  {canWrite && mt.status === 'agendada' && (
                    <div className="mt-2 flex gap-1.5">
                      <MeetingStatusButtons meetingId={mt.id} onDone={invalidate} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </SheetContent>
    </Sheet>
  )
}

function MeetingStatusBadge({ status }: { status: string }) {
  if (status === 'realizada')
    return (
      <Badge className="gap-1 bg-emerald-600 text-white hover:bg-emerald-600">
        <CheckCircle2 className="size-3" /> {COMMITTEE_MEETING_STATUS_LABEL.realizada}
      </Badge>
    )
  if (status === 'cancelada')
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="size-3" /> {COMMITTEE_MEETING_STATUS_LABEL.cancelada}
      </Badge>
    )
  return (
    <Badge variant="outline" className="gap-1">
      <CalendarPlus className="size-3" /> {COMMITTEE_MEETING_STATUS_LABEL.agendada}
    </Badge>
  )
}

function MeetingStatusButtons({ meetingId, onDone }: { meetingId: string; onDone: () => void }) {
  const [cancelOpen, setCancelOpen] = useState(false)
  const [justification, setJustification] = useState('')

  const markHeld = useMutation({
    mutationFn: () => api.patchCommitteeMeeting(meetingId, { status: 'realizada' }),
    onSuccess: () => {
      toast.success('Reunião marcada como realizada')
      onDone()
    },
  })

  const cancel = useMutation({
    mutationFn: () => api.patchCommitteeMeeting(meetingId, { status: 'cancelada', justification }),
    onSuccess: () => {
      toast.success('Reunião cancelada', { description: 'Justificativa registrada na auditoria.' })
      setCancelOpen(false)
      setJustification('')
      onDone()
    },
  })

  return (
    <>
      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => markHeld.mutate()} disabled={markHeld.isPending}>
        <CheckCircle2 className="size-3.5" /> Realizada
      </Button>
      <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => setCancelOpen(true)}>
        <XCircle className="size-3.5" /> Cancelar
      </Button>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cancelar reunião?</DialogTitle>
            <DialogDescription>O cancelamento exige justificativa, registrada na trilha de auditoria.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="meeting-cancel-reason">Justificativa *</Label>
            <Textarea
              id="meeting-cancel-reason"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              rows={3}
              placeholder="Ex.: falta de quórum específico da comissão."
            />
            {cancel.isError && <p className="text-xs text-destructive">Falha ao cancelar — verifique a justificativa.</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>Manter reunião</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (justification.trim().length < 5) return
                cancel.mutate()
              }}
              disabled={cancel.isPending || justification.trim().length < 5}
            >
              {cancel.isPending ? 'Cancelando…' : 'Cancelar reunião'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function AddMemberDialog({
  committeeId,
  parliamentarians,
  activeMembers,
  onDone,
}: {
  committeeId: string
  parliamentarians: ParliamentarianView[]
  activeMembers: CommitteeMemberView[]
  onDone: () => void
}) {
  const [open, setOpen] = useState(false)
  const [parliamentarianId, setParliamentarianId] = useState('')
  const [role, setRole] = useState<string>('titular')
  const [error, setError] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => api.addCommitteeMember(committeeId, { parliamentarianId, role }),
    onSuccess: (res) => {
      toast.success('Membro adicionado', {
        description: `${res.member.parliamentarianName} — ${COMMITTEE_MEMBER_ROLE_LABEL[res.member.role] ?? res.member.role}`,
      })
      setParliamentarianId('')
      setRole('titular')
      setError(null)
      setOpen(false)
      onDone()
    },
  })

  const submit = () => {
    if (!parliamentarianId) {
      setError('Selecione o parlamentar.')
      return
    }
    setError(null)
    mutation.mutate()
  }

  const activeIds = new Set(activeMembers.map((m) => m.parliamentarianId))
  const options = parliamentarians.filter((p) => !activeIds.has(p.id))

  return (
    <>
      <Button size="sm" variant="outline" className="h-8" onClick={() => setOpen(true)}>
        <UserPlus className="size-3.5" /> Adicionar
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Adicionar membro</DialogTitle>
            <DialogDescription>Parlamentares já ativos na comissão não aparecem na lista.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="member-parl">Parlamentar *</Label>
              <Select value={parliamentarianId} onValueChange={setParliamentarianId}>
                <SelectTrigger id="member-parl" className="w-full">
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
            </div>
            <div className="grid gap-2">
              <Label htmlFor="member-role">Função</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id="member-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEMBER_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {COMMITTEE_MEMBER_ROLE_LABEL[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={submit} disabled={mutation.isPending}>
              {mutation.isPending ? 'Adicionando…' : 'Adicionar membro'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function ScheduleMeetingDialog({ committeeId, onDone }: { committeeId: string; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [scheduledAt, setScheduledAt] = useState('')
  const [subject, setSubject] = useState('')
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const mutation = useMutation({
    mutationFn: () =>
      api.scheduleCommitteeMeeting(committeeId, {
        scheduledAt: new Date(scheduledAt).toISOString(),
        subject: subject.trim(),
        notes: notes.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success('Reunião agendada', { description: subject.trim() })
      setScheduledAt('')
      setSubject('')
      setNotes('')
      setErrors({})
      setOpen(false)
      onDone()
    },
  })

  const submit = () => {
    const errs: Record<string, string> = {}
    if (!scheduledAt) errs.scheduledAt = 'Informe data e hora.'
    if (subject.trim().length < 3) errs.subject = 'Assunto obrigatório.'
    setErrors(errs)
    if (Object.keys(errs).length > 0) return
    mutation.mutate()
  }

  return (
    <>
      <Button size="sm" variant="outline" className="h-8" onClick={() => setOpen(true)}>
        <CalendarPlus className="size-3.5" /> Agendar
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Agendar reunião</DialogTitle>
            <DialogDescription>Reuniões agendadas aparecem no detalhe da comissão até serem realizadas ou canceladas.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="meeting-date">Data e hora *</Label>
              <Input
                id="meeting-date"
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                aria-invalid={!!errors.scheduledAt}
              />
              {errors.scheduledAt && <p className="text-xs text-destructive">{errors.scheduledAt}</p>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="meeting-subject">Assunto *</Label>
              <Input id="meeting-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Ex.: análise do PL 45/2026" aria-invalid={!!errors.subject} />
              {errors.subject && <p className="text-xs text-destructive">{errors.subject}</p>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="meeting-notes">Observações</Label>
              <Textarea id="meeting-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={submit} disabled={mutation.isPending}>
              {mutation.isPending ? 'Agendando…' : 'Agendar reunião'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
