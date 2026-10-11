'use client'

/**
 * Tab Telão (controles da mesa) — preview do estado atual do telão e
 * comandos: abrir, congelar/liberar, limpar e publicação manual de perfis.
 * Os comandos chegam ao telão via evento realtime `display.command`.
 */

import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Eraser, MonitorPlay, Pin, PinOff, Radio, Snowflake } from 'lucide-react'

import { api } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import type { DisplayCommandPayload, SessionDetail } from '@/lib/contracts'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { autoDisplayProfile, pickActiveVoting } from './helpers'
import { DISPLAY_PROFILE_LABEL } from '@/modules/display/profiles'

type Props = { data: SessionDetail; invalidate: () => void }

const COMMAND_SUCCESS: Record<string, (payload: DisplayCommandPayload) => string> = {
  freeze: () => 'Telão congelado — atualizações pausadas',
  unfreeze: () => 'Telão liberado — atualizações retomadas',
  clear: () => 'Telão limpo (perfil de boas-vindas)',
  profile: (p) => `Perfil publicado no telão: ${p.profile ? DISPLAY_PROFILE_LABEL[p.profile] : '—'}`,
}

export function DisplayControlsTab({ data, invalidate }: Props) {
  const canCommand = useApp((s) => s.can('display.command'))
  const setModule = useApp((s) => s.setModule)
  const frozen = useApp((s) => s.displayFrozen)

  const cmd = useMutation({
    mutationFn: (payload: DisplayCommandPayload) => api.displayCommand(data.session.id, payload),
    onSuccess: (_r, payload) => {
      invalidate()
      toast.success((COMMAND_SUCCESS[payload.action] ?? (() => 'Comando enviado'))(payload))
    },
  })

  const profile = autoDisplayProfile(data)
  const voting = pickActiveVoting(data.votings)
  const speech = data.speeches.find((s) => s.status === 'falando' || s.status === 'pausado')

  const previewLine: Record<string, string> = {
    votacao: voting ? `Votação “${voting.question}” (${voting.status})` : 'Votação',
    discurso: speech ? `Orador: ${speech.speakerName}` : 'Discurso',
    presenca: `Presenças (${data.quorum.present} de ${data.quorum.total})`,
    pauta: 'Pauta da sessão',
    encerramento: 'Encerramento da sessão',
    boas_vindas: 'Boas-vindas',
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MonitorPlay className="size-5 text-primary" /> Estado atual do telão
          </CardTitle>
          <CardDescription>
            Sem comando manual, o telão troca de perfil automaticamente conforme a sessão.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Perfil automático:</span>
            <strong className="text-sm">{DISPLAY_PROFILE_LABEL[profile]}</strong>
            <span className="text-sm text-muted-foreground">— {previewLine[profile]}</span>
          </div>
          {frozen && (
            <p className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/50 dark:text-amber-200">
              <Snowflake className="size-4" /> O telão está congelado e não recebe atualizações.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Comandos</CardTitle>
          <CardDescription>
            {canCommand
              ? 'Os comandos são entregues ao telão em tempo real (evento display.command).'
              : 'Seu perfil não tem permissão para comandar o telão (display.command).'}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setModule('display')}>
              <MonitorPlay /> Abrir telão
            </Button>
            <Button
              variant="outline"
              disabled={!canCommand || cmd.isPending}
              onClick={() => cmd.mutate({ action: frozen ? 'unfreeze' : 'freeze' })}
            >
              {frozen ? <PinOff /> : <Pin />}
              {frozen ? 'Liberar' : 'Congelar'}
            </Button>
            <Button
              variant="outline"
              disabled={!canCommand || cmd.isPending}
              onClick={() => cmd.mutate({ action: 'clear' })}
            >
              <Eraser /> Limpar
            </Button>
          </div>

          <Separator />

          <div className="grid gap-2">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Radio className="size-4 text-muted-foreground" /> Publicar perfil manual
            </p>
            <p className="text-xs text-muted-foreground">
              Fixa um perfil específico no telão até um novo comando de perfil/limpeza — útil para
              expor presenças na abertura ou o resultado de uma votação.
            </p>
            <div className="flex flex-wrap gap-2">
              {(['presenca', 'pauta', 'votacao', 'discurso'] as const).map((p) => (
                <Button
                  key={p}
                  size="sm"
                  variant="secondary"
                  disabled={!canCommand || cmd.isPending}
                  onClick={() => cmd.mutate({ action: 'profile', profile: p })}
                >
                  Publicar {DISPLAY_PROFILE_LABEL[p].toLowerCase()}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
