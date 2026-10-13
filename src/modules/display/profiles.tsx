'use client'

/**
 * Perfis do Telão (kiosk) — tipografia enorme, legível à distância,
 * fundo escuro institucional com detalhes nas cores do tenant.
 *
 * Perfis: boas_vindas · presenca · pauta · votacao · discurso · encerramento
 * Fase 18 (Onda 4): votações com opções regimentais customizadas exibem os
 * RÓTULOS (nunca apenas cor) na votação em curso e no resultado por rótulo.
 */

import { useRef } from 'react'
import {
  BadgeCheck,
  CalendarClock,
  Check,
  Clock,
  Gavel,
  Landmark,
  MessageSquareText,
  Mic,
  Minus,
  ScrollText,
  Users,
  Vote,
  X,
} from 'lucide-react'

import type { VoteValueOrEmpty, VotingOptionView } from '@/lib/contracts'
import { VOTING_MODE_LABEL } from '@/lib/contracts'
import type { PublicLiveViewExt } from '@/lib/api-client'
import { fmtTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { fmtCountdown, fmtDurationBig } from './tick'

export type DisplayProfile =
  | 'boas_vindas'
  | 'presenca'
  | 'pauta'
  | 'votacao'
  | 'discurso'
  | 'encerramento'

export const DISPLAY_PROFILE_LABEL: Record<DisplayProfile, string> = {
  boas_vindas: 'Boas-vindas',
  presenca: 'Presença',
  pauta: 'Pauta',
  votacao: 'Votação',
  discurso: 'Discurso',
  encerramento: 'Encerramento',
}

export type ProfileProps = {
  profile: DisplayProfile
  view: PublicLiveViewExt | null
  primary: string
  accent: string
  now: number
}

function MemberImages({ photoUrl, partyEmblemUrl, name, size = 'small' }: {
  photoUrl: string | null; partyEmblemUrl: string | null; name: string; size?: 'small' | 'large'
}) {
  if (!photoUrl && !partyEmblemUrl) return null
  const large = size === 'large'
  return (
    <span className="flex shrink-0 items-center gap-2">
      {photoUrl && <img src={photoUrl} alt={`Foto de ${name}`} className={cn('rounded-full border border-white/20 object-cover', large ? 'size-28 sm:size-36' : 'size-10')} />}
      {partyEmblemUrl && <img src={partyEmblemUrl} alt="Emblema do partido" className={cn('rounded bg-white/95 p-1 object-contain', large ? 'size-16 sm:size-20' : 'size-9')} />}
    </span>
  )
}

export function ProfileView({ profile, view, primary, accent, now }: ProfileProps) {
  switch (profile) {
    case 'presenca':
      return <PresenceProfile view={view} primary={primary} />
    case 'pauta':
      return <AgendaProfile view={view} accent={accent} now={now} />
    case 'votacao':
      return <VotingProfile view={view} primary={primary} accent={accent} />
    case 'discurso':
      return <SpeechProfile view={view} primary={primary} accent={accent} />
    case 'encerramento':
      return <ClosedProfile view={view} primary={primary} />
    case 'boas_vindas':
    default:
      return <WelcomeProfile view={view} accent={accent} />
  }
}

// ─── 1. Boas-vindas ────────────────────────────────────────────────────────

function WelcomeProfile({ view, accent }: { view: PublicLiveViewExt | null; accent: string }) {
  const session = view?.session
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center" aria-label="Perfil de boas-vindas">
      <Landmark className="size-24 shrink-0 sm:size-32" style={{ color: accent }} aria-hidden />
      <div className="flex flex-col items-center gap-3">
        <h1 className="font-serif text-[clamp(2rem,5.5vw,4.5rem)] font-bold leading-tight">
          {view?.tenant.name ?? 'Câmara Municipal'}
        </h1>
        {view?.tenant && (
          <p className="text-[clamp(1rem,2vw,1.5rem)] text-zinc-400">
            {view.tenant.city} · {view.tenant.uf}
          </p>
        )}
      </div>
      {session ? (
        <div className="flex flex-col items-center gap-2 border-t border-white/10 pt-6">
          <p className="text-[clamp(1.25rem,2.8vw,2.25rem)] font-semibold">{session.label}</p>
          {session.scheduledAt && (
            <p className="flex items-center gap-2 text-[clamp(1rem,2vw,1.5rem)] text-zinc-300">
              <CalendarClock className="size-[1.2em]" aria-hidden />
              Início previsto às {fmtTime(session.scheduledAt)}
            </p>
          )}
          {session.presidentName && (
            <p className="text-[clamp(0.95rem,1.8vw,1.35rem)] text-zinc-400">
              Presidência: {session.presidentName}
            </p>
          )}
        </div>
      ) : (
        <p className="text-[clamp(1rem,2vw,1.5rem)] text-zinc-400">
          Painel do plenário — aguardando a próxima sessão.
        </p>
      )}
    </section>
  )
}

