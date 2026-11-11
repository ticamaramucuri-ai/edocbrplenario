'use client'

import { useState } from 'react'
import { CheckCircle2, Copy, ExternalLink, Loader2, RefreshCw, Send, ShieldAlert, Sparkles } from 'lucide-react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { OnboardingRequestView } from '@/lib/contracts'

const onboardingSchema = z.object({
  chamberName: z
    .string()
    .trim()
    .min(3, 'Nome da Câmara deve ter no mínimo 3 caracteres.')
    .max(80, 'Nome da Câmara deve ter no máximo 80 caracteres.'),
  city: z
    .string()
    .trim()
    .min(2, 'Cidade deve ter no mínimo 2 caracteres.')
    .max(60, 'Cidade deve ter no máximo 60 caracteres.'),
  uf: z
    .string()
    .trim()
    .regex(/^[A-Z]{2}$/, 'Informe a UF com duas letras maiúsculas (ex.: MG, BA, SP).'),
  email: z
    .string()
    .trim()
    .email('E-mail institucional inválido.')
    .max(254, 'E-mail muito longo.'),
  slug: z
    .string()
    .trim()
    .min(3, 'Identificador (slug) deve ter no mínimo 3 caracteres.')
    .max(40, 'Identificador (slug) deve ter no máximo 40 caracteres.')
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      'Use apenas letras minúsculas, números e hífens (ex.: camara-serra-azul).'
    ),
})

function generateSlug(chamberName: string, uf: string): string {
  const normalized = chamberName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  const cleanUf = uf.trim().toLowerCase()
  const base = normalized.startsWith('camara') ? normalized : `camara-${normalized}`
  if (cleanUf && cleanUf.length === 2 && !base.endsWith(`-${cleanUf}`)) {
    return `${base}-${cleanUf}`.slice(0, 40)
  }
  return base.slice(0, 40)
}

