'use client'

/**
 * Dialog "Nova sessão" — tipo, data/hora, mesa (presidente/secretário),
 * observações e seleção de matérias da ordem do dia com prévia da pauta
 * (expediente fixo → ordem do dia → comunicações). Salva rascunho.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CalendarPlus } from 'lucide-react'

import { api } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import { matterLabel } from '@/lib/format'
import {
  BOARD_ROLE_LABEL,
  SESSION_TYPE_LABEL,
  type MatterView,
  type ParliamentarianView,
  type SessionType,
} from '@/lib/contracts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { AGENDA_SECTION_LABEL } from '@/modules/_shared'

const SESSION_TYPES = Object.keys(SESSION_TYPE_LABEL) as SessionType[]

const EXPEDIENTE_FIXO = [
  'Abertura dos trabalhos e verificação de quórum pelo Presidente.',
  'Leitura e aprovação da Ata da Sessão anterior.',
  'Leitura de correspondências recebidas.',
]
const COMUNICACOES_FIXO = 'Comunicações da Presidência.'

const truncate = (s: string, max = 90) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s)

function defaultDateTimeLocal(): string {
  const d = new Date()
  d.setHours(19, 0, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function NewSessionDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const queryClient = useQueryClient()
  const enabledTypes = useApp((s) => s.bootstrap?.tenant?.settings.enabledSessionTypes ?? SESSION_TYPES)
  const [type, setType] = useState<SessionType>(enabledTypes[0] ?? 'ordinaria')
  const [scheduledAt, setScheduledAt] = useState(defaultDateTimeLocal())
  const [presidentId, setPresidentId] = useState<string>('')
  const [secretaryName, setSecretaryName] = useState('')
  const [notes, setNotes] = useState('')
  const [matterIds, setMatterIds] = useState<string[]>([])
  const [official, setOfficial] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parlQ = useQuery({ queryKey: ['parliamentarians'], queryFn: () => api.listParliamentarians(), enabled: open })
  const mattersQ = useQuery({
    queryKey: ['matters', { status: 'em_tramitacao' }],
    queryFn: () => api.listMatters({ status: 'em_tramitacao' }),
    enabled: open,
  })

  const activeParliamentarians = (parlQ.data?.parliamentarians ?? []).filter((p) => p.active)
  const boardPresident = activeParliamentarians.find((p) => p.boardRole === 'presidente')
  const availableMatters = mattersQ.data?.matters ?? []

  // Presidente derivado: seleção explícita ou o presidente da mesa por padrão
  const effectivePresidentId = presidentId || boardPresident?.id || ''

  const toggleMatter = (id: string) => {
    setMatterIds((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]))
  }

  const mutation = useMutation({
    mutationFn: () =>
      api.createSession({
        type,
        scheduledAt: new Date(scheduledAt).toISOString(),
        presidentId: effectivePresidentId,
        secretaryName: secretaryName.trim() || undefined,
        notes: notes.trim() || undefined,
        matterIds: matterIds.length > 0 ? matterIds : undefined,
        official,
      }),
    onSuccess: (res) => {
      toast.success('Rascunho da sessão criado', {
        description: `${SESSION_TYPE_LABEL[res.session.type]} nº ${res.session.number}/${res.session.year}. Revise a pauta antes de agendar e publicar.`,
      })
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      queryClient.invalidateQueries({ queryKey: ['matters'] })
      queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
      onOpenChange(false)
      // O formulário é remontado (key) na próxima abertura — sem reset manual.
    },
  })

  const submit = () => {
    if (!scheduledAt || Number.isNaN(Date.parse(scheduledAt))) {
      setError('Informe uma data/hora válida.')
      return
    }
    if (!effectivePresidentId) {
      setError('Selecione o presidente da sessão.')
      return
    }
    setError(null)
    mutation.mutate()
  }

  const selectedMatters: MatterView[] = matterIds
    .map((id) => availableMatters.find((m) => m.id === id))
    .filter((m): m is MatterView => !!m)

  const presidentName = (p: ParliamentarianView) =>
    p.boardRole === 'presidente' ? `${p.name} — ${BOARD_ROLE_LABEL.presidente} (mesa)` : p.name

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto custom-scroll sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarPlus className="size-5 text-primary" /> Nova sessão
          </DialogTitle>
          <DialogDescription>
            A sessão e a pauta preliminar serão salvas em rascunho. Revise os itens antes de usar “Agendar e publicar pauta”.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="session-type">Tipo *</Label>
            <Select value={type} onValueChange={(v) => setType(v as SessionType)}>
              <SelectTrigger id="session-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SESSION_TYPES.filter((t) => enabledTypes.includes(t)).map((t) => (
                  <SelectItem key={t} value={t}>
                    {SESSION_TYPE_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="session-datetime">Data e hora *</Label>
            <Input
              id="session-datetime"
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="session-president">Presidente *</Label>
            {parlQ.isLoading ? (
              <Skeleton className="h-9 w-full" />
            ) : (
              <Select value={effectivePresidentId} onValueChange={setPresidentId}>
                <SelectTrigger id="session-president" className="w-full">
                  <SelectValue placeholder="Selecione o parlamentar" />
                </SelectTrigger>
                <SelectContent>
                  {activeParliamentarians.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {presidentName(p)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="session-secretary">Secretário(a)</Label>
            <Input
              id="session-secretary"
              value={secretaryName}
              onChange={(e) => setSecretaryName(e.target.value)}
              placeholder="Nome do secretário da sessão"
            />
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="session-notes">Observações</Label>
          <Textarea
            id="session-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Observações gerais da sessão (opcional)."
            rows={2}
          />
        </div>

        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <Label>Matérias da ordem do dia</Label>
            <Badge variant="outline" className="tabular-nums">
              {matterIds.length} selecionada(s)
            </Badge>
          </div>
          {mattersQ.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : availableMatters.length === 0 ? (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
              Nenhuma matéria em tramitação disponível. Você poderá completar a pauta antes de publicar.
            </p>
          ) : (
            <div className="max-h-64 space-y-1 overflow-y-auto custom-scroll rounded-md border p-2">
              {availableMatters.map((m) => (
                <label
                  key={m.id}
                  className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 text-sm transition hover:bg-accent"
                >
                  <Checkbox
                    checked={matterIds.includes(m.id)}
                    onCheckedChange={() => toggleMatter(m.id)}
                    className="mt-0.5"
                    aria-label={`Incluir ${matterLabel(m.type, m.number, m.year)} na ordem do dia`}
                  />
                  <span className="min-w-0">
                    <span className="font-mono text-xs font-bold">{matterLabel(m.type, m.number, m.year)}</span>{' '}
                    <span className="text-muted-foreground">— {truncate(m.ementa)}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Prévia da pauta */}
        <div>
          <Separator className="mb-3" />
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Prévia da pauta
          </p>
          <div className="space-y-2 rounded-md border bg-muted/40 p-3 text-sm">
            <p className="text-[11px] font-bold uppercase tracking-widest text-primary">
              {AGENDA_SECTION_LABEL.expediente}
            </p>
            <ol className="list-inside list-decimal space-y-0.5 text-muted-foreground">
              {EXPEDIENTE_FIXO.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ol>
            <p className="pt-1 text-[11px] font-bold uppercase tracking-widest text-primary">
              {AGENDA_SECTION_LABEL.ordem_do_dia}
            </p>
            {selectedMatters.length === 0 ? (
              <p className="text-muted-foreground">(sem matérias selecionadas)</p>
            ) : (
              <ol className="list-inside list-decimal space-y-0.5">
                {selectedMatters.map((m) => (
                  <li key={m.id}>
                    <span className="font-mono text-xs font-bold">{matterLabel(m.type, m.number, m.year)}</span>{' '}
                    <span className="text-muted-foreground">— {truncate(m.ementa, 70)}</span>
                  </li>
                ))}
              </ol>
            )}
            <p className="pt-1 text-[11px] font-bold uppercase tracking-widest text-primary">
              {AGENDA_SECTION_LABEL.comunicacoes}
            </p>
            <ol className="list-inside list-decimal text-muted-foreground">
              <li>{COMUNICACOES_FIXO}</li>
            </ol>
          </div>
        </div>

        <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
          <Checkbox checked={official} onCheckedChange={(checked) => setOfficial(checked === true)} aria-label="Sessão oficial" />
          <span><strong>Sessão oficial</strong><br /><span className="text-muted-foreground">A publicação exigirá configuração institucional aprovada da Câmara. Rascunhos de ensaio podem permanecer desmarcados.</span></span>
        </label>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={mutation.isPending || parlQ.isLoading}>
            {mutation.isPending ? 'Salvando…' : 'Salvar rascunho'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