// ─── 2. Presença ───────────────────────────────────────────────────────────

function PresenceProfile({ view, primary }: { view: PublicLiveViewExt | null; primary: string }) {
  const session = view?.session
  const members = view?.presentMembers ?? []
  const present = session?.presentCount ?? members.length
  const total = session?.totalMembers ?? members.length
  const required = session?.requiredQuorum ?? 0
  const ok = required > 0 ? present >= required : true
  const pct = required > 0 ? Math.min(100, Math.round((present / required) * 100)) : 100

  return (
    <section className="flex flex-1 flex-col gap-6 overflow-y-auto custom-scroll p-6 sm:p-10" aria-label="Perfil de presença">
      <header className="flex flex-col items-center gap-2 text-center">
        <h1 className="flex items-center gap-3 text-[clamp(1.5rem,4vw,3rem)] font-bold uppercase tracking-wide">
          <Users className="size-[1.2em]" style={{ color: primary }} aria-hidden />
          Parlamentares presentes
        </h1>
        <p className="font-mono text-[clamp(2.5rem,7vw,5.5rem)] font-bold leading-none tabular-nums">
          <span className={ok ? 'text-emerald-400' : 'text-amber-400'}>{present}</span>
          <span className="text-zinc-500">/{total}</span>
        </p>
      </header>

      <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-2">
        <div className="h-3 w-full overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={present} aria-valuemin={0} aria-valuemax={required} aria-label={`Quórum: ${present} de ${required} necessários`}>
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, backgroundColor: ok ? primary : '#f59e0b' }}
          />
        </div>
        <p className={cn('text-[clamp(0.9rem,1.6vw,1.25rem)] font-semibold', ok ? 'text-emerald-400' : 'text-amber-400')}>
          {ok ? 'Quórum atingido' : 'Quórum insuficiente'} · mínimo regimental de {required}
        </p>
      </div>

      <div className="mx-auto grid w-full max-w-6xl grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
        {members.map((m) => (
          <div key={m.name} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
            {(m.photoUrl || m.partyEmblemUrl) && <MemberImages photoUrl={m.photoUrl} partyEmblemUrl={m.partyEmblemUrl} name={m.name} />}
            {!m.photoUrl && <span
              className="flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-bold"
              style={{ backgroundColor: `${primary}33`, color: '#fff' }}
              aria-hidden
            >
              {m.name
                .split(' ')
                .map((p) => p[0])
                .slice(0, 2)
                .join('')}
            </span>}
            <div className="min-w-0">
              <p className="truncate text-[clamp(1rem,1.8vw,1.4rem)] font-semibold leading-tight">{m.name}</p>
              <p className="font-mono text-sm text-zinc-400">{m.party}</p>
            </div>
          </div>
        ))}
        {members.length === 0 && (
          <p className="col-span-full py-8 text-center text-[clamp(1rem,2vw,1.5rem)] text-zinc-500">
            Nenhum parlamentar presente ainda.
          </p>
        )}
      </div>
    </section>
  )
}

// ─── 3. Pauta ──────────────────────────────────────────────────────────────

type AgendaEntry = PublicLiveViewExt['agenda'][number]