export function OnboardingForm() {
  const [chamberName, setChamberName] = useState('')
  const [city, setCity] = useState('')
  const [uf, setUf] = useState('')
  const [email, setEmail] = useState('')
  const [slug, setSlug] = useState('')
  const [slugManual, setSlugManual] = useState(false)
  const [lgpdConsent, setLgpdConsent] = useState(false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successData, setSuccessData] = useState<{ request: OnboardingRequestView; message: string } | null>(null)

  function handleChamberChange(val: string) {
    setChamberName(val)
    if (!slugManual) {
      setSlug(generateSlug(val, uf))
    }
  }

  function handleUfChange(val: string) {
    const clean = val.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2)
    setUf(clean)
    if (!slugManual) {
      setSlug(generateSlug(chamberName, clean))
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!lgpdConsent) {
      setError('É necessário concordar com os termos de tratamento de dados (LGPD) para prosseguir.')
      return
    }

    const payload = {
      chamberName: chamberName.trim(),
      city: city.trim(),
      uf: uf.trim().toUpperCase(),
      email: email.trim().toLowerCase(),
      slug: slug.trim(),
    }

    const parseResult = onboardingSchema.safeParse(payload)
    if (!parseResult.success) {
      const firstError = parseResult.error.issues[0]?.message ?? 'Dados inválidos.'
      setError(firstError)
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/v1/public/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await res.json().catch(() => null)

      if (!res.ok) {
        if (res.status === 429) {
          setError(data?.detail ?? 'Limite de pedidos atingido (máximo 3 por hora por IP). Tente novamente mais tarde.')
        } else if (res.status === 409) {
          setError(data?.detail ?? 'Este identificador (slug) já está em uso por outra Câmara. Escolha outro.')
        } else {
          setError(data?.detail ?? data?.title ?? 'Ocorreu um erro ao enviar a solicitação. Tente novamente.')
        }
        return
      }

      setSuccessData(data)
    } catch {
      setError('Falha de rede ao conectar ao servidor. Verifique a conexão e tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <Alert variant="destructive">
            <ShieldAlert className="size-4" aria-hidden />
            <AlertTitle>Não foi possível enviar</AlertTitle>
            <AlertDescription className="text-xs leading-relaxed">{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="onb-chamber" className="text-xs font-bold text-slate-900">
            Nome Oficial da Câmara Municipal *
          </Label>
          <Input
            id="onb-chamber"
            value={chamberName}
            onChange={(e) => handleChamberChange(e.target.value)}
            placeholder="Ex.: Câmara Municipal de Mucuri"
            required
            className="h-10 text-xs sm:text-sm bg-slate-50 border-slate-300 focus-visible:ring-[#072348]"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="onb-city" className="text-xs font-bold text-slate-900">
              Município *
            </Label>
            <Input
              id="onb-city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Ex.: Mucuri"
              required
              className="h-10 text-xs sm:text-sm bg-slate-50 border-slate-300 focus-visible:ring-[#072348]"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="onb-uf" className="text-xs font-bold text-slate-900">
              UF (2 letras) *
            </Label>
            <Input
              id="onb-uf"
              value={uf}
              onChange={(e) => handleUfChange(e.target.value)}
              placeholder="Ex.: BA"
              maxLength={2}
              required
              className="h-10 text-xs sm:text-sm font-mono uppercase bg-slate-50 border-slate-300 focus-visible:ring-[#072348]"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="onb-email" className="text-xs font-bold text-slate-900">
              E-mail Institucional do Responsável *
            </Label>
            <Input
              id="onb-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="secretaria@camara.leg.br"
              required
              className="h-10 text-xs sm:text-sm bg-slate-50 border-slate-300 focus-visible:ring-[#072348]"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="onb-slug" className="text-xs font-bold text-slate-900">
                Identificador Único (Slug) *
              </Label>
              <button
                type="button"
                onClick={() => setSlugManual(!slugManual)}
                className="text-[10px] text-[#072348] underline font-semibold"
              >
                {slugManual ? 'Gerar auto' : 'Editar'}
              </button>
            </div>
            <Input
              id="onb-slug"
              value={slug}
              onChange={(e) => {
                setSlugManual(true)
                setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
              }}
              placeholder="camara-mucuri-ba"
              required
              className="h-10 text-xs sm:text-sm font-mono text-sky-800 bg-slate-50 border-slate-300 focus-visible:ring-[#072348]"
            />
          </div>
        </div>

        {/* Termo de Consentimento LGPD */}
        <div className="rounded-lg border border-slate-300 border-l-4 border-l-[#072348] bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
          <label className="flex items-start gap-2.5 cursor-pointer font-medium text-slate-900">
            <input
              type="checkbox"
              checked={lgpdConsent}
              onChange={(e) => setLgpdConsent(e.target.checked)}
              className="mt-0.5 size-4 rounded border-slate-300 text-[#072348] focus:ring-[#072348]"
            />
            <span>
              Declaro ciência do tratamento dos dados informados para análise do pedido e contato sobre uma demonstração assistida.
            </span>
          </label>
          <p className="mt-2 text-[11px] text-slate-600 pl-6.5">
            <strong>Aviso de privacidade:</strong> os dados deste formulário são usados para registrar e analisar o pedido e entrar em contato. O envio não ativa automaticamente um ambiente.
          </p>
        </div>

        <Button
          type="submit"
          disabled={loading}
          className="w-full h-11 bg-gradient-to-r from-[#072348] to-[#04152d] text-white font-bold text-sm shadow-md hover:from-[#0d3568] hover:to-[#072348]"
        >
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin mr-2" />
              Processando pedido...
            </>
          ) : (
            <>
              <Send className="size-4 mr-2 text-amber-300" />
              Enviar Pedido de Demonstração →
            </>
          )}
        </Button>
      </form>

      {/* Modal de Sucesso */}
      <Dialog open={!!successData} onOpenChange={() => setSuccessData(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-950">
              <CheckCircle2 className="size-5" /> Pedido Registrado com Sucesso!
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-600 leading-relaxed pt-1">
              {successData?.message}
            </DialogDescription>
          </DialogHeader>

          {successData && (
            <div className="space-y-3 py-2 text-xs">
              <div className="rounded-lg border bg-slate-50 p-3 space-y-1 font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-700">Câmara:</span>
                  <span className="font-bold text-slate-900">{successData.request.chamberName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-700">Município/UF:</span>
                  <span className="font-bold text-slate-900">{successData.request.city}/{successData.request.uf}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-700">Identificador (Slug):</span>
                  <span className="font-bold text-sky-800">{successData.request.slug}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-700">Status na Fila:</span>
                  <span className="font-bold uppercase text-amber-900 bg-amber-100 px-1.5 py-0.5 rounded">
                    {successData.request.status}
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-slate-700 leading-relaxed">
                O pedido aguarda análise. A equipe poderá entrar em contato por <strong>{successData.request.email}</strong> para combinar os próximos passos; nenhuma credencial foi criada neste envio.
              </p>
            </div>
          )}

          <DialogFooter>
            <Button onClick={() => setSuccessData(null)} className="w-full bg-[#072348] text-white">
              Entendido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
