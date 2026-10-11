'use client'

/**
 * Painel de pauta da sessão — carregado on-demand ao expandir uma linha da
 * lista de sessões. Reordenação antes da publicação; alterações posteriores exigem fluxo versionado.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, ListOrdered, XCircle } from 'lucide-react'

import { api } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import { AgendaStatusBadge } from '@/components/app/badges'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import type { AgendaItemView, SessionStatus } from '@/lib/contracts'
import { AGENDA_SECTION_LABEL } from '@/modules/_shared'
import { AgendaAmendmentDialog } from '@/modules/sessions/agenda-amendment-dialog'

export function AgendaPanel({
  sessionId,
  sessionStatus,
}: {
  sessionId: string
  sessionStatus: SessionStatus
}) {
  const can = useApp((s) => s.can)
  const queryClient = useQueryClient()
  const [retiring, setRetiring] = useState<AgendaItemView | null>(null)
  const [justification, setJustification] = useState('')
  const [amending, setAmending] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => api.getSession(sessionId),
  })
  const { data: noticeRecipients } = useQuery({
    queryKey: ['notice-recipients', sessionId],
    queryFn: () => api.noticeRecipients(sessionId),
    enabled: can('session.transition') && sessionStatus !== 'draft',
    refetchInterval: 15_000,
  })

  // Comandos de pauta exigem session.transition no servidor (RBAC real)
  const canEdit =
    can('session.transition') && sessionStatus === 'draft'

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['session', sessionId] })
    queryClient.invalidateQueries({ queryKey: ['sessions'] })
  }

  const reorder = useMutation({
    mutationFn: ({ itemId, order }: { itemId: string; order: number }) =>
      api.patchAgendaItem(itemId, { action: 'reorder', order }),
    onSuccess: (_d, vars) => {
      toast.success('Pauta reordenada', { description: `Item movido para a posição ${vars.order + 1}.` })
      invalidate()
    },
  })

  const retirar = useMutation({
    mutationFn: (itemId: string) =>
      api.patchAgendaItem(itemId, { action: 'retirar', justification: justification.trim() }),
    onSuccess: () => {
      toast.success('Item retirado da pauta')
      invalidate()
      setRetiring(null)
      setJustification('')
    },
  })

  const agenda = data?.agenda ?? []
  const sections = ['expediente', 'ordem_do_dia', 'comunicacoes'] as const

  const move = (item: AgendaItemView, direction: -1 | 1) => {
    const newIndex = Math.min(Math.max(item.order + direction, 0), agenda.length - 1)
    if (newIndex === item.order) return
    reorder.mutate({ itemId: item.id, order: newIndex })
  }

  return (
    <div className="grid gap-4 py-2">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <ListOrdered className="size-3.5" aria-hidden /> Pauta da sessão ({agenda.length} itens)
      </p>
      {can('session.transition') && sessionStatus === 'scheduled' && data && <Button variant="outline" size="sm" className="justify-self-start" onClick={() => setAmending(true)}>Emendar pauta publicada</Button>}
      {noticeRecipients?.revision && <div className="rounded-md border bg-muted/30 p-3 text-sm">
        <p className="font-medium">Ciência da convocação · revisão {noticeRecipients.revision}: {noticeRecipients.acknowledged}/{noticeRecipients.total}</p>
        <p className="text-xs text-muted-foreground">Destinatários ativos no momento da emissão. A ciência não comprova entrega externa.</p>
        {noticeRecipients.recipients.length > 0 && <ul className="mt-2 space-y-1 text-xs">
          {noticeRecipients.recipients.map((person) => <li key={person.parliamentarianId}>{person.name} — {person.acknowledgedAt ? `ciência em ${new Date(person.acknowledgedAt).toLocaleString('pt-BR')}` : 'pendente'}</li>)}
        </ul>}
      </div>}

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : agenda.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum item de pauta. Publique a pauta ou adicione matérias pela mesa do plenário.
        </p>
      ) : (
        <ol className="space-y-4">
          {sections.map((section) => {
            const items = agenda.filter((i) => i.section === section)
            if (items.length === 0) return null
            return (
              <li key={section}>
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-widest text-primary">
                  {AGENDA_SECTION_LABEL[section]}
                </p>
                <ul className="space-y-1">
                  {items.map((item) => {
                    const globalIndex = agenda.findIndex((a) => a.id === item.id)
                    return (
                      <li
                        key={item.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border bg-background px-3 py-2"
                      >
                        <span className="w-6 text-center text-xs font-bold tabular-nums text-muted-foreground">
                          {globalIndex + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm leading-snug">{item.title}</span>
                          {item.resultSummary && (
                            <span className="block text-xs text-muted-foreground">{item.resultSummary}</span>
                          )}
                        </span>
                        <AgendaStatusBadge status={item.status} />
                        {canEdit && (
                          <span className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              aria-label={`Mover item ${globalIndex + 1} para cima`}
                              disabled={reorder.isPending || globalIndex === 0}
                              onClick={() => move(item, -1)}
                            >
                              <ArrowUp className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              aria-label={`Mover item ${globalIndex + 1} para baixo`}
                              disabled={reorder.isPending || globalIndex === agenda.length - 1}
                              onClick={() => move(item, 1)}
                            >
                              <ArrowDown className="size-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2 text-destructive hover:text-destructive"
                              aria-label={`Retirar item ${globalIndex + 1} da pauta`}
                              disabled={retirar.isPending}
                              onClick={() => {
                                setJustification('')
                                setRetiring(item)
                              }}
                            >
                              <XCircle className="size-3.5" /> Retirar
                            </Button>
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </li>
            )
          })}
        </ol>
      )}

      {/* Justificativa de retirada */}
      <Dialog open={!!retiring} onOpenChange={(v) => !v && setRetiring(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Retirar item da pauta</DialogTitle>
            <DialogDescription>
              {retiring?.title} — o item será marcado como retirado e, se vinculado, a matéria também.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="retire-reason">Justificativa *</Label>
            <Textarea
              id="retire-reason"
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              placeholder="Ex.: a pedido do autor, para reapreciação na próxima sessão."
              rows={3}
              aria-required="true"
            />
            {justification.trim().length > 0 && justification.trim().length < 3 && (
              <p className="text-xs text-destructive">Mínimo de 3 caracteres.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRetiring(null)}>
              Manter na pauta
            </Button>
            <Button
              variant="destructive"
              disabled={retirar.isPending || justification.trim().length < 3}
              onClick={() => retiring && retirar.mutate(retiring.id)}
            >
              {retirar.isPending ? 'Retirando…' : 'Retirar item'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {amending && data && <AgendaAmendmentDialog key={`${sessionId}-${data.session.version}`} sessionId={sessionId} version={data.session.version} agenda={agenda} onClose={() => setAmending(false)} />}
    </div>
  )
}