function agendaStatusVisual(status: AgendaEntry['status']): { label: string; cls: string; icon: React.ReactNode } | null {
  switch (status) {
    case 'aprovado':
      return { label: 'Aprovado', cls: 'text-emerald-400', icon: <Check className="size-[1.1em]" strokeWidth={3} /> }
    case 'rejeitado':
      return { label: 'Rejeitado', cls: 'text-rose-400', icon: <X className="size-[1.1em]" strokeWidth={3} /> }
    case 'em_votacao':
      return { label: 'Em votação', cls: 'animate-pulse text-amber-400', icon: <Vote className="size-[1.1em]" /> }
    case 'em_discussao':
      return { label: 'Em discussão', cls: 'text-amber-300', icon: <MessageSquareText className="size-[1.1em]" /> }
    case 'em_leitura':
      return { label: 'Em leitura', cls: 'text-zinc-300', icon: <ScrollText className="size-[1.1em]" /> }
    case 'retirado':
      return { label: 'Retirado', cls: 'text-zinc-500', icon: <X className="size-[1.1em]" /> }
    case 'adiado':
      return { label: 'Adiado', cls: 'text-zinc-500', icon: <CalendarClock className="size-[1.1em]" /> }
    default:
      return null
  }
}

function AgendaProfile({
  view,
  accent,
  now,
}: {
  view: PublicLiveViewExt | null
  accent: string
  now: number
}) {
  const agenda = view?.agenda ?? []
  const session = view?.session
  const scheduledAt = session?.status === 'scheduled' ? session.scheduledAt : null
  const isScheduled = !!scheduledAt
  const countdown = scheduledAt ? new Date(scheduledAt).getTime() - now : 0
  const scheduledLabel = scheduledAt ? fmtTime(scheduledAt) : null

  const sections: Array<{ label: string; items: AgendaEntry[] }> = [
    { label: 'Expediente', items: agenda.filter((i) => i.section === 'expediente') },
    { label: 'Ordem do Dia', items: agenda.filter((i) => i.section === 'ordem_do_dia') },
    { label: 'Comunicações', items: agenda.filter((i) => i.section === 'comunicacoes') },
  ].filter((s) => s.items.length > 0)

  return (
    <section className="flex flex-1 flex-col gap-5 overflow-y-auto custom-scroll p-6 sm:p-8" aria-label="Perfil de pauta">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-[clamp(1.5rem,4vw,3rem)] font-bold uppercase tracking-wide" style={{ color: accent }}>
          Ordem do Dia
        </h1>
        {isScheduled && scheduledLabel && (
          <p className="flex items-center gap-2 rounded-full border border-white/15 px-4 py-1.5 text-[clamp(0.9rem,1.6vw,1.3rem)] font-semibold text-zinc-300 tabular-nums">
            <Clock className="size-[1.2em]" aria-hidden />
            Início às {scheduledLabel} · em {fmtCountdown(countdown)}
          </p>
        )}
      </header>

      {agenda.length === 0 && (
        <p className="py-10 text-center text-[clamp(1rem,2vw,1.5rem)] text-zinc-500">
          Pauta ainda não publicada.
        </p>
      )}

      {sections.map((sec) => (
        <div key={sec.label} className="flex flex-col gap-2">
          <p className="text-[clamp(0.8rem,1.4vw,1rem)] font-bold uppercase tracking-[0.2em] text-zinc-500">
            {sec.label}
          </p>
          <ul className="grid gap-2 xl:grid-cols-2">
            {sec.items.map((item, i) => {
              const visual = agendaStatusVisual(item.status)
              const current = item.status === 'em_votacao' || item.status === 'em_discussao'
              return (
                <li
                  key={item.id}
                  className={cn(
                    'flex items-start gap-4 rounded-xl border-2 bg-white/[0.03] px-4 py-3',
                    current ? 'border-amber-500/80' : 'border-white/10'
                  )}
                >
                  <span
                    className="font-mono text-[clamp(1.4rem,3vw,2.4rem)] font-bold leading-none tabular-nums"
                    style={{ color: accent }}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[clamp(1.05rem,2vw,1.6rem)] font-medium leading-snug">
                      {item.title}
                    </p>
                    {item.resultSummary && (
                      <p className="mt-1 line-clamp-1 text-[clamp(0.85rem,1.4vw,1.1rem)] text-zinc-400">
                        {item.resultSummary}
                      </p>
                    )}
                  </div>
                  {visual && (
                    <span
                      className={cn(
                        'flex shrink-0 items-center gap-1.5 text-[clamp(0.9rem,1.6vw,1.25rem)] font-bold uppercase tracking-wide',
                        visual.cls
                      )}
                    >
                      {visual.icon} {visual.label}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      ))}

      <footer className="mt-auto pt-2 text-center text-[clamp(0.8rem,1.4vw,1rem)] text-zinc-400">
        {view?.tenant.name ?? ''} — pauta da sessão{session ? ` ${session.label}` : ''}
        <span className="mx-2" style={{ color: accent }} aria-hidden>·</span>
        {agenda.filter((i) => i.status === 'aprovado').length} aprovado(s)
      </footer>
    </section>
  )
}

// ─── 4. Votação ────────────────────────────────────────────────────────────

type ResultSource = {
  question: string
  mode?: string
  resultStatus: string | null
  resultCounts: PublicLiveViewExt['lastResults'][number]['resultCounts']
  nominalDetail: PublicLiveViewExt['lastResults'][number]['nominalDetail']
  /** Fase 18: opções regimentais customizadas (rótulos públicos). */
  options?: VotingOptionView[]
}

/** Fase 18 — tons alternados para contagens por rótulo (nunca só cor). */
const CUSTOM_COUNT_TONES = ['text-emerald-400', 'text-rose-400', 'text-amber-400', 'text-sky-300', 'text-zinc-300']

const RESULT_STYLE: Record<string, { text: string }> = {
  aprovado: { text: 'text-emerald-400' },
  rejeitado: { text: 'text-rose-400' },
  empate: { text: 'text-amber-400' },
  sem_quorum: { text: 'text-zinc-300' },
  anulado: { text: 'text-zinc-400' },
}

const RESULT_LABEL: Record<string, string> = {
  aprovado: 'Aprovado',
  rejeitado: 'Rejeitado',
  empate: 'Empate',
  sem_quorum: 'Sem quórum',
  anulado: 'Anulado',
}

function VotingProfile({ view, primary, accent }: { view: PublicLiveViewExt | null; primary: string; accent: string }) {
  const current = view?.currentVoting ?? null
  const last = view?.lastResults?.[0] ?? null

  // Votação em andamento (aberta/pausada)
  if (current && (current.status === 'open' || current.status === 'paused')) {
    const present = view?.session?.presentCount ?? 0
    const pct = present > 0 ? Math.min(100, Math.round((current.registeredCount / present) * 100)) : 0
    const options = current.options ?? []
    return (
      <section className="flex flex-1 flex-col items-center justify-center gap-6 p-8 text-center" aria-label="Perfil de votação em andamento">
        <h1 className="max-w-5xl text-[clamp(1.5rem,4vw,3.2rem)] font-bold leading-tight">
          {current.question}
        </h1>
        <p
          className={cn(
            'flex items-center gap-3 text-[clamp(1.1rem,2.4vw,2rem)] font-black uppercase tracking-[0.15em]',
            current.status === 'open' ? 'animate-pulse text-amber-400' : 'text-zinc-300'
          )}
        >
          <Gavel className="size-[1.2em]" style={{ color: accent }} aria-hidden />
          {current.status === 'open' ? 'Votação em andamento' : 'Votação pausada'}
        </p>
        <p className="text-[clamp(1rem,2vw,1.6rem)] font-semibold text-zinc-300">
          Votação {VOTING_MODE_LABEL[current.mode]}
        </p>
        {/* Fase 18: rótulos das opções regimentais (legíveis, nunca só cor) */}
        {options.length > 0 && (
          <ul className="flex max-w-4xl flex-wrap items-center justify-center gap-3" aria-label="Opções da votação">
            {options.map((o) => (
              <li
                key={o.key}
                className="flex items-center gap-2 rounded-full border-2 border-white/20 bg-white/[0.05] px-5 py-2 text-[clamp(0.95rem,1.8vw,1.4rem)] font-bold"
              >
                <BadgeCheck className="size-[1.2em] shrink-0" style={{ color: primary }} aria-hidden />
                {o.label}
              </li>
            ))}
          </ul>
        )}
        <div className="w-full max-w-2xl">
          <p className="mb-2 font-mono text-[clamp(1.8rem,4.5vw,3.5rem)] font-bold tabular-nums">
            {current.registeredCount}
            <span className="text-zinc-500"> / {present} </span>
            <span className="text-[clamp(1rem,2vw,1.5rem)] font-medium text-zinc-400">votos registrados</span>
          </p>
          <div className="h-4 w-full overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={current.registeredCount} aria-valuemin={0} aria-valuemax={present} aria-label={`${current.registeredCount} de ${present} votos registrados`}>
            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: primary }} />
          </div>
          <p className="mt-3 text-[clamp(0.85rem,1.5vw,1.1rem)] text-zinc-500">
            {current.hidePartial
              ? 'Resultados parciais ocultos por decisão da mesa'
              : 'Resultados parciais não são exibidos no painel público'}
          </p>
        </div>
      </section>
    )
  }

  // Resultado (votação recém-encerrada ou último resultado da sessão)
  const result: ResultSource | null = current?.status === 'closed'
    ? {
        question: current.question,
        mode: current.mode,
        resultStatus: current.resultStatus,
        resultCounts: current.resultCounts,
        nominalDetail: current.nominalDetail,
        options: current.options ?? [],
      }
    : last
      ? {
          question: last.question,
          resultStatus: last.resultStatus,
          resultCounts: last.resultCounts,
          nominalDetail: last.nominalDetail,
          options: last.options ?? [],
        }
      : null

  if (!result) {
    return (
      <section className="flex flex-1 items-center justify-center p-8" aria-label="Votação indisponível">
        <p className="text-[clamp(1rem,2vw,1.5rem)] text-zinc-500">Nenhuma votação disponível.</p>
      </section>
    )
  }

  const counts = result.resultCounts
  const style = RESULT_STYLE[result.resultStatus ?? ''] ?? { text: 'text-zinc-300' }
  const customOptions = result.options ?? []
  const custom = counts?.custom ?? null
  const showCustom = customOptions.length > 0 && !!custom

  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto custom-scroll p-8 text-center" aria-label="Perfil de resultado da votação">
      <h1 className="max-w-5xl text-[clamp(1.25rem,3vw,2.5rem)] font-semibold leading-tight text-zinc-300">
        {result.question}
      </h1>
      <p className={cn('text-[clamp(2.5rem,9vw,7rem)] font-black uppercase leading-none tracking-tight', style.text)}>
        {RESULT_LABEL[result.resultStatus ?? ''] ?? 'Resultado'}
      </p>

      {counts && showCustom ? (
        <div
          className="grid w-full max-w-4xl gap-3 sm:gap-6"
          style={{ gridTemplateColumns: `repeat(${Math.min(customOptions.length + 1, 4)}, minmax(0, 1fr))` }}
        >
          {customOptions.map((o, i) => (
            <BigCount
              key={o.key}
              label={o.label}
              value={custom?.[o.key] ?? 0}
              cls={CUSTOM_COUNT_TONES[i % CUSTOM_COUNT_TONES.length]}
            />
          ))}
          <BigCount label="Não registraram" value={counts.naoRegistraram} cls="text-zinc-500" />
        </div>
      ) : counts ? (
        <div className="grid w-full max-w-4xl grid-cols-3 gap-3 sm:gap-6">
          <BigCount label="Sim" value={counts.sim} cls="text-emerald-400" />
          <BigCount label="Não" value={counts.nao} cls="text-rose-400" />
          <BigCount label="Abstenções" value={counts.abstencoes} cls="text-amber-400" />
        </div>
      ) : null}

      {result.nominalDetail && result.nominalDetail.length > 0 ? (
        <div className="w-full max-w-5xl">
          <p className="mb-3 text-[clamp(0.8rem,1.4vw,1rem)] font-bold uppercase tracking-[0.2em] text-zinc-500">
            Votação nominal
          </p>
          <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {result.nominalDetail.map((d) => (
              <li key={d.name} className="flex items-center justify-between gap-3 border-b border-white/5 py-1.5">
                <span className="flex min-w-0 items-center gap-2 truncate text-[clamp(0.95rem,1.6vw,1.3rem)] font-medium">
                  <MemberImages photoUrl={d.photoUrl} partyEmblemUrl={d.partyEmblemUrl} name={d.name} />
                  {d.name} <span className="font-mono text-sm text-zinc-500">{d.party}</span>
                </span>
                <VoteTag value={d.value} options={customOptions} />
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="rounded-xl border border-white/10 px-6 py-3 text-[clamp(0.95rem,1.8vw,1.35rem)] text-zinc-400">
          Votação secreta — apenas o resultado agregado é divulgado.
        </p>
      )}
    </section>
  )
}

function BigCount({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-5">
      <p className={cn('font-mono text-[clamp(2.2rem,6vw,4.5rem)] font-bold leading-none tabular-nums', cls)}>
        {value}
      </p>
      <p className="mt-2 text-[clamp(0.85rem,1.6vw,1.2rem)] font-semibold uppercase tracking-wider text-zinc-400">
        {label}
      </p>
    </div>
  )
}

function VoteTag({ value, options = [] }: { value: VoteValueOrEmpty; options?: VotingOptionView[] }) {
  // Fase 18: chave de opção customizada → RÓTULO regimental (nunca só cor)
  if (value !== 'sim' && value !== 'nao' && value !== 'abstencao' && value !== 'nao_registrado') {
    const option = options.find((o) => o.key === value)
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-[clamp(0.9rem,1.6vw,1.25rem)] font-bold uppercase text-zinc-200">
        <BadgeCheck className="size-[1.1em]" aria-hidden /> {option?.label ?? value}
      </span>
    )
  }
  if (value === 'sim')
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-[clamp(0.9rem,1.6vw,1.25rem)] font-bold uppercase text-emerald-400">
        <Check className="size-[1.1em]" strokeWidth={3} /> Sim
      </span>
    )
  if (value === 'nao')
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-[clamp(0.9rem,1.6vw,1.25rem)] font-bold uppercase text-rose-400">
        <X className="size-[1.1em]" strokeWidth={3} /> Não
      </span>
    )
  if (value === 'abstencao')
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-[clamp(0.9rem,1.6vw,1.25rem)] font-bold uppercase text-amber-400">
        <Minus className="size-[1.1em]" strokeWidth={3} /> Abstenção
      </span>
    )
  return (
    <span className="shrink-0 text-[clamp(0.9rem,1.6vw,1.25rem)] text-zinc-600">—</span>
  )
}

// ─── 5. Discurso ───────────────────────────────────────────────────────────

function SpeechProfile({ view, primary, accent }: { view: PublicLiveViewExt | null; primary: string; accent: string }) {
  const speech = view?.speakingNow ?? null
  const baseRef = useRef<{ key: string; elapsed: number; at: number }>({ key: '', elapsed: 0, at: 0 })

  let elapsed = 0
  if (speech) {
    const key = `${speech.speakerName}|${speech.subject ?? ''}|${speech.status}|${speech.elapsedSeconds}|${speech.plannedSeconds}`
    if (baseRef.current.key !== key) {
      baseRef.current = { key, elapsed: speech.elapsedSeconds, at: Date.now() }
    }
    elapsed =
      baseRef.current.elapsed +
      (speech.status === 'falando' ? Math.floor((Date.now() - baseRef.current.at) / 1000) : 0)
  }

  if (!speech) {
    return (
      <section className="flex flex-1 items-center justify-center p-8" aria-label="Discurso indisponível">
        <p className="text-[clamp(1rem,2vw,1.5rem)] text-zinc-500">Nenhum orador no palco.</p>
      </section>
    )
  }

  const planned = Math.max(1, speech.plannedSeconds)
  const remaining = planned - elapsed
  const over = elapsed > planned
  const warn = !over && remaining <= 30
  const party = speech.party
  const timerCls = over
    ? 'animate-pulse text-rose-400'
    : warn
      ? 'text-amber-400'
      : 'text-zinc-50'
  const pct = Math.min(100, (elapsed / planned) * 100)

  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-5 p-8 text-center" aria-label="Perfil de discurso">
      <p className="flex items-center gap-3 text-[clamp(0.9rem,2vw,1.4rem)] font-black uppercase tracking-[0.25em]" style={{ color: accent }}>
        <Mic className="size-[1.3em]" aria-hidden />
        Com a palavra
      </p>
      <h1 className="max-w-5xl text-[clamp(2.2rem,7vw,5.5rem)] font-bold leading-tight">
        {speech.speakerName}
      </h1>
      <MemberImages photoUrl={speech.photoUrl} partyEmblemUrl={speech.partyEmblemUrl} name={speech.speakerName} size="large" />
      {party && <p className="font-mono text-[clamp(1rem,2vw,1.5rem)] text-zinc-400">{party}</p>}
      {speech.subject && (
        <p className="max-w-4xl text-[clamp(1.1rem,2.4vw,1.9rem)] text-zinc-300">{speech.subject}</p>
      )}

      <p
        className={cn('font-mono text-[clamp(3rem,10vw,8rem)] font-bold leading-none tabular-nums', timerCls)}
        role="timer"
        aria-label={`Tempo de tribuna: ${fmtDurationBig(elapsed)}`}
      >
        {fmtDurationBig(elapsed)}
      </p>
      <p className={cn('text-[clamp(0.95rem,1.8vw,1.35rem)] font-semibold', over ? 'text-rose-400' : 'text-zinc-400')}>
        {over
          ? `Tempo excedido em ${fmtDurationBig(elapsed - planned)}`
          : `${fmtDurationBig(remaining)} restantes de ${fmtDurationBig(planned)}`}
      </p>
      <div className="h-3 w-full max-w-2xl overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={Math.min(elapsed, planned)} aria-valuemin={0} aria-valuemax={planned} aria-label="Progresso do discurso">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: over ? '#f43f5e' : primary }}
        />
      </div>
      {speech.status === 'pausado' && (
        <p className="text-[clamp(0.9rem,1.6vw,1.2rem)] font-semibold uppercase tracking-widest text-amber-400">
          Discurso pausado
        </p>
      )}
    </section>
  )
}

// ─── 6. Encerramento ───────────────────────────────────────────────────────

function ClosedProfile({ view, primary }: { view: PublicLiveViewExt | null; primary: string }) {
  const session = view?.session
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-5 p-8 text-center" aria-label="Perfil de encerramento">
      <Landmark className="size-16 shrink-0 sm:size-20" style={{ color: primary }} aria-hidden />
      <h1 className="text-[clamp(2rem,7vw,5rem)] font-black uppercase leading-none tracking-tight">
        Sessão encerrada
      </h1>
      {session && (
        <p className="text-[clamp(1.25rem,3vw,2.25rem)] font-semibold text-zinc-300">{session.label}</p>
      )}
      <p className="max-w-3xl text-[clamp(1rem,2vw,1.5rem)] text-zinc-400">
        Ata e resultados disponíveis no portal da transparência.
      </p>
      {(view?.lastResults?.length ?? 0) > 0 && (
        <ul className="mt-2 flex w-full max-w-3xl flex-col gap-1.5">
          {view!.lastResults.slice(0, 5).map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-4 rounded-lg border border-white/10 px-4 py-2 text-left">
              <span className="min-w-0 flex-1 truncate text-[clamp(0.9rem,1.6vw,1.2rem)] text-zinc-300">
                {r.question}
              </span>
              <span
                className={cn(
                  'shrink-0 text-[clamp(0.9rem,1.6vw,1.2rem)] font-bold uppercase',
                  RESULT_STYLE[r.resultStatus ?? '']?.text ?? 'text-zinc-300'
                )}
              >
                {RESULT_LABEL[r.resultStatus ?? ''] ?? '—'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
