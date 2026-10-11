'use client'

/**
 * Barra de transições da sessão — botões contextuais por status,
 * confirmações (AlertDialog) para ações sensíveis e justificativa obrigatória
 * para cancelamento.
 */

import { useState } from 'react'
import { toast } from 'sonner'
import { CalendarCheck2, DoorOpen, Lock, PauseCircle, PlayCircle, ShieldAlert, XCircle } from 'lucide-react'

import { api } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import { SESSION_STATUS_LABEL, type SessionSummary } from '@/lib/contracts'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Textarea } from '@/components/ui/textarea'

type Props = { session: SessionSummary; invalidate: () => void }

const SUCCESS_MSG: Record<string, string> = {
  schedule: 'Pauta publicada e sessão agendada',
  open_checkin: 'Credenciamento aberto',
  open_session: 'Sessão aberta — bons trabalhos',
  suspend: 'Sessão suspensa',
  resume: 'Sessão retomada',
  close: 'Sessão encerrada',
  cancel: 'Sessão cancelada',
}

export function TransitionsBar({ session, invalidate }: Props) {
  const canTransition = useApp((s) => s.can('session.transition'))
  const [busy, setBusy] = useState(false)
  const [justification, setJustification] = useState('')

  const run = async (action: string, just?: string) => {
    setBusy(true)
    try {
      await api.transitionSession(session.id, action, session.version, just)
      invalidate()
      toast.success(SUCCESS_MSG[action] ?? 'Sessão atualizada')
    } catch {
      // erros já notificados pelo api-client (toast global)
    } finally {
      setBusy(false)
      setJustification('')
    }
  }

  const disabled = !canTransition || busy
  const status = session.status
  const cancellable = status === 'draft' || status === 'scheduled' || status === 'check_in'

  if (status === 'closed' || status === 'cancelled') {
    return (
      <Card className="border-muted">
        <CardContent className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
          <Lock className="size-4 shrink-0" aria-hidden />
          Sessão {SESSION_STATUS_LABEL[status].toLowerCase()} — somente leitura (histórico e resultados).
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-primary/25 bg-primary/[0.04]">
      <CardContent className="flex flex-wrap items-center gap-2 p-3">
        <span className="mr-1 hidden text-xs font-semibold uppercase tracking-wider text-primary sm:inline">
          Fluxo da sessão
        </span>

        {status === 'draft' && (
          <Button size="sm" disabled={disabled} onClick={() => run('schedule')}>
            <CalendarCheck2 /> Publicar pauta e agendar
          </Button>
        )}

        {status === 'scheduled' && (
          <Button size="sm" disabled={disabled} onClick={() => run('open_checkin')}>
            <DoorOpen /> Abrir credenciamento
          </Button>
        )}

        {status === 'check_in' && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" disabled={disabled}>
                <PlayCircle /> Abrir sessão
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Abrir a sessão?</AlertDialogTitle>
                <AlertDialogDescription>
                  Confirma a abertura dos trabalhos da {session.type === 'ordinaria' ? 'Sessão' : 'Sessão'} —
                  presidência de {session.presidentName ?? '—'}? O telão passa a exibir a pauta e o
                  credenciamento é encerrado.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Voltar</AlertDialogCancel>
                <AlertDialogAction
                  disabled={busy}
                  onClick={(e) => {
                    e.preventDefault()
                    void run('open_session')
                  }}
                >
                  Confirmar abertura
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {(status === 'open' || status === 'resumed') && (
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => run('suspend')}>
            <PauseCircle /> Suspender
          </Button>
        )}

        {status === 'suspended' && (
          <Button size="sm" disabled={disabled} onClick={() => run('resume')}>
            <PlayCircle /> Retomar
          </Button>
        )}

        {(status === 'open' || status === 'suspended' || status === 'resumed') && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="destructive" disabled={disabled}>
                <Lock /> Encerrar sessão
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                  <ShieldAlert className="size-5 text-destructive" /> Encerra a sessão definitivamente
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Encerra a sessão, trava novas votações e discursos e publica o estado final.
                  Esta ação não pode ser desfeita.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Voltar</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-white hover:bg-destructive/90"
                  disabled={busy}
                  onClick={(e) => {
                    e.preventDefault()
                    void run('close')
                  }}
                >
                  Encerrar sessão
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {cancellable && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="outline" className="text-destructive" disabled={disabled}>
                <XCircle /> Cancelar sessão
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Cancelar a sessão?</AlertDialogTitle>
                <AlertDialogDescription>
                  O cancelamento exige justificativa registrada em auditoria e não pode ser desfeito.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div className="grid gap-2">
                <label htmlFor="cancel-justification" className="text-sm font-medium">
                  Justificativa <span className="text-destructive">*</span>
                </label>
                <Textarea
                  id="cancel-justification"
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  placeholder="Ex.: Perda de quórum antes da abertura dos trabalhos…"
                  rows={3}
                  maxLength={2000}
                />
                {justification.trim().length > 0 && justification.trim().length < 3 && (
                  <p className="text-xs text-destructive">Informe ao menos 3 caracteres.</p>
                )}
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setJustification('')}>Voltar</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-white hover:bg-destructive/90"
                  disabled={busy || justification.trim().length < 3}
                  onClick={(e) => {
                    e.preventDefault()
                    void run('cancel', justification.trim())
                  }}
                >
                  Confirmar cancelamento
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        {!canTransition && (
          <span className="text-xs text-muted-foreground">
            Seu perfil não tem permissão para transicionar a sessão (session.transition).
          </span>
        )}
      </CardContent>
    </Card>
  )
}
