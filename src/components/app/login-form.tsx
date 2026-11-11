'use client'

/**
 * LoginForm (Fase 9 + Onda 5/F22) — login em DOIS passos.
 *
 * Passo 1 (e-mail/senha): POST /api/v1/auth/login. Resposta 401 com
 * `code: MFA_REQUIRED` (MFA ativo, SEM sessão emitida) → avança para o
 * passo 2 com o código TOTP — não é erro, é o fluxo esperado.
 *
 * Passo 2 (InputOTP 6 dígitos): POST /api/v1/auth/login/mfa com
 * { email, password, totp } → cookie httpOnly `legis_session` (7 dias) e
 * `onLoggedIn(body.actor)` no MESMO shape do passo 1. Link "voltar"
 * reexibe o passo 1 (trocar conta). Erros em Alert, como sempre.
 */
import { useState } from 'react'
import { AlertCircle, ArrowLeft, Eye, EyeOff, Loader2, LogIn, ShieldCheck } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp'
import { cn } from '@/lib/utils'

export type LoggedInActor = {
  id: string
  name: string
  role: string
  jobTitle?: string | null
  parliamentarianId?: string | null
}

type LoginProblem = { code?: string; title?: string; detail?: string }

export default function LoginForm({
  onLoggedIn,
  variant = 'default',
}: {
  onLoggedIn: (actor: LoggedInActor) => void
  variant?: 'default' | 'dialog-dark'
}) {
  const [step, setStep] = useState<'credentials' | 'totp'>('credentials')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [totp, setTotp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<{ title: string; detail: string } | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (loading) return
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
        credentials: 'same-origin',
      })
      const body: { actor?: LoggedInActor; title?: string; detail?: string; code?: string } | null =
        await res.json().catch(() => null)

      // F22 — senha correta, mas o segundo fator é exigido: avança para o
      // passo 2 SEM mensagem de erro (nenhuma sessão foi criada).
      if (res.status === 401 && body?.code === 'MFA_REQUIRED') {
        setTotp('')
        setStep('totp')
        return
      }
      if (!res.ok || !body?.actor) {
        setError({
          title: body?.title ?? 'Falha no login',
          detail: body?.detail ?? 'Não foi possível autenticar. Tente novamente.',
        })
        return
      }
      onLoggedIn(body.actor)
    } catch {
      setError({ title: 'Erro de rede', detail: 'Não foi possível conectar ao servidor.' })
    } finally {
      setLoading(false)
    }
  }

  async function handleTotp(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (loading || totp.length !== 6) return
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/v1/auth/login/mfa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password, totp }),
        credentials: 'same-origin',
      })
      const body: { actor?: LoggedInActor; title?: string; detail?: string; code?: string } | null =
        await res.json().catch(() => null)
      if (!res.ok || !body?.actor) {
        const problem = (body ?? {}) as LoginProblem
        setError({
          title: problem.title ?? 'Código inválido',
          detail:
            problem.detail ??
            'Não foi possível confirmar o código TOTP. Verifique o gerador e tente novamente.',
        })
        return
      }
      onLoggedIn(body.actor)
    } catch {
      setError({ title: 'Erro de rede', detail: 'Não foi possível conectar ao servidor.' })
    } finally {
      setLoading(false)
    }
  }

  const canSubmit = email.trim().length > 3 && email.includes('@') && password.length >= 8

  if (step === 'totp') {
    return (
      <form onSubmit={handleTotp} className="space-y-3" noValidate>
        {error && (
          <Alert variant="destructive" role="alert">
            <AlertCircle aria-hidden />
            <AlertTitle>{error.title}</AlertTitle>
            <AlertDescription>{error.detail}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="login-totp">Código de 6 dígitos</Label>
          <p className="text-xs text-muted-foreground">
            Abra o aplicativo autenticador (ex.: Google Authenticator) registrado para{' '}
            <strong className="text-foreground">{email.trim()}</strong> e digite o código atual.
          </p>
          <div className="pt-1">
            <InputOTP
              id="login-totp"
              maxLength={6}
              value={totp}
              onChange={setTotp}
              autoFocus
              disabled={loading}
              aria-label="Código TOTP de 6 dígitos"
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
          </div>
        </div>

        <Button type="submit" className="w-full" disabled={loading || totp.length !== 6}>
          {loading ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
          Verificar e entrar
        </Button>

        <button
          type="button"
          className="flex w-full items-center justify-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          onClick={() => {
            setStep('credentials')
            setTotp('')
            setError(null)
          }}
        >
          <ArrowLeft className="size-3" aria-hidden /> voltar para o e-mail e senha
        </button>
      </form>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3" noValidate>
      {error && (
        <Alert variant="destructive" role="alert">
          <AlertCircle aria-hidden />
          <AlertTitle>{error.title}</AlertTitle>
          <AlertDescription>{error.detail}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="login-email" className={cn(variant === 'dialog-dark' ? "text-xs font-bold text-slate-200" : "text-xs font-bold text-slate-800")}>
          E-mail
        </Label>
        <Input
          id="login-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="nome@camara.leg.br"
          autoComplete="email"
          autoFocus
          disabled={loading}
          className={cn(variant === 'dialog-dark' && "bg-slate-950/80 border-slate-700 text-white placeholder:text-slate-500 focus-visible:ring-amber-400 focus-visible:border-amber-400")}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="login-password" className={cn(variant === 'dialog-dark' ? "text-xs font-bold text-slate-200" : "text-xs font-bold text-slate-800")}>
          Senha
        </Label>
        <div className="relative">
          <Input
            id="login-password"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className={cn("pr-10", variant === 'dialog-dark' && "bg-slate-950/80 border-slate-700 text-white placeholder:text-slate-500 focus-visible:ring-amber-400 focus-visible:border-amber-400")}
            autoComplete="current-password"
            minLength={8}
            disabled={loading}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-0 top-0 size-9 text-muted-foreground"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? 'Ocultar senha' : 'Exibir senha'}
            tabIndex={-1}
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </Button>
        </div>
      </div>

      <Button
        type="submit"
        className={cn(
          "w-full",
          variant === 'dialog-dark'
            ? "bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-bold uppercase tracking-wider text-xs shadow-md shadow-amber-500/20 py-2.5"
            : "bg-[#072348] hover:bg-[#0a2f5e] text-white font-semibold py-2.5 shadow-sm"
        )}
        disabled={loading || !canSubmit}
      >
        {loading ? <Loader2 className="animate-spin" /> : <LogIn />}
        Entrar
      </Button>

      <p className={cn("text-center text-xs", variant === 'dialog-dark' ? "text-slate-400" : "text-slate-600")}>
        Acesso restrito a vereadores, mesa diretora e corpo técnico autorizado.
      </p>
    </form>
  )
}
