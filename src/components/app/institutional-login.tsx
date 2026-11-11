'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, CheckCircle2, ChevronRight, KeyRound, Landmark, Lock, ShieldCheck, Sparkles } from 'lucide-react'
import LoginForm, { type LoggedInActor } from '@/components/app/login-form'
import { BrandLogo } from '@/components/brand/brand-logo'
import { useApp } from '@/lib/store'
import { ROLE_LABEL } from '@/lib/contracts'
import { toast } from 'sonner'

export function InstitutionalLogin({
  onLoggedIn,
  onBackToPresentation,
}: {
  onLoggedIn: (actor: LoggedInActor) => void
  onBackToPresentation?: () => void
}) {
  const bootstrap = useApp((s) => s.bootstrap)
  const setActor = useApp((s) => s.setActor)

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-3 sm:p-6 lg:p-10">
      <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] rounded-2xl overflow-hidden border border-slate-200/90 shadow-2xl bg-white">
        {/* COLUNA ESQUERDA: COFRE INSTITUCIONAL (DARK ARCHITECTURAL) */}
        <aside className="relative bg-gradient-to-br from-[#020b18] via-[#051833] to-[#08264e] p-6 sm:p-10 lg:p-12 text-white flex flex-col justify-between overflow-hidden">
          {/* Malha sutil de fundo */}
          <div
            className="absolute inset-0 opacity-10 pointer-events-none"
            style={{
              backgroundImage: 'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
              backgroundSize: '40px 40px',
            }}
          />

          {/* Hemiciclo Geométrico em Marca d'Água */}
          <svg className="absolute -right-24 top-20 w-96 h-96 opacity-15 pointer-events-none" viewBox="0 0 400 400" fill="none">
            <circle cx="200" cy="200" r="180" stroke="#d49b35" strokeWidth="1.5" strokeDasharray="6 6" />
            <circle cx="200" cy="200" r="135" stroke="#ffffff" strokeWidth="1" />
            <circle cx="200" cy="200" r="90" stroke="#d49b35" strokeWidth="1.5" />
            <circle cx="200" cy="200" r="45" stroke="#ffffff" strokeWidth="1" />
          </svg>

          {/* Topo do Cofre */}
          <div className="relative z-10 flex items-center justify-between gap-4">
            <BrandLogo inverse compact />

            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-0.5 text-[10.5px] font-mono font-bold text-emerald-300">
              <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" />
              SESSÃO SEGURA
            </span>
          </div>

          {/* Centro do Cofre */}
          <div className="relative z-10 my-8 lg:my-12 max-w-lg space-y-4">
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/15 px-3 py-1 text-[11px] font-bold text-amber-300 tracking-wide">
              <span>●</span> Autenticação Institucional &amp; Controle de Autoridade
            </span>

            <h1 className="font-serif text-3xl sm:text-4xl leading-[1.12] tracking-tight font-normal text-white">
              Segurança regimental e <span className="text-amber-300">rastro criptográfico</span> em cada acesso ao plenário.
            </h1>

            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              O acesso à operação interna do edocBR Plenário é protegido por credenciais nominais, segundo fator TOTP para contas com prerrogativas administrativas, escopo estrito por Câmara e auditoria append-only SHA-256.
            </p>

            <div className="space-y-2.5 pt-2">
              <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 p-3.5 backdrop-blur-sm">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-amber-500/40 bg-amber-500/20 font-mono text-xs font-bold text-amber-300">
                  01
                </span>
                <div className="text-xs">
                  <strong className="block text-white">Isolamento Multi-Câmara e Sessão Segura</strong>
                  <span className="text-slate-300 leading-relaxed text-[11.5px]">
                    Cookie <code className="font-mono text-amber-200">HttpOnly</code> vinculado ao <code className="font-mono text-amber-200">tenantId</code>, com revogação remota e expiração em 7 dias.
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 p-3.5 backdrop-blur-sm">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-amber-500/40 bg-amber-500/20 font-mono text-xs font-bold text-amber-300">
                  02
                </span>
                <div className="text-xs">
                  <strong className="block text-white">Dupla Identidade em Deliberações Oficiais</strong>
                  <span className="text-slate-300 leading-relaxed text-[11.5px]">
                    Contagem simbólica oficial e publicação de ata exigem proposição e confirmação por dois operadores distintos.
                  </span>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 p-3.5 backdrop-blur-sm">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-amber-500/40 bg-amber-500/20 font-mono text-xs font-bold text-amber-300">
                  03
                </span>
                <div className="text-xs">
                  <strong className="block text-white">Adequação Nativa à LGPD (Arts. 7º, III e 46)</strong>
                  <span className="text-slate-300 leading-relaxed text-[11.5px]">
                    Monitoramento exclusivo de segurança e fé pública, sem pixels de rastreamento comercial ou cookies publicitários.
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Rodapé do Cofre */}
          <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4 text-xs text-slate-400">
            {onBackToPresentation ? (
              <button
                type="button"
                onClick={onBackToPresentation}
                className="inline-flex items-center gap-1.5 hover:text-white transition-colors"
              >
                <ArrowLeft className="size-3.5" /> Voltar para a Apresentação
              </button>
            ) : (
              <Link href="/apresentacao" className="inline-flex items-center gap-1.5 hover:text-white transition-colors">
                <ArrowLeft className="size-3.5" /> Conhecer a plataforma
              </Link>
            )}
            <span className="font-mono text-[11px] text-amber-300/80">API: /api/v1/auth/login</span>
          </div>
        </aside>

        {/* COLUNA DIREITA: CONSOLE DE AUTENTICAÇÃO */}
        <main className="p-6 sm:p-10 lg:p-12 flex flex-col justify-center bg-slate-50/70">
          <div className="w-full max-w-md mx-auto space-y-6">
            {/* Seletor do Tenant / Câmara Ativa */}
            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#072348] text-amber-300 font-bold text-xs">
                  <Landmark className="size-4" />
                </div>
                <div className="min-w-0">
                  <strong className="block truncate text-xs sm:text-sm font-bold text-slate-900">
                    {bootstrap?.tenant.name ?? 'Câmara Municipal'}
                  </strong>
                  <span className="block truncate font-mono text-[11px] text-slate-700">
                    {bootstrap?.tenant.slug} · {bootstrap?.tenant.timezone ?? 'America/Sao_Paulo'}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <h2 className="font-serif text-2xl font-normal text-[#072348]">Entrar no Plenário</h2>
              <p className="text-xs text-slate-600 mt-1">
                Informe suas credenciais institucionais para acessar o painel de condução.
              </p>
            </div>

            {/* Formulário Real (LoginForm com 2 passos de TOTP) */}
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <LoginForm variant="default" onLoggedIn={onLoggedIn} />
            </div>

            {/* Perfis Rápidos de Demonstração (Quando demoMode ativo) */}
            {bootstrap?.demoMode && (
              <div className="space-y-2.5 pt-2">
                <div className="flex items-center gap-3">
                  <div className="h-[1px] flex-1 bg-slate-200" />
                  <span className="text-[10px] uppercase font-bold tracking-wider text-slate-700">
                    Acesso Rápido de Demonstração
                  </span>
                  <div className="h-[1px] flex-1 bg-slate-200" />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
                  {(bootstrap?.actors ?? []).slice(0, 4).map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => {
                        setActor(a.id, a)
                        toast.success(`Perfil ativo: ${a.name}`, { description: ROLE_LABEL[a.role] })
                        onLoggedIn({
                          id: a.id,
                          name: a.name,
                          role: a.role,
                          jobTitle: a.jobTitle,
                          parliamentarianId: a.parliamentarianId,
                        })
                      }}
                      className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-white p-2.5 text-left transition hover:border-[#072348] hover:bg-slate-50"
                    >
                      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#072348]/10 text-[10px] font-bold text-[#072348]">
                        {a.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
                      </span>
                      <div className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-bold text-slate-900">{a.name}</span>
                        <span className="block truncate text-[10px] text-slate-700">{ROLE_LABEL[a.role]}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="text-center text-[11px] text-slate-700 pt-2 border-t border-slate-200">
              Adequado à LGPD (Lei nº 13.709/2018) · Sessão criptografada HttpOnly
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
