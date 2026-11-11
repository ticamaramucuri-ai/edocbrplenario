'use client'

import Link from 'next/link'
import Image from 'next/image'
import { ArrowUpRight, ExternalLink, Landmark, Lock, ShieldCheck, Sparkles, X } from 'lucide-react'

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import LoginForm, { type LoggedInActor } from '@/components/app/login-form'
import { useApp } from '@/lib/store'
import { ROLE_LABEL } from '@/lib/contracts'
import { toast } from 'sonner'

interface InstitutionalLoginDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onLoggedIn: (actor: LoggedInActor) => void
}

export function InstitutionalLoginDialog({
  open,
  onOpenChange,
  onLoggedIn,
}: InstitutionalLoginDialogProps) {
  const bootstrap = useApp((s) => s.bootstrap)
  const setActor = useApp((s) => s.setActor)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-lg p-0 overflow-hidden border border-white/20 bg-[#020b18] text-white shadow-2xl rounded-2xl gap-0"
        onEscapeKeyDown={() => onOpenChange(false)}
        onPointerDownOutside={() => onOpenChange(false)}
      >
        {/* TOPO: BANNER DO COFRE INSTITUCIONAL */}
        <div className="relative bg-gradient-to-br from-[#020b18] via-[#051833] to-[#08264e] p-6 pb-5 border-b border-white/10 text-white overflow-hidden">
          {/* Malha de fundo */}
          <div
            className="absolute inset-0 opacity-10 pointer-events-none"
            style={{
              backgroundImage:
                'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
              backgroundSize: '32px 32px',
            }}
          />

          <DialogHeader className="relative z-10 space-y-2 text-left">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Image
                  src="/brand/edocbr-logo-white.svg"
                  alt="e-docBR"
                  width={110}
                  height={28}
                  className="h-6 w-auto object-contain"
                />
                <span className="h-4 w-[1px] bg-white/20" />
                <span className="text-[10px] font-extrabold tracking-[0.16em] text-amber-400">
                  PLENÁRIO
                </span>
              </div>

              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-mono font-bold text-emerald-300">
                <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]" />
                SESSÃO SEGURA
              </span>
            </div>

            <DialogTitle className="font-serif text-xl sm:text-2xl font-normal text-white pt-2">
              Entrar no Plenário
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-300 leading-relaxed">
              Informe suas credenciais institucionais para acessar o painel de condução.
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* CORPO DO CONSOLE */}
        <div className="p-6 space-y-5 bg-[#031329]/95 text-slate-200">
          {/* Seletor do Tenant / Câmara Ativa */}
          <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 p-3 backdrop-blur-sm">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30">
                <Landmark className="size-4" />
              </div>
              <div className="min-w-0">
                <strong className="block truncate text-xs font-bold text-white">
                  {bootstrap?.tenant.name ?? 'Câmara Municipal'}
                </strong>
                <span className="block truncate font-mono text-[10px] text-slate-400">
                  {bootstrap?.tenant.slug} · {bootstrap?.tenant.timezone ?? 'America/Sao_Paulo'}
                </span>
              </div>
            </div>
            <Link
              href="/login"
              className="text-[11px] text-amber-400 hover:text-amber-300 flex items-center gap-1 font-semibold hover:underline"
            >
              Tela cheia
              <ArrowUpRight className="size-3" />
            </Link>
          </div>

          {/* Formulário Real */}
          <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4">
            <LoginForm variant="dialog-dark" onLoggedIn={onLoggedIn} />
          </div>

          {/* Perfis Rápidos de Demonstração (Quando demoMode ativo) */}
          {bootstrap?.demoMode && (
            <div className="space-y-2.5 pt-1">
              <div className="flex items-center gap-3">
                <Separator className="flex-1 bg-white/10" />
                <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                  ou perfis de demonstração
                </span>
                <Separator className="flex-1 bg-white/10" />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
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
                      onOpenChange(false)
                    }}
                    className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/5 p-2.5 text-left transition hover:border-amber-400/60 hover:bg-white/10"
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-[10px] font-bold text-amber-300 border border-amber-500/30">
                      {a.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-bold text-white">{a.name}</span>
                      <span className="block truncate text-[10px] text-slate-400">{ROLE_LABEL[a.role]}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Rodapé da Modal */}
          <div className="pt-2 border-t border-white/10 flex items-center justify-between text-[11px] text-slate-400">
            <span>Adequado à LGPD (Lei 13.709/2018)</span>
            <span className="font-mono text-[10px] text-amber-300/80">Sessão HttpOnly</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

