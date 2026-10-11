'use client'

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Radio, RefreshCw, Signal, SignalZero } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const LABELS = {
  draft: 'Ainda não preparada',
  ready: 'Preparada para verificar o sinal',
  monitoring: 'Acompanhando sinal local',
  signal_lost: 'Sinal local perdido',
  ended: 'Acompanhamento encerrado',
} as const

export function TransmissionTab({ sessionId }: { sessionId: string }) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const can = useApp((state) => state.can)
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['transmission', sessionId],
    queryFn: () => api.getTransmission(sessionId),
    refetchInterval: 3000,
  })
  const destinations = useQuery({
    queryKey: ['media-destinations', sessionId],
    queryFn: () => api.getMediaDestinations(sessionId),
    refetchInterval: 3000,
  })
  const recording = useQuery({
    queryKey: ['media-recording', sessionId],
    queryFn: () => api.getMediaRecording(sessionId),
    refetchInterval: 10000,
  })

  async function command(action: 'prepare' | 'start_monitoring' | 'stop_monitoring') {
    if (!data || busy) return
    setBusy(true)
    try {
      await api.commandTransmission(sessionId, {
        action,
        version: data.transmission.version,
        idempotencyKey: crypto.randomUUID(),
      })
      await queryClient.invalidateQueries({ queryKey: ['transmission', sessionId] })
      toast.success('Estado do acompanhamento atualizado.')
    } catch {
      // O cliente da API já apresenta o problema retornado pelo servidor.
    } finally {
      setBusy(false)
    }
  }

  async function setDestination(destinationId: string, enabled: boolean) {
    if (busy) return
    setBusy(true)
    try {
      await api.setMediaDestination(sessionId, destinationId, enabled)
      await queryClient.invalidateQueries({ queryKey: ['media-destinations', sessionId] })
      toast.success(enabled ? 'Ativação registrada; aguardando confirmação.' : 'Desativação registrada; aguardando confirmação.')
    } catch {
      // O cliente da API já apresenta o problema retornado pelo servidor.
    } finally {
      setBusy(false)
    }
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Verificando a fonte de mídia…</p>
  if (isError || !data) {
    return <Button variant="outline" onClick={() => void refetch()}><RefreshCw /> Recarregar transmissão</Button>
  }

  const { transmission, source } = data
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Radio className="size-4" /> Acompanhamento local</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="font-medium" role="status">{LABELS[transmission.effectiveStatus]}</p>
          <p className="text-muted-foreground">O acompanhamento confirma o sinal recebido pelo servidor local. Os destinos RTMPS são controlados abaixo.</p>
          <div className="flex flex-wrap gap-2">
            {transmission.status === 'draft' && <Button disabled={busy} onClick={() => void command('prepare')}>Preparar acompanhamento</Button>}
            {transmission.status === 'ready' && <Button disabled={busy || !source.ready} onClick={() => void command('start_monitoring')}>Confirmar sinal e acompanhar</Button>}
            {transmission.status === 'monitoring' && <Button variant="outline" disabled={busy || !destinations.data || !destinations.data.controllerAvailable || destinations.data.destinations.some((item) => item.desiredEnabled || item.enabled !== false)} onClick={() => void command('stop_monitoring')}>Encerrar acompanhamento</Button>}
          </div>
          {transmission.status === 'ended' && <p className="text-muted-foreground">O registro desta sessão foi encerrado. A parada do encoder deve ser conferida na estação de mídia.</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-base">{source.ready ? <Signal className="size-4 text-emerald-600" /> : <SignalZero className="size-4 text-amber-600" />} Fonte MediaMTX</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>Sinal: <strong>{source.ready ? 'pronto' : 'ausente'}</strong></p>
          <p>Caminho de publicação: <code className="break-all rounded bg-muted px-1">{source.path}</code></p>
          {source.inboundBytes !== null && <p>Recebidos: {new Intl.NumberFormat('pt-BR').format(source.inboundBytes)} bytes</p>}
          <p className="text-muted-foreground">Última verificação: {new Date(source.checkedAt).toLocaleTimeString('pt-BR')}</p>
          {!source.configured && <p className="text-amber-700">Configure MEDIA_METRICS_URL no servidor para habilitar a verificação.</p>}
          {source.error && <p className="text-destructive">{source.error}</p>}
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle className="text-base">Destinos de transmissão</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">O estado “encaminhando” confirma a saída RTMPS do MediaMTX. A live pública deve ser conferida também na plataforma.</p>
          {destinations.data && !destinations.data.controllerAvailable && <p className="text-destructive">Controlador indisponível ({destinations.data.controllerErrorCode}). As solicitações permanecem registradas e serão repetidas pelo worker.</p>}
          {destinations.isLoading && <p>Consultando destinos…</p>}
          {destinations.isError && <p className="text-destructive">Não foi possível consultar o controlador de mídia. Confira a configuração do servidor e recarregue.</p>}
          {destinations.data?.destinations.length === 0 && <p className="text-muted-foreground">Nenhum destino configurado para esta Câmara.</p>}
          {destinations.data?.destinations.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded border p-3">
              <div>
                <p className="font-medium">{item.label} <span className="text-muted-foreground">({item.platform})</span></p>
                <p role="status" className="text-muted-foreground">{item.state === 'disabled' ? 'Desativado' : item.state === 'forwarding' ? 'Encaminhando' : item.state === 'error' ? 'Erro no encaminhamento' : item.state === 'unknown' ? 'Estado externo desconhecido' : 'Aguardando sinal/conexão'}{item.outboundBytes !== null ? ` · ${new Intl.NumberFormat('pt-BR').format(item.outboundBytes)} bytes enviados` : ''}</p>
                <p className="text-xs text-muted-foreground">Solicitado: {item.desiredEnabled ? 'ativo' : 'inativo'} · Reconciliação: {item.syncStatus === 'unmanaged' ? 'sem comando' : item.syncStatus === 'pending' ? 'pendente' : item.syncStatus === 'applied' ? 'aplicada' : 'erro'}{item.lastErrorCode ? ` (${item.lastErrorCode})` : ''}</p>
              </div>
              {can('media.manage') && <Button variant={item.desiredEnabled || item.enabled === true ? 'outline' : 'default'} disabled={busy || (!(item.desiredEnabled || item.enabled === true) && (transmission.status !== 'monitoring' || !source.ready))} onClick={() => void setDestination(item.id, !(item.desiredEnabled || item.enabled === true))}>{item.desiredEnabled || item.enabled === true ? 'Desativar' : 'Ativar'}</Button>}
            </div>
          ))}
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle className="text-base">Gravação local</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {recording.isLoading && <p>Consultando segmentos…</p>}
          {recording.isError && <p className="text-destructive">Catálogo de gravações indisponível. Confira o MediaMTX e o disco local.</p>}
          {recording.data && <>
            <p>Gravação configurada: <strong>{recording.data.configured ? 'sim' : 'não'}</strong></p>
            <p>Segmentos encontrados: <strong>{recording.data.segmentCount}</strong></p>
            {recording.data.latestSegmentAt && <p>Último segmento iniciado: {new Date(recording.data.latestSegmentAt).toLocaleString('pt-BR')}</p>}
            <p className="text-muted-foreground">O catálogo indica segmentos associados à sessão. A integridade e o áudio do arquivo exigem verificação separada.</p>
          </>}
        </CardContent>
      </Card>
    </div>
  )
}
