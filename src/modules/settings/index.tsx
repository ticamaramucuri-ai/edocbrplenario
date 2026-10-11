'use client'

/**
 * Módulo Configurações — white-label do tenant (identidade, marca com
 * pré-visualização e regras regimentais) e painel do plano (somente leitura).
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { BadgeCheck, Info, Landmark, Palette, Save, Settings as SettingsIcon, ShieldAlert, SlidersHorizontal } from 'lucide-react'

import { api } from '@/lib/api-client'
import { useApp } from '@/lib/store'
import { MATTER_TYPE_LABEL, ROLE_LABEL, SESSION_TYPE_LABEL, VOTING_RULE_LABEL, type MatterType, type SessionType, type TenantSettings, type VotingRule } from '@/lib/contracts'
import { EmptyState, PageHeader } from '@/components/app/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'

function BrandPreview({ primary, accent, name }: { primary: string; accent: string; name: string }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-white text-zinc-900 shadow-sm" aria-label="Pré-visualização da marca">
      <div className="flex items-center gap-2 px-3 py-2 text-white" style={{ backgroundColor: primary }}>
        <Landmark className="size-4 opacity-90" aria-hidden />
        <span className="truncate text-xs font-bold">{name || 'Câmara Municipal'}</span>
      </div>
      <div className="h-1" style={{ backgroundColor: accent }} aria-hidden />
      <div className="flex min-h-24">
        <div className="w-16 space-y-1.5 p-2" style={{ backgroundColor: primary }}>
          <span className="block h-1.5 w-10 rounded-full bg-white/60" />
          <span className="block h-1.5 w-12 rounded-full bg-white/40" />
          <span className="block h-1.5 w-8 rounded-full bg-white/30" />
        </div>
        <div className="flex-1 space-y-2 p-2.5">
          <span className="block h-2 w-24 rounded-full bg-zinc-300" />
          <span className="block h-1.5 w-32 rounded-full bg-zinc-200" />
          <span
            className="inline-block rounded px-2 py-1 text-[10px] font-semibold text-white"
            style={{ backgroundColor: primary }}
          >
            Ação primária
          </span>
          <span
            className="ml-1.5 inline-block rounded px-2 py-1 text-[10px] font-semibold text-white"
            style={{ backgroundColor: accent }}
          >
            Destaque
          </span>
        </div>
      </div>
    </div>
  )
}

export default function SettingsModule() {
  const can = useApp((s) => s.can)
  const tenant = useApp((s) => s.bootstrap?.tenant ?? null)
  const actor = useApp((s) => s.actor)
  const queryClient = useQueryClient()

  const canUpdate = can('tenant.update')

  const [name, setName] = useState(tenant?.name ?? '')
  const [city, setCity] = useState(tenant?.city ?? '')
  const [uf, setUf] = useState(tenant?.uf ?? '')
  const [primaryColor, setPrimaryColor] = useState(tenant?.primaryColor ?? '#062f63')
  const [accentColor, setAccentColor] = useState(tenant?.accentColor ?? '#d9a441')
  const [settings, setSettings] = useState<TenantSettings>(
    tenant?.settings ?? {
      quorumMinimum: 7,
      allowVoteChange: true,
      speechDefaultSeconds: 300,
      soundAlerts: true,
      hidePartialByDefault: false,
      enabledSessionTypes: ['ordinaria', 'extraordinaria', 'solene', 'especial'],
      requireSecretaryForPublication: false,
      minimumAgendaMatters: 0,
      minimumNoticeHours: 0,
      minimumAmendmentHours: 0,
      urgentNoticeExceptionTypes: [],
      noticeAlertLeadHours: 24,
      noticeRecipientPolicy: 'active',
      deliberativeRosterPolicy: 'active',
      votingImpedimentPolicy: 'disabled',
      votingPoliciesByMatterType: {},
      replayVisibilityDays: null,
    }
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [approvalReference, setApprovalReference] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const officialQ = useQuery({ queryKey: ['official-configuration', tenant?.id], queryFn: api.officialConfiguration, enabled: !!tenant?.id })
  const approve = useMutation({
    mutationFn: () => api.approveOfficialConfiguration({
      expectedSha256: officialQ.data!.snapshotSha256, approvalReference: approvalReference.trim(), acknowledged: true,
    }),
    onSuccess: ({ revision }) => {
      toast.success(`Configuração institucional v${revision.version} aprovada`)
      setApprovalReference('')
      setAcknowledged(false)
      queryClient.invalidateQueries({ queryKey: ['official-configuration'] })
    },
  })

  const save = useMutation({
    mutationFn: () =>
      api.updateTenant(tenant?.id ?? '', {
        name: name.trim(),
        city: city.trim(),
        uf: uf.trim().toUpperCase(),
        primaryColor,
        accentColor,
        settings,
      }),
    onSuccess: () => {
      toast.success('Configurações salvas', {
        description: 'A identidade white-label e as regras regimentais foram atualizadas.',
      })
      queryClient.invalidateQueries({ queryKey: ['bootstrap'] })
      queryClient.invalidateQueries({ queryKey: ['notice-calendar'] })
      queryClient.invalidateQueries({ queryKey: ['notice-recipient-preview'] })
      queryClient.invalidateQueries({ queryKey: ['official-configuration'] })
    },
  })

  if (!canUpdate) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Configurações"
          description="Identidade white-label, regras regimentais e assinatura do tenant."
          icon={<SettingsIcon />}
        />
        <EmptyState
          icon={<ShieldAlert />}
          title="Acesso restrito"
          description={`Somente Administrador da Câmara e Operador da Plataforma podem alterar as configurações do tenant. Seu perfil atual: ${actor ? ROLE_LABEL[actor.role] : '—'}.`}
        />
      </div>
    )
  }

  const setSetting = <K extends keyof TenantSettings>(key: K, value: TenantSettings[K]) =>
    setSettings((s) => ({ ...s, [key]: value }))

  const submit = () => {
    const errs: Record<string, string> = {}
    if (name.trim().length < 4) errs.name = 'Informe a razão social da Câmara (mín. 4 caracteres).'
    if (city.trim().length < 2) errs.city = 'Informe a cidade.'
    if (!/^[A-Z]{2}$/.test(uf.trim().toUpperCase())) errs.uf = 'UF com 2 letras (ex.: MG).'
    if (!Number.isInteger(settings.quorumMinimum) || settings.quorumMinimum < 1)
      errs.quorumMinimum = 'Informe um número inteiro ≥ 1.'
    if (!Number.isInteger(settings.speechDefaultSeconds) || settings.speechDefaultSeconds < 30)
      errs.speechDefaultSeconds = 'Tempo mínimo de 30 segundos.'
    if (settings.enabledSessionTypes.length === 0) errs.enabledSessionTypes = 'Habilite ao menos um tipo de sessão.'
    if (!Number.isInteger(settings.minimumAgendaMatters) || settings.minimumAgendaMatters < 0 || settings.minimumAgendaMatters > 100)
      errs.minimumAgendaMatters = 'Informe um número entre 0 e 100.'
    if (!Number.isInteger(settings.minimumNoticeHours) || settings.minimumNoticeHours < 0 || settings.minimumNoticeHours > 720)
      errs.minimumNoticeHours = 'Informe um número entre 0 e 720 horas.'
    if (!Number.isInteger(settings.minimumAmendmentHours) || settings.minimumAmendmentHours < 0 || settings.minimumAmendmentHours > 720)
      errs.minimumAmendmentHours = 'Informe um número entre 0 e 720 horas.'
    if (!Number.isInteger(settings.noticeAlertLeadHours) || settings.noticeAlertLeadHours < 1 || settings.noticeAlertLeadHours > 168)
      errs.noticeAlertLeadHours = 'Informe um número entre 1 e 168 horas.'
    if (settings.replayVisibilityDays !== null && (!Number.isInteger(settings.replayVisibilityDays) || settings.replayVisibilityDays < 1 || settings.replayVisibilityDays > 3650))
      errs.replayVisibilityDays = 'Informe de 1 a 3650 dias ou deixe vazio.'
    for (const [type, policy] of Object.entries(settings.votingPoliciesByMatterType)) {
      if (policy && (!Number.isInteger(policy.quorumMinimum) || policy.quorumMinimum < 1 || policy.quorumMinimum > 100))
        errs[`voting-${type}`] = 'Informe quórum entre 1 e 100.'
    }
    setErrors(errs)
    if (Object.keys(errs).length > 0 || !tenant) return
    save.mutate()
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configurações"
        description="Identidade white-label, regras regimentais e assinatura do tenant."
        icon={<SettingsIcon />}
        actions={
          <Button onClick={submit} disabled={save.isPending}>
            <Save /> {save.isPending ? 'Salvando…' : 'Salvar alterações'}
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Prontidão institucional para sessões oficiais</CardTitle>
          <CardDescription>Confira os cadastros e regras da Câmara. A aprovação registra uma versão interna; mudanças posteriores exigem nova aprovação antes de publicar outra sessão oficial.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {officialQ.isLoading ? <p className="text-sm text-muted-foreground">Verificando configuração…</p> : officialQ.isError ? <p className="text-sm text-destructive">Não foi possível verificar a configuração.</p> : officialQ.data && <>
            <p className="text-sm font-medium">{officialQ.data.approved ? `Aprovada · versão ${officialQ.data.revisions[0]?.version}` : officialQ.data.ready ? 'Pronta para aprovação interna' : 'Há itens pendentes'}</p>
            <div className="grid gap-2 md:grid-cols-2">
              {officialQ.data.checks.map((check) => <div key={check.id} className="rounded-md border p-3 text-sm">
                <p className="font-medium">{check.ok ? '✓' : '○'} {check.label}</p>
                <p className="text-muted-foreground">{check.detail}</p>
              </div>)}
            </div>
            {officialQ.data.revisions.length > 0 && <p className="text-xs text-muted-foreground">Última aprovação: v{officialQ.data.revisions[0].version}, referência {officialQ.data.revisions[0].approvalReference}, por {officialQ.data.revisions[0].approvedByName}.</p>}
            {officialQ.data.ready && !officialQ.data.approved && <div className="space-y-3 rounded-md border p-3">
              <Label htmlFor="approval-reference">Referência do ato ou protocolo de aprovação</Label>
              <Input id="approval-reference" value={approvalReference} onChange={(e) => setApprovalReference(e.target.value)} placeholder="Ex.: Portaria 12/2026" />
              <label className="flex items-start gap-2 text-sm"><Checkbox checked={acknowledged} onCheckedChange={(v) => setAcknowledged(v === true)} /> Confirmo que os dados e regras foram conferidos pela Câmara.</label>
              <Button disabled={!acknowledged || approvalReference.trim().length < 3 || approve.isPending} onClick={() => approve.mutate()}>Aprovar configuração atual</Button>
            </div>}
          </>}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          {/* Identidade */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Landmark className="size-4 text-primary" /> Identidade
              </CardTitle>
              <CardDescription>Nome institucional exibido em documentos, portal público e telão.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="tenant-name">Nome da Câmara *</Label>
                <Input
                  id="tenant-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Câmara Municipal de ..."
                  aria-invalid={!!errors.name}
                />
                {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
              </div>
              <div className="grid grid-cols-[1fr_5rem] gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="tenant-city">Cidade *</Label>
                  <Input
                    id="tenant-city"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    aria-invalid={!!errors.city}
                  />
                  {errors.city && <p className="text-xs text-destructive">{errors.city}</p>}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="tenant-uf">UF *</Label>
                  <Input
                    id="tenant-uf"
                    value={uf}
                    onChange={(e) => setUf(e.target.value.toUpperCase())}
                    maxLength={2}
                    placeholder="MG"
                    className="uppercase"
                    aria-invalid={!!errors.uf}
                  />
                  {errors.uf && <p className="text-xs text-destructive">{errors.uf}</p>}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Regras regimentais */}
          <Card>
            <CardHeader><CardTitle className="text-base">Replay local</CardTitle><CardDescription>Prazo de exibição pública por Câmara. O original permanece preservado até uma política documental aprovada.</CardDescription></CardHeader>
            <CardContent className="grid gap-2 sm:max-w-64">
              <Label htmlFor="tenant-replay-days">Dias de visibilidade pública</Label>
              <Input id="tenant-replay-days" type="number" min={1} max={3650} value={settings.replayVisibilityDays ?? ''} placeholder="Sem prazo automático"
                onChange={(e) => setSetting('replayVisibilityDays', e.target.value ? Number(e.target.value) : null)} aria-invalid={!!errors.replayVisibilityDays} />
              {errors.replayVisibilityDays && <p className="text-xs text-destructive">{errors.replayVisibilityDays}</p>}
            </CardContent>
          </Card>

          {/* Regras regimentais */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <SlidersHorizontal className="size-4 text-primary" /> Regras regimentais
              </CardTitle>
              <CardDescription>Parâmetros aplicados às sessões, votações e discursos deste tenant.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              <div className="grid gap-2 sm:max-w-56">
                <Label htmlFor="tenant-quorum">Quórum mínimo (vereadores) *</Label>
                <Input
                  id="tenant-quorum"
                  type="number"
                  min={1}
                  value={settings.quorumMinimum}
                  onChange={(e) => setSetting('quorumMinimum', Number(e.target.value))}
                  aria-invalid={!!errors.quorumMinimum}
                />
                <p className="text-xs text-muted-foreground">
                  Defina o mínimo conforme o regimento desta Câmara.
                </p>
                {errors.quorumMinimum && <p className="text-xs text-destructive">{errors.quorumMinimum}</p>}
              </div>

              <Separator />

              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label htmlFor="tenant-vote-change" className="text-sm font-medium">
                    Permitir alteração de voto
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Permitir alteração de voto enquanto a votação estiver aberta.
                  </p>
                </div>
                <Switch
                  id="tenant-vote-change"
                  checked={settings.allowVoteChange}
                  onCheckedChange={(v) => setSetting('allowVoteChange', v)}
                />
              </div>

              <div className="grid gap-2 sm:max-w-56">
                <Label htmlFor="tenant-speech">Tempo padrão de discurso (segundos) *</Label>
                <Input
                  id="tenant-speech"
                  type="number"
                  min={30}
                  step={30}
                  value={settings.speechDefaultSeconds}
                  onChange={(e) => setSetting('speechDefaultSeconds', Number(e.target.value))}
                  aria-invalid={!!errors.speechDefaultSeconds}
                />
                {errors.speechDefaultSeconds && (
                  <p className="text-xs text-destructive">{errors.speechDefaultSeconds}</p>
                )}
              </div>

              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label htmlFor="tenant-sound" className="text-sm font-medium">
                    Alertas sonoros
                  </Label>
                  <p className="text-xs text-muted-foreground">Alertas sonoros no cronômetro de discurso.</p>
                </div>
                <Switch
                  id="tenant-sound"
                  checked={settings.soundAlerts}
                  onCheckedChange={(v) => setSetting('soundAlerts', v)}
                />
              </div>

              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label htmlFor="tenant-hide-partial" className="text-sm font-medium">
                    Ocultar parcial por padrão
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Votações nascem com contagem parcial oculta no telão e no portal.
                  </p>
                </div>
                <Switch
                  id="tenant-hide-partial"
                  checked={settings.hidePartialByDefault}
                  onCheckedChange={(v) => setSetting('hidePartialByDefault', v)}
                />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Preparação de sessões</CardTitle>
              <CardDescription>Regras próprias desta Câmara, verificadas pelo servidor antes da publicação.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              <div className="grid gap-2">
                <Label>Tipos de sessão habilitados *</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(SESSION_TYPE_LABEL) as SessionType[]).map((sessionType) => (
                    <label key={sessionType} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={settings.enabledSessionTypes.includes(sessionType)}
                        onCheckedChange={(checked) => setSetting('enabledSessionTypes', checked
                          ? [...settings.enabledSessionTypes, sessionType]
                          : settings.enabledSessionTypes.filter((type) => type !== sessionType))}
                      />
                      {SESSION_TYPE_LABEL[sessionType]}
                    </label>
                  ))}
                </div>
                {errors.enabledSessionTypes && <p className="text-xs text-destructive">{errors.enabledSessionTypes}</p>}
              </div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <Label htmlFor="tenant-require-secretary">Exigir secretário(a) para publicar</Label>
                  <p className="text-xs text-muted-foreground">O rascunho pode ser salvo sem esse nome.</p>
                </div>
                <Switch id="tenant-require-secretary" checked={settings.requireSecretaryForPublication} onCheckedChange={(v) => setSetting('requireSecretaryForPublication', v)} />
              </div>
              <div className="grid gap-2 sm:max-w-64">
                <Label htmlFor="tenant-minimum-matters">Mínimo de matérias na ordem do dia</Label>
                <Input id="tenant-minimum-matters" type="number" min={0} max={100}
                  value={settings.minimumAgendaMatters}
                  onChange={(e) => setSetting('minimumAgendaMatters', Number(e.target.value))}
                  aria-invalid={!!errors.minimumAgendaMatters} />
                <p className="text-xs text-muted-foreground">Use 0 se sessões sem matéria puderem ser publicadas.</p>
                {errors.minimumAgendaMatters && <p className="text-xs text-destructive">{errors.minimumAgendaMatters}</p>}
              </div>
              <div className="grid gap-2 sm:max-w-64">
                <Label htmlFor="tenant-notice-hours">Antecedência mínima da convocação (horas)</Label>
                <Input id="tenant-notice-hours" type="number" min={0} max={720}
                  value={settings.minimumNoticeHours}
                  onChange={(e) => setSetting('minimumNoticeHours', Number(e.target.value))}
                  aria-invalid={!!errors.minimumNoticeHours} />
                <p className="text-xs text-muted-foreground">Verificada quando a pauta é publicada. Use 0 para não exigir prazo adicional.</p>
                {errors.minimumNoticeHours && <p className="text-xs text-destructive">{errors.minimumNoticeHours}</p>}
              </div>
              <div className="grid gap-2 sm:max-w-64">
                <Label htmlFor="tenant-amendment-hours">Antecedência mínima para retificar (horas)</Label>
                <Input id="tenant-amendment-hours" type="number" min={0} max={720}
                  value={settings.minimumAmendmentHours}
                  onChange={(e) => setSetting('minimumAmendmentHours', Number(e.target.value))}
                  aria-invalid={!!errors.minimumAmendmentHours} />
                <p className="text-xs text-muted-foreground">Aplica-se a toda emenda publicada antes do credenciamento. Use 0 para permitir até o horário da sessão.</p>
                {errors.minimumAmendmentHours && <p className="text-xs text-destructive">{errors.minimumAmendmentHours}</p>}
              </div>
              <div className="grid gap-2">
                <Label>Tipos que admitem exceção de prazo por urgência</Label>
                <p className="text-xs text-muted-foreground">Quando o prazo não for cumprido, o operador deverá informar uma justificativa específica, publicada na convocação. Sem seleção, nenhuma exceção é permitida.</p>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(SESSION_TYPE_LABEL) as SessionType[]).map((sessionType) => (
                    <label key={sessionType} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={settings.urgentNoticeExceptionTypes.includes(sessionType)}
                        onCheckedChange={(checked) => setSetting('urgentNoticeExceptionTypes', checked
                          ? [...settings.urgentNoticeExceptionTypes, sessionType]
                          : settings.urgentNoticeExceptionTypes.filter((type) => type !== sessionType))} />
                      {SESSION_TYPE_LABEL[sessionType]}
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid gap-2 sm:max-w-64">
                <Label htmlFor="tenant-notice-alert-lead">Avisar antes do prazo (horas)</Label>
                <Input id="tenant-notice-alert-lead" type="number" min={1} max={168}
                  value={settings.noticeAlertLeadHours}
                  onChange={(e) => setSetting('noticeAlertLeadHours', Number(e.target.value))}
                  aria-invalid={!!errors.noticeAlertLeadHours} />
                <p className="text-xs text-muted-foreground">Notificação interna para a administração e os operadores de sessão; padrão 24 horas.</p>
                {errors.noticeAlertLeadHours && <p className="text-xs text-destructive">{errors.noticeAlertLeadHours}</p>}
              </div>
              <div className="grid gap-2 sm:max-w-md">
                <Label htmlFor="tenant-notice-recipients">Destinatários da convocação</Label>
                <select id="tenant-notice-recipients" className="h-9 rounded-md border bg-background px-3 text-sm"
                  value={settings.noticeRecipientPolicy}
                  onChange={(e) => setSetting('noticeRecipientPolicy', e.target.value as TenantSettings['noticeRecipientPolicy'])}>
                  <option value="active">Todos os parlamentares ativos</option>
                  <option value="mandate_and_leave">Mandato vigente, afastamentos e suplentes</option>
                </select>
                <p className="text-xs text-muted-foreground">A segunda opção exige mandatos e afastamentos corretos na Estrutura Institucional. A lista é congelada em cada publicação ou retificação da pauta.</p>
              </div>
              <div className="grid gap-3 border-t pt-4">
                <div>
                  <p className="text-sm font-medium">Quórum e maioria por tipo de matéria</p>
                  <p className="text-xs text-muted-foreground">Opcional. Sem regra específica, a votação usa o quórum geral e a regra escolhida pela Mesa. Com regra específica, ambos são obrigatórios e congelados na votação.</p>
                </div>
                <div className="grid gap-2 sm:max-w-md">
                  <Label htmlFor="tenant-deliberative-roster">Base deliberativa da sessão</Label>
                  <select id="tenant-deliberative-roster" className="h-9 rounded-md border bg-background px-3 text-sm"
                    value={settings.deliberativeRosterPolicy}
                    onChange={(e) => setSetting('deliberativeRosterPolicy', e.target.value as TenantSettings['deliberativeRosterPolicy'])}>
                    <option value="active">Todos os parlamentares ativos</option>
                    <option value="mandate_and_leave">Mandatos, afastamentos e suplentes</option>
                  </select>
                  <p className="text-xs text-muted-foreground">Afeta presença, quórum e votos. A votação congela os participantes elegíveis ao abrir. Ative somente após conferir mandatos e licenças.</p>
                </div>
                <div className="grid gap-2 sm:max-w-md">
                  <Label htmlFor="tenant-voting-impediment">Impedimento por votação</Label>
                  <select id="tenant-voting-impediment" className="h-9 rounded-md border bg-background px-3 text-sm"
                    value={settings.votingImpedimentPolicy}
                    onChange={(e) => setSetting('votingImpedimentPolicy', e.target.value as TenantSettings['votingImpedimentPolicy'])}>
                    <option value="disabled">Desativado — aguarda definição regimental</option>
                    <option value="retain_base">Exclui o voto; mantém a base para maioria absoluta</option>
                    <option value="reduce_base">Exclui o voto e reduz a base da maioria absoluta</option>
                  </select>
                  <p className="text-xs text-muted-foreground">Em ambas as opções, o parlamentar impedido não conta como presente para o quórum da votação; o mínimo numérico exigido permanece o configurado. Defina conforme o regimento da Câmara antes de ativar.</p>
                </div>
                {(Object.keys(MATTER_TYPE_LABEL) as MatterType[]).map((type) => {
                  const policy = settings.votingPoliciesByMatterType[type]
                  return <div key={type} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_7rem] sm:items-center">
                    <label className="flex items-center gap-2 text-sm"><Checkbox checked={!!policy} onCheckedChange={(checked) => setSettings((current) => {
                      const next = { ...current.votingPoliciesByMatterType }
                      if (checked) next[type] = { rule: 'maioria_simples', quorumMinimum: current.quorumMinimum }
                      else delete next[type]
                      return { ...current, votingPoliciesByMatterType: next }
                    })} />{MATTER_TYPE_LABEL[type]}</label>
                    <select aria-label={`Regra de ${MATTER_TYPE_LABEL[type]}`} disabled={!policy} className="h-9 rounded-md border bg-background px-2 text-sm"
                      value={policy?.rule ?? 'maioria_simples'} onChange={(e) => setSettings((current) => ({ ...current,
                        votingPoliciesByMatterType: { ...current.votingPoliciesByMatterType,
                          [type]: { rule: e.target.value as VotingRule, quorumMinimum: current.votingPoliciesByMatterType[type]?.quorumMinimum ?? current.quorumMinimum } } }))}>
                      {(Object.keys(VOTING_RULE_LABEL) as VotingRule[]).map((rule) => <option key={rule} value={rule}>{VOTING_RULE_LABEL[rule]}</option>)}
                    </select>
                    <Input aria-label={`Quórum de ${MATTER_TYPE_LABEL[type]}`} type="number" min={1} max={100} disabled={!policy}
                      value={policy?.quorumMinimum ?? settings.quorumMinimum} onChange={(e) => setSettings((current) => ({ ...current,
                        votingPoliciesByMatterType: { ...current.votingPoliciesByMatterType,
                          [type]: { rule: current.votingPoliciesByMatterType[type]?.rule ?? 'maioria_simples', quorumMinimum: Number(e.target.value) } } }))} />
                    {errors[`voting-${type}`] && <p className="text-xs text-destructive sm:col-span-3">{errors[`voting-${type}`]}</p>}
                  </div>
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {/* Marca */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Palette className="size-4 text-primary" /> Marca (white-label)
              </CardTitle>
              <CardDescription>Cores institucionais aplicadas ao portal público, telão e documentos.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="tenant-primary">Cor primária</Label>
                  <div className="flex items-center gap-2">
                    <input
                      id="tenant-primary"
                      type="color"
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      className="size-9 cursor-pointer rounded-md border bg-transparent p-1"
                      aria-label="Selecionar cor primária"
                    />
                    <code className="font-mono text-xs text-muted-foreground">{primaryColor}</code>
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="tenant-accent">Cor de destaque</Label>
                  <div className="flex items-center gap-2">
                    <input
                      id="tenant-accent"
                      type="color"
                      value={accentColor}
                      onChange={(e) => setAccentColor(e.target.value)}
                      className="size-9 cursor-pointer rounded-md border bg-transparent p-1"
                      aria-label="Selecionar cor de destaque"
                    />
                    <code className="font-mono text-xs text-muted-foreground">{accentColor}</code>
                  </div>
                </div>
              </div>
              <BrandPreview primary={primaryColor} accent={accentColor} name={name} />
            </CardContent>
          </Card>

          {/* Plano e assinatura */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BadgeCheck className="size-4 text-primary" /> Plano e assinatura
              </CardTitle>
              <CardDescription>Somente leitura — gerenciado pela operação da plataforma.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <Badge className="gap-1 bg-primary text-primary-foreground">
                  <BadgeCheck className="size-3.5" /> Plano {tenant?.plan ?? '—'}
                </Badge>
                <p className="text-sm font-medium">edocBR Plenário — operação multi-Câmara</p>
              </div>
              <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                A exportação completa dos dados do tenant e o encerramento da assinatura seguem o runbook operacional
                da plataforma (LGPD e retenção de atas). Entre em contato com o suporte edocBR para
                executar esses procedimentos.
              </p>
              <dl className="grid gap-1 text-xs text-muted-foreground">
                <div className="flex gap-2">
                  <dt className="font-semibold">Slug público:</dt>
                  <dd className="font-mono">{tenant?.slug ?? '—'}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="font-semibold">Fuso horário:</dt>
                  <dd className="font-mono">{tenant?.timezone ?? '—'}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
