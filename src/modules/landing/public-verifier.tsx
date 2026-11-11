'use client'

import { useState } from 'react'
import { CheckCircle2, Loader2, Search, ShieldAlert, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { PublicVerifyResult } from '@/lib/contracts'

export function PublicVerifier() {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<PublicVerifyResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    const cleanCode = code.trim().toUpperCase()
    if (!cleanCode) return

    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const res = await fetch(`/api/v1/public/verify?code=${encodeURIComponent(cleanCode)}`)
      const data = await res.json().catch(() => null)

      if (!res.ok) {
        setError(data?.detail ?? data?.title ?? 'Falha ao consultar autenticidade do documento.')
        return
      }

      setResult(data as PublicVerifyResult)
    } catch {
      setError('Erro de conexão com o serviço de verificação pública.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleVerify} className="space-y-3">
        <div className="flex gap-2">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            aria-label="Código de verificação da publicação"
            placeholder="Código de verificação da publicação"
            className="h-10 text-xs sm:text-sm font-mono uppercase bg-slate-950/80 border-slate-700 text-amber-300 placeholder:text-slate-500 focus-visible:ring-amber-400"
            required
          />
          <Button
            type="submit"
            disabled={loading}
            className="h-10 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-4 shrink-0"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            <span className="hidden sm:inline ml-1.5">Verificar</span>
          </Button>
        </div>
      </form>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-950/40 p-3 text-xs text-rose-300 flex items-start gap-2">
          <ShieldAlert className="size-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-amber-500/30 bg-slate-950/90 p-3.5 text-xs font-mono space-y-2">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <span className="text-slate-400">STATUS DA CONSULTA</span>
            {result.found && result.status === 'valida' ? (
              <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/40">
                <CheckCircle2 className="size-3" /> VÁLIDO E ÍNTEGRO
              </span>
            ) : result.found && result.status === 'revogada' ? (
              <span className="inline-flex items-center gap-1 rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-400 border border-amber-500/40">
                REVOGADO POSTERIORMENTE
              </span>
            ) : result.found ? (
              <span className="inline-flex items-center gap-1 rounded bg-rose-500/20 px-2 py-0.5 text-[10px] font-bold text-rose-400 border border-rose-500/40">
                <XCircle className="size-3" /> INTEGRIDADE NÃO CONFIRMADA
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded bg-rose-500/20 px-2 py-0.5 text-[10px] font-bold text-rose-400 border border-rose-500/40">
                <XCircle className="size-3" /> NÃO LOCALIZADO
              </span>
            )}
          </div>

          {result.found ? (
            <div className="space-y-1 text-slate-300 text-[11px] leading-relaxed">
              <div>
                <span className="text-slate-400">Câmara Emissora:</span>{' '}
                <span className="text-white font-semibold">{result.tenantName ?? 'Câmara Municipal'}</span>
              </div>
              <div>
                <span className="text-slate-400">Documento:</span>{' '}
                <span className="text-amber-200">{result.title ?? 'Publicação Oficial'}</span>
              </div>
              <div>
                <span className="text-slate-400">Código Localizado:</span>{' '}
                <span className="text-white">{result.code}</span>
              </div>
              {result.publishedAt && (
                <div>
                  <span className="text-slate-400">Publicação Oficial:</span>{' '}
                  <span className="text-slate-300">{new Date(result.publishedAt).toLocaleString('pt-BR')}</span>
                </div>
              )}
              {result.status === 'valida' && (
                <div className="pt-1 border-t border-slate-800/80 text-[10px] text-emerald-400/90">
                  ✓ Integridade do conteúdo publicado conferida na base do Diário Eletrônico.
                </div>
              )}
            </div>
          ) : (
            <div className="text-[11px] text-slate-400 leading-relaxed">
              O código informado <code className="text-amber-300">{result.code}</code> não corresponde a uma publicação encontrada no Diário Eletrônico. Rascunhos em tramitação não recebem código público de verificação.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
