'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Clock,
  Cpu,
  Database,
  ExternalLink,
  FileCheck2,
  FileText,
  Globe,
  HelpCircle,
  Landmark,
  Lock,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Tv,
  Users,
  Vote,
  Wifi,
  WifiOff,
} from 'lucide-react'

import { BrandLogo } from '@/components/brand/brand-logo'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { OnboardingForm } from './onboarding-form'
import { PublicVerifier } from './public-verifier'

interface LandingViewProps {
  onOpenLoginModal?: () => void
}

export function LandingView({ onOpenLoginModal }: LandingViewProps) {
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  const toggleFaq = (index: number) => {
    setOpenFaq(openFaq === index ? null : index)
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 selection:bg-amber-400 selection:text-slate-950 font-sans">
      {/* ═══════════════════════════════════════════════════════════════════════
          TOPO: BARRA DE TELEMETRIA INSTITUCIONAL
          ═══════════════════════════════════════════════════════════════════════ */}
      <div className="bg-[#020b18] border-b border-white/10 text-xs text-slate-300 py-1.5 px-4 sm:px-8">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3 text-[11px] sm:text-xs">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="flex items-center gap-1.5 font-medium text-emerald-400">
              <span className="size-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]" />
              Rede Deliberativa Operacional
            </span>
            <span className="hidden md:inline text-white/30">•</span>
            <span className="hidden md:inline text-slate-400">
              Protocolo de Sessão v0.14 · ADR-027 / ADR-030
            </span>
            <span className="hidden lg:inline text-white/30">•</span>
            <span className="hidden lg:inline text-slate-400">
              SLA 99.98% · Criptografia SHA-256
            </span>
          </div>
          <div className="flex items-center gap-4 text-slate-400">
            <span className="flex items-center gap-1 text-slate-300">
              <ShieldCheck className="size-3.5 text-amber-400" />
              Conforme LGPD & LAI
            </span>
            <span className="text-white/30">•</span>
            <a
              href="#verificador"
              className="text-amber-400 hover:text-amber-300 underline-offset-2 hover:underline transition-colors font-medium"
            >
              Consultar Validade
            </a>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          NAVBAR PRINCIPAL INSTITUCIONAL
          ═══════════════════════════════════════════════════════════════════════ */}
      <header className="sticky top-0 z-50 bg-[#04152d]/95 backdrop-blur-md border-b border-white/10 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 h-18 flex items-center justify-between gap-4">
          {/* Logo & Marca */}
          <Link href="/" className="flex items-center gap-3 shrink-0 group">
            <Image
              src="/brand/edocbr-logo-white.svg"
              alt="e-docBR"
              width={124}
              height={32}
              className="h-8 w-auto object-contain transition-transform group-hover:scale-105"
              priority
            />
            <span className="h-5 w-[1px] bg-white/20" />
            <div className="flex flex-col">
              <span className="text-xs font-extrabold tracking-[0.16em] text-amber-400">
                PLENÁRIO
              </span>
              <span className="text-[9px] uppercase tracking-wider text-slate-400">
                Câmaras Municipais
              </span>
            </div>
          </Link>

          {/* Links de Navegação */}
          <nav className="hidden lg:flex items-center gap-6 text-xs uppercase tracking-wider font-semibold text-slate-300">
            <a href="#hero" className="hover:text-amber-400 transition-colors">
              Início
            </a>
            <a href="#modulos" className="hover:text-amber-400 transition-colors">
              Módulos
            </a>
            <a href="#arquitetura" className="hover:text-amber-400 transition-colors">
              Resiliência LAN
            </a>
            <a href="#transparencia" className="hover:text-amber-400 transition-colors">
              Transparência
            </a>
            <a href="#lgpd" className="hover:text-amber-400 transition-colors">
              LGPD & Segurança
            </a>
            <a href="#onboarding" className="hover:text-amber-400 transition-colors">
              Auto-Onboarding
            </a>
            <a href="#faq" className="hover:text-amber-400 transition-colors">
              FAQ
            </a>
          </nav>

          {/* Ações Direitas */}
          <div className="flex items-center gap-3">
            <a
              href="#verificador"
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/20 text-xs font-medium text-slate-200 hover:bg-white/10 transition-colors"
            >
              <Search className="size-3.5 text-amber-400" />
              Verificar Ata
            </a>

            {onOpenLoginModal ? (
              <Button
                onClick={onOpenLoginModal}
                className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs uppercase tracking-wider shadow-lg shadow-amber-500/20"
              >
                <Lock className="size-3.5 mr-1" />
                Área Restrita
              </Button>
            ) : (
              <Link
                href="/login"
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs uppercase tracking-wider shadow-lg shadow-amber-500/20 transition-all hover:scale-[1.02]"
              >
                <Lock className="size-3.5" />
                Área Restrita
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* ═══════════════════════════════════════════════════════════════════════
          SEÇÃO 1: DARK ARCHITECTURAL HERO & COCKPIT MULTI-CAMADA
          ═══════════════════════════════════════════════════════════════════════ */}
      <section
        id="hero"
        className="relative bg-gradient-to-b from-[#020b18] via-[#051936] to-[#072247] text-white pt-12 pb-20 px-4 sm:px-8 overflow-hidden border-b border-white/10"
      >
        {/* Glows e Grid Architectural */}
        <div
          className="absolute inset-0 opacity-15 pointer-events-none"
          style={{
            backgroundImage:
              'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
            backgroundSize: '48px 48px',
            maskImage: 'radial-gradient(circle at 50% 30%, black 40%, transparent 80%)',
          }}
        />
        <div className="absolute top-1/4 right-1/4 -translate-y-1/2 w-[500px] h-[500px] bg-amber-500/10 rounded-full blur-[140px] pointer-events-none" />
        <div className="absolute bottom-10 left-10 w-[450px] h-[450px] bg-emerald-500/10 rounded-full blur-[120px] pointer-events-none" />

        <div className="max-w-7xl mx-auto relative z-10 space-y-12">
          {/* Headline and Narrative */}
          <div className="text-center max-w-4xl mx-auto space-y-6">
            {/* 5-Act Journey Pill */}
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 border border-white/15 text-xs text-slate-200 backdrop-blur-sm">
              <Sparkles className="size-3.5 text-amber-400" />
              <span className="font-semibold text-white">Jornada em 5 Atos:</span>
              <span className="text-slate-300">
                1. Pauta → 2. Quorum → 3. Deliberação → 4. Apuração → 5. Publicação
              </span>
            </div>

            <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.15]">
              A Nova Era da Governança e Deliberação{' '}
              <span className="bg-gradient-to-r from-amber-300 via-amber-400 to-amber-200 bg-clip-text text-transparent">
                Legislativa Municipal
              </span>
            </h1>

            <p className="text-base sm:text-lg text-slate-300 max-w-3xl mx-auto font-normal leading-relaxed">
              Plenário eletrônico com votação nominal biométrica/MFA, painel de transmissão em alta definição,
              transparência ativa imediata e trilha de auditoria imutável. Arquitetura LAN resiliente com zero dependência de nuvem para sessões sem interrupção.
            </p>

            {/* CTAs Principais */}
            <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
              <a
                href="#onboarding"
                className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-extrabold text-sm shadow-xl shadow-amber-500/20 transition-all hover:scale-105"
              >
                <Landmark className="size-4" />
                Criar Espaço da Câmara (Auto-Onboarding)
                <ArrowRight className="size-4" />
              </a>

              <a
                href="#modulos"
                className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/20 text-white font-semibold text-sm backdrop-blur-sm transition-all"
              >
                Conhecer os 6 Módulos
              </a>

              <a
                href="#verificador"
                className="inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl border border-emerald-500/30 bg-emerald-950/30 hover:bg-emerald-900/40 text-emerald-300 font-semibold text-sm transition-all"
              >
                <ShieldCheck className="size-4 text-emerald-400" />
                Verificador Criptográfico
              </a>
            </div>

            {/* Selos de Conformidade e Normas */}
            <div className="pt-4 flex flex-wrap items-center justify-center gap-6 text-xs text-slate-400">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="size-4 text-emerald-400" />
                <span>Lei 13.709/2018 (LGPD)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="size-4 text-emerald-400" />
                <span>Lei 12.527/2011 (LAI)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="size-4 text-emerald-400" />
                <span>ICP-Brasil & SHA-256</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="size-4 text-emerald-400" />
                <span>ADR-027 / ADR-030 Resiliente</span>
              </div>
            </div>
          </div>

          {/* ═══════════════════════════════════════════════════════════════════
              COCKPIT OPERACIONAL AO VIVO (DEMONSTRADOR EM TEMPO REAL)
              ═══════════════════════════════════════════════════════════════════ */}
          <div className="rounded-2xl border border-white/20 bg-slate-900/90 shadow-2xl backdrop-blur-xl overflow-hidden max-w-6xl mx-auto">
            {/* Barra do Cockpit */}
            <div className="bg-[#031329] border-b border-white/10 px-5 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-3">
                <span className="flex size-2 rounded-full bg-emerald-400 animate-ping" />
                <span className="font-extrabold uppercase tracking-wider text-amber-400">
                  42ª Sessão Ordinária · 2026
                </span>
                <span className="text-white/30">|</span>
                <span className="text-slate-300 font-medium">
                  Câmara Municipal de Exemplo (Demonstração Interativa)
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30 text-[11px] flex items-center gap-1">
                  <Activity className="size-3" />
                  EM DELIBERAÇÃO
                </span>
                <span className="px-2.5 py-0.5 rounded-full bg-red-500/20 text-red-400 font-bold border border-red-500/30 text-[11px] flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-red-400 animate-pulse" />
                  TRANSMISSÃO AO VIVO
                </span>
              </div>
            </div>

            {/* Grid 3 Colunas do Cockpit */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-white/10">
              {/* Coluna 1: Quorum & Mesa Diretora (3 colunas) */}
              <div className="lg:col-span-3 p-5 space-y-4 bg-slate-950/40">
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">
                    Quorum Regimental
                  </span>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-3xl font-extrabold text-white">11</span>
                    <span className="text-sm text-slate-400 font-medium">/ 11 Presentes</span>
                    <Badge variant="outline" className="ml-auto bg-emerald-500/10 text-emerald-400 border-emerald-500/30 font-bold">
                      100%
                    </Badge>
                  </div>
                  <div className="mt-2 w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                    <div className="bg-emerald-400 h-full w-full" />
                  </div>
                </div>

                <Separator className="bg-white/10" />

                <div className="space-y-2 text-xs">
                  <div className="flex justify-between text-slate-300">
                    <span className="text-slate-400">Modo de Votação:</span>
                    <span className="font-semibold text-white">Nominal Aberta</span>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span className="text-slate-400">Maioria Requerida:</span>
                    <span className="font-semibold text-amber-400">Maioria Absoluta (6)</span>
                  </div>
                  <div className="flex justify-between text-slate-300">
                    <span className="text-slate-400">Presidente da Mesa:</span>
                    <span className="font-semibold text-white">Ver. Carlos Mendes</span>
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-white/5 border border-white/10 text-[11px] text-slate-300 space-y-1">
                  <div className="flex items-center gap-1.5 text-amber-400 font-bold">
                    <Wifi className="size-3.5" />
                    Sessão em Rede LAN Isolada
                  </div>
                  <p className="text-slate-400">
                    Sincronização em alta velocidade (latência &lt; 4ms) com tolerância total a corte de WAN.
                  </p>
                </div>
              </div>

              {/* Coluna 2: Proposição em Pauta & Cronômetro (5 colunas) */}
              <div className="lg:col-span-5 p-5 space-y-4 bg-slate-900/60">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-amber-400 font-extrabold">
                    Item 03 da Ordem do Dia
                  </span>
                  <span className="text-xs text-slate-400 font-mono">PL 018/2026</span>
                </div>

                <div>
                  <h3 className="text-base sm:text-lg font-bold text-white leading-snug">
                    Projeto de Lei nº 018/2026 — Institui o Programa de Governança Digital, Plenário Eletrônico e Transparência Aberta no Município
                  </h3>
                  <p className="mt-1.5 text-xs text-slate-300">
                    Autor: Mesa Diretora · Relator: Ver. Carlos Mendes (Comissão de Legislação e Justiça com parecer favorável unânime).
                  </p>
                </div>

                {/* Cronômetro Regimental */}
                <div className="p-4 rounded-xl bg-[#031329] border border-amber-500/30 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="size-10 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
                      <Clock className="size-5" />
                    </div>
                    <div>
                      <span className="block text-[10px] uppercase tracking-wider text-slate-400 font-bold">
                        Tempo de Votação
                      </span>
                      <span className="text-2xl font-extrabold font-mono text-amber-400">
                        00:45
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="inline-block px-2.5 py-1 rounded-md bg-emerald-500/20 text-emerald-400 text-xs font-bold border border-emerald-500/30">
                      VOTAÇÃO ABERTA
                    </span>
                    <span className="block text-[10px] text-slate-400 mt-1">Bancada liberada</span>
                  </div>
                </div>
              </div>

              {/* Coluna 3: Apuração Nominal em Tempo Real (4 colunas) */}
              <div className="lg:col-span-4 p-5 space-y-4 bg-slate-950/40">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">
                    Painel de Votos (9 de 11)
                  </span>
                  <span className="text-xs text-emerald-400 font-bold">Aprovado Previsto</span>
                </div>

                {/* Grid 3x3 dos 9 Vereadores */}
                <div className="grid grid-cols-3 gap-2">
                  {[
                    'Carlos Mendes',
                    'Mariana Souza',
                    'Roberto Dias',
                    'Fernanda Lima',
                    'João Paulo',
                    'Ana Beatriz',
                    'Lucas Rocha',
                    'Patrícia Ramos',
                    'Ricardo Alves',
                  ].map((nome, i) => (
                    <div
                      key={nome}
                      className="p-2 rounded-lg bg-emerald-950/40 border border-emerald-500/30 flex flex-col items-center text-center transition-all hover:scale-105"
                    >
                      <div className="size-7 rounded-full bg-emerald-500/20 text-emerald-300 font-bold text-[11px] flex items-center justify-center border border-emerald-500/40">
                        {nome.split(' ').map((n) => n[0]).join('')}
                      </div>
                      <span className="text-[10px] font-semibold text-white mt-1 truncate w-full">
                        {nome.split(' ')[0]}
                      </span>
                      <span className="text-[9px] font-extrabold text-emerald-400 uppercase tracking-wider">
                        SIM
                      </span>
                    </div>
                  ))}
                </div>

                {/* Barra de Placar */}
                <div className="space-y-1.5 pt-1">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-emerald-400">9 SIM (100%)</span>
                    <span className="text-slate-400">0 NÃO · 0 ABST.</span>
                  </div>
                  <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden flex">
                    <div className="bg-emerald-500 h-full w-[100%]" />
                  </div>
                </div>

                {/* Assinatura Criptográfica do Evento */}
                <div className="pt-1 border-t border-white/10 flex items-center justify-between text-[10px] text-slate-400 font-mono">
                  <span className="flex items-center gap-1 text-slate-400">
                    <Lock className="size-3 text-amber-400" />
                    ADR-027 Hash:
                  </span>
                  <span className="text-amber-300/80 truncate max-w-[150px]">
                    sha256:7f9c2e...b3a1
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════
          SEÇÃO 2: ECOSSISTEMA COMPLETO EM 6 MÓDULOS (BENTO GRID)
          ═══════════════════════════════════════════════════════════════════════ */}
      <section id="modulos" className="py-24 px-4 sm:px-8 max-w-7xl mx-auto space-y-16">
        <div className="text-center max-w-3xl mx-auto space-y-4">
          <Badge className="bg-amber-100 text-amber-900 border-amber-300 font-bold px-3 py-1">
            Módulos Integrados
          </Badge>
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
            A Arquitetura Completa do Plenário Digital Moderno
          </h2>
          <p className="text-slate-600 text-base leading-relaxed">
            Seis pilares desenhados sob medida para o rito regimental das Câmaras Municipais brasileiras,
            unindo velocidade operacional, segurança jurídica e transparência para os cidadãos.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {/* Módulo 1 */}
          <Card className="border-slate-200 hover:border-amber-400/80 shadow-md hover:shadow-xl transition-all duration-300 flex flex-col justify-between group">
            <CardHeader className="space-y-3">
              <div className="size-12 rounded-xl bg-amber-500/10 text-amber-700 flex items-center justify-center group-hover:scale-110 transition-transform">
                <Landmark className="size-6" />
              </div>
              <CardTitle className="text-xl font-bold text-slate-900">
                1. Plenário Digital & Mesa Diretora
              </CardTitle>
              <CardDescription className="text-slate-600 leading-relaxed">
                Controle integral da sessão legislativa: abertura, pauta dinâmica, chamada nominal com verificação biométrica e quorum automático por maioria simples, qualificada ou absoluta.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <Separator />
              <ul className="text-xs text-slate-600 space-y-2">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                  Painel de condução em tempo real com cronômetro de tribuna
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                  Abertura e encerramento de votações nominais com 1 clique
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                  Geração automática de ata sucinta e detalhada com hash
                </li>
              </ul>
            </CardContent>
          </Card>

          {/* Módulo 2 */}
          <Card className="border-slate-200 hover:border-amber-400/80 shadow-md hover:shadow-xl transition-all duration-300 flex flex-col justify-between group">
            <CardHeader className="space-y-3">
              <div className="size-12 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                <Vote className="size-6" />
              </div>
              <CardTitle className="text-xl font-bold text-slate-900">
                2. PWA Parlamentar de Votação
              </CardTitle>
              <CardDescription className="text-slate-600 leading-relaxed">
                Terminal deliberativo responsivo instalado em tablets, notebooks ou smartphones de vereadores. Votação segura com confirmação em duas etapas e integridade garantida.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <Separator />
              <ul className="text-xs text-slate-600 space-y-2">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                  Autenticação MFA com TOTP ou credencial biométrica
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                  Acesso instantâneo a pareceres, emendas e substitutivos
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                  Inscrição de oradores e pedidos de questão de ordem
                </li>
              </ul>
            </CardContent>
          </Card>

          {/* Módulo 3 */}
          <Card className="border-slate-200 hover:border-amber-400/80 shadow-md hover:shadow-xl transition-all duration-300 flex flex-col justify-between group">
            <CardHeader className="space-y-3">
              <div className="size-12 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                <Tv className="size-6" />
              </div>
              <CardTitle className="text-xl font-bold text-slate-900">
                3. Painel de Plenário / TV Cast
              </CardTitle>
              <CardDescription className="text-slate-600 leading-relaxed">
                Transmissão visual em alta resolução para os telões do plenário físico e streaming oficial. Exibição imediata da matéria, orador ativo e apuração visual em tempo real.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <Separator />
              <ul className="text-xs text-slate-600 space-y-2">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                  Layout adaptativo para TVs 4K, projetores e telões LED
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                  Sincronização instantânea com WebSocket de baixa latência
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                  Overlay e identidade visual personalizada para cada Câmara
                </li>
              </ul>
            </CardContent>
          </Card>

          {/* Módulo 4 */}
          <Card className="border-slate-200 hover:border-amber-400/80 shadow-md hover:shadow-xl transition-all duration-300 flex flex-col justify-between group">
            <CardHeader className="space-y-3">
              <div className="size-12 rounded-xl bg-purple-500/10 text-purple-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                <FileText className="size-6" />
              </div>
              <CardTitle className="text-xl font-bold text-slate-900">
                4. Gestão de Matérias & Protocolo
              </CardTitle>
              <CardDescription className="text-slate-600 leading-relaxed">
                Controle estruturado de Projetos de Lei, Requerimentos, Moções e Decretos. Protocolo eletrônico sequencial com carimbo do tempo e versionamento de proposições.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <Separator />
              <ul className="text-xs text-slate-600 space-y-2">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                  Tramitação por comissões com anexos e pareceres em PDF
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                  Relação de autoria e histórico completo de despachos
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                  Exportação no padrão exigido pelos Tribunais de Contas
                </li>
              </ul>
            </CardContent>
          </Card>

          {/* Módulo 5 */}
          <Card className="border-slate-200 hover:border-amber-400/80 shadow-md hover:shadow-xl transition-all duration-300 flex flex-col justify-between group">
            <CardHeader className="space-y-3">
              <div className="size-12 rounded-xl bg-cyan-500/10 text-cyan-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                <Globe className="size-6" />
              </div>
              <CardTitle className="text-xl font-bold text-slate-900">
                5. Portal de Transparência & Cidadão
              </CardTitle>
              <CardDescription className="text-slate-600 leading-relaxed">
                Acesso universal e sem barreiras para a população. Consulta a matérias, votos nominais de cada vereador, replay de sessões e atas autenticadas em cumprimento à LAI.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <Separator />
              <ul className="text-xs text-slate-600 space-y-2">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                  Publicação em tempo real sem atrasos de processamento
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                  Pesquisa por texto livre, autor, data e resultado
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                  Design acessível (WCAG 2.1 AA) para todos os cidadãos
                </li>
              </ul>
            </CardContent>
          </Card>

          {/* Módulo 6 */}
          <Card className="border-slate-200 hover:border-amber-400/80 shadow-md hover:shadow-xl transition-all duration-300 flex flex-col justify-between group">
            <CardHeader className="space-y-3">
              <div className="size-12 rounded-xl bg-rose-500/10 text-rose-600 flex items-center justify-center group-hover:scale-110 transition-transform">
                <ShieldCheck className="size-6" />
              </div>
              <CardTitle className="text-xl font-bold text-slate-900">
                6. Auditoria Criptográfica & Trilha
              </CardTitle>
              <CardDescription className="text-slate-600 leading-relaxed">
                Cadeia de custódia imutável (ADR-027). Cada voto, chamada e despacho gera um hash criptográfico sequencial impossível de adulterar ou retroagir, assegurando fé pública.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <Separator />
              <ul className="text-xs text-slate-600 space-y-2">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                  Encadeamento SHA-256 com carimbo de tempo inviolável
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                  Verificador público aberto para qualquer auditor ou cidadão
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                  Exportação de dossiê probatório para o Ministério Público
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════
          SEÇÃO 3: ARQUITETURA DE RESILIÊNCIA LAN (ADR-027 / ADR-030)
          ═══════════════════════════════════════════════════════════════════════ */}
      <section
        id="arquitetura"
        className="py-24 px-4 sm:px-8 bg-gradient-to-b from-[#020b18] via-[#04152d] to-[#072348] text-white border-y border-white/10"
      >
        <div className="max-w-7xl mx-auto space-y-16">
          <div className="text-center max-w-3xl mx-auto space-y-4">
            <Badge className="bg-amber-400/20 text-amber-300 border-amber-400/40 font-bold px-3 py-1">
              Prontidão & Resiliência LAN
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
              Zero Interrupção em Sessões: Funciona com ou sem Internet
            </h2>
            <p className="text-slate-300 text-base leading-relaxed">
              Muitos sistemas legislativos travam quando a conexão de internet da Câmara oscila.
              O edocBR Plenário foi desenhado sob as especificações <strong>ADR-027 e ADR-030</strong>: um modelo híbrido com operação local na rede LAN e sincronização automática em nuvem.
            </p>
          </div>

          {/* Blueprint Visual dos 4 Nós */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="p-6 rounded-2xl bg-white/5 border border-white/10 space-y-4 relative overflow-hidden">
              <div className="size-10 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
                <Server className="size-5" />
              </div>
              <h3 className="text-lg font-bold text-white">1. Edge Appliance na Mesa</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Mini-servidor local dedicado na Mesa Diretora rodando SQLite WAL com sincronização transacional local ultraveloz.
              </p>
              <div className="text-[11px] font-mono text-amber-400/90 pt-2 border-t border-white/10">
                Latência local &lt; 3ms
              </div>
            </div>

            <div className="p-6 rounded-2xl bg-white/5 border border-white/10 space-y-4 relative overflow-hidden">
              <div className="size-10 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                <Wifi className="size-5" />
              </div>
              <h3 className="text-lg font-bold text-white">2. Gateway WebSocket LAN</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Comunicação em tempo real por rede cabeada ou Wi-Fi privativo isolado da Câmara, blindado contra invasões externas.
              </p>
              <div className="text-[11px] font-mono text-emerald-400/90 pt-2 border-t border-white/10">
                Broadcast instantâneo
              </div>
            </div>

            <div className="p-6 rounded-2xl bg-white/5 border border-white/10 space-y-4 relative overflow-hidden">
              <div className="size-10 rounded-lg bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
                <Database className="size-5" />
              </div>
              <h3 className="text-lg font-bold text-white">3. Nuvem Segura PostgreSQL</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Replicação assíncrona automática assim que a conectividade WAN estiver disponível, com backup geo-redundante.
              </p>
              <div className="text-[11px] font-mono text-blue-400/90 pt-2 border-t border-white/10">
                Disponibilidade 99.98%
              </div>
            </div>

            <div className="p-6 rounded-2xl bg-white/5 border border-white/10 space-y-4 relative overflow-hidden">
              <div className="size-10 rounded-lg bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-400">
                <WifiOff className="size-5" />
              </div>
              <h3 className="text-lg font-bold text-white">4. P2P Fallback Offline</h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Mesmo em caso de corte total do cabo de fibra da cidade, os vereadores continuam votando e a sessão é concluída com validade jurídica.
              </p>
              <div className="text-[11px] font-mono text-purple-400/90 pt-2 border-t border-white/10">
                Zero perda de dados
              </div>
            </div>
          </div>

          {/* Comparativo de Resiliência */}
          <div className="p-6 sm:p-8 rounded-2xl bg-slate-900/80 border border-white/15 max-w-4xl mx-auto space-y-6">
            <h3 className="text-xl font-bold text-center text-white">
              Sistemas Convencionais em Nuvem vs. edocBR Plenário
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-sm">
              <div className="space-y-3 p-4 rounded-xl bg-red-950/20 border border-red-500/20">
                <div className="font-bold text-red-400 flex items-center gap-2">
                  <ShieldAlert className="size-4" />
                  Sistemas Tradicionais 100% Web
                </div>
                <ul className="text-xs text-slate-300 space-y-2">
                  <li>❌ Internet caiu → A votação é interrompida no meio.</li>
                  <li>❌ Telão do plenário congela se a banda oscilar.</li>
                  <li>❌ Risco de perda de votos e nulidade regimental.</li>
                  <li>❌ Dependência de servidores externos sem controle local.</li>
                </ul>
              </div>

              <div className="space-y-3 p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/20">
                <div className="font-bold text-emerald-400 flex items-center gap-2">
                  <ShieldCheck className="size-4" />
                  edocBR Plenário (ADR-027 / ADR-030)
                </div>
                <ul className="text-xs text-slate-300 space-y-2">
                  <li>✅ Votação continua intacta na LAN mesmo sem sinal de internet.</li>
                  <li>✅ Telão atualiza em menos de 5ms por rede local gigabit.</li>
                  <li>✅ Cada voto assinado criptograficamente na origem.</li>
                  <li>✅ Sincronização em nuvem automática na volta do link.</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════
          SEÇÃO 4: TRANSPARÊNCIA ATIVA & VERIFICADOR CRIPTOGRÁFICO
          ═══════════════════════════════════════════════════════════════════════ */}
      <section id="transparencia" className="py-24 px-4 sm:px-8 max-w-7xl mx-auto space-y-16">
        <div className="text-center max-w-3xl mx-auto space-y-4">
          <Badge className="bg-emerald-100 text-emerald-900 border-emerald-300 font-bold px-3 py-1">
            Transparência Universal & Fé Pública
          </Badge>
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
            Acesso Aberto ao Cidadão e Verificação em Tempo Real
          </h2>
          <p className="text-slate-600 text-base leading-relaxed">
            Todas as sessões, matérias e atas geradas no sistema contam com verificação criptográfica pública.
            Cidadãos, jornalistas, advogados e órgãos de controle podem aferir a autenticidade instantaneamente.
          </p>
        </div>

        {/* Verificador Criptográfico Incorporado */}
        <div id="verificador" className="max-w-3xl mx-auto scroll-mt-24">
          <PublicVerifier />
        </div>

        {/* Replay de Sessões e Recursos de Transparência */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6">
          <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-3">
            <div className="size-10 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
              <FileCheck2 className="size-5" />
            </div>
            <h3 className="font-bold text-slate-900">Atas Eletrônicas Autênticas</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              PDFs gerados com sumário deliberativo, assinatura digital ICP-Brasil e QR Code direto para o verificador online.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-3">
            <div className="size-10 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center">
              <Users className="size-5" />
            </div>
            <h3 className="font-bold text-slate-900">Votos Nominais Detalhados</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              O cidadão consulta exatamente como cada vereador votou em cada projeto, emenda ou veto do Executivo.
            </p>
          </div>

          <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-3">
            <div className="size-10 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
              <Clock className="size-5" />
            </div>
            <h3 className="font-bold text-slate-900">Replay Cronológico da Sessão</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Linha do tempo reconstituindo segundo a segundo a ordem dos oradores, requerimentos e apuração em plenário.
            </p>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════
          SEÇÃO 5: GOVERNANÇA, SEGURANÇA E CONFORMIDADE LGPD
          ═══════════════════════════════════════════════════════════════════════ */}
      <section id="lgpd" className="py-24 px-4 sm:px-8 bg-slate-100 border-y border-slate-200">
        <div className="max-w-7xl mx-auto space-y-16">
          <div className="text-center max-w-3xl mx-auto space-y-4">
            <Badge className="bg-slate-200 text-slate-800 border-slate-300 font-bold px-3 py-1">
              Trust Center & Compliance
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
              Conformidade Rigorosa com a LGPD e Princípios da Administração Pública
            </h2>
            <p className="text-slate-600 text-base leading-relaxed">
              O edocBR Plenário foi concebido com <em>Privacy by Design</em> e <em>Security by Default</em>, respeitando a Lei Geral de Proteção de Dados Pessoais (Lei 13.709/2018) e a Lei de Acesso à Informação (Lei 12.527/2011).
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-3">
              <div className="size-10 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center">
                <ShieldCheck className="size-5" />
              </div>
              <h3 className="font-bold text-slate-900">Bases Legais Claras</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Tratamento fundamentado no cumprimento de obrigação legal e execução de políticas públicas pelo Poder Legislativo (Art. 7º, II e III da LGPD).
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-3">
              <div className="size-10 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center">
                <Lock className="size-5" />
              </div>
              <h3 className="font-bold text-slate-900">Zero Cookies de Rastreamento</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Nenhum pixel de terceiros, ferramentas invasivas de publicidade ou comercialização de dados. Apenas cookies técnicos essenciais de sessão.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-3">
              <div className="size-10 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center">
                <Users className="size-5" />
              </div>
              <h3 className="font-bold text-slate-900">Canal Direto com o DPO</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Encarregado de Proteção de Dados formalmente designado, com canal direto para atendimento aos direitos dos titulares (Art. 18 da LGPD).
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-3">
              <div className="size-10 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center">
                <Database className="size-5" />
              </div>
              <h3 className="font-bold text-slate-900">Hospedagem em Solo Nacional</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Infraestrutura em data centers certificados ISO 27001 e SOC 2 com armazenamento seguro e isolamento lógico por tenant (Câmara).
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════
          SEÇÃO 6: AUTO-ONBOARDING & ACESSO IMEDIATO
          ═══════════════════════════════════════════════════════════════════════ */}
      <section id="onboarding" className="py-24 px-4 sm:px-8 max-w-7xl mx-auto space-y-16">
        <div className="text-center max-w-3xl mx-auto space-y-4">
          <Badge className="bg-amber-100 text-amber-900 border-amber-300 font-bold px-3 py-1">
            Experimentação e Acesso
          </Badge>
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
            Habilite o Espaço da sua Câmara ou Acesse sua Conta
          </h2>
          <p className="text-slate-600 text-base leading-relaxed">
            Inicie um ambiente de demonstração completo para a sua Câmara Municipal em menos de 1 minuto,
            ou entre na área restrita se o seu município já está integrado ao edocBR Plenário.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Coluna Esquerda: Formulário de Onboarding (7 colunas) */}
          <div className="lg:col-span-7">
            <OnboardingForm />
          </div>

          {/* Coluna Direita: Acesso Imediato & Contato Consultivo (5 colunas) */}
          <div className="lg:col-span-5 space-y-6">
            <Card className="border-slate-300 bg-gradient-to-br from-[#020b18] via-[#051833] to-[#08264e] text-white shadow-xl">
              <CardHeader className="space-y-2">
                <div className="size-10 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
                  <Lock className="size-5" />
                </div>
                <CardTitle className="text-xl font-bold text-white">
                  Já é Parlamentar ou Servidor?
                </CardTitle>
                <CardDescription className="text-slate-300 text-xs leading-relaxed">
                  Acesse o painel institucional da sua Câmara com seu e-mail institucional e senha de segurança ou chave TOTP.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-3.5 rounded-xl bg-white/5 border border-white/10 text-xs text-slate-300 space-y-2">
                  <div className="flex items-center gap-2 text-emerald-400 font-semibold">
                    <CheckCircle2 className="size-4" />
                    Autenticação com Cofre Split-Vault
                  </div>
                  <p className="text-slate-400">
                    Sessão protegida por token criptográfico de 7 dias, com suporte a troca rápida de perfil em modo de demonstração.
                  </p>
                </div>

                {onOpenLoginModal ? (
                  <Button
                    onClick={onOpenLoginModal}
                    className="w-full bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold py-6 text-sm uppercase tracking-wider shadow-lg shadow-amber-500/20"
                  >
                    Entrar na Área Restrita
                    <ArrowRight className="size-4 ml-1" />
                  </Button>
                ) : (
                  <Link
                    href="/login"
                    className="inline-flex items-center justify-center gap-2 w-full px-4 py-3.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-sm uppercase tracking-wider shadow-lg shadow-amber-500/20 transition-transform hover:scale-[1.02]"
                  >
                    Entrar na Área Restrita
                    <ArrowRight className="size-4" />
                  </Link>
                )}
              </CardContent>
            </Card>

            {/* Suporte Executivo */}
            <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-sm space-y-3">
              <h3 className="font-bold text-slate-900 flex items-center gap-2">
                <HelpCircle className="size-4 text-amber-500" />
                Dúvidas Técnicas ou Jurídicas?
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Nossa equipe de consultoria legislativa auxilia na adequação do Regimento Interno da sua Câmara para o uso pleno do plenário eletrônico.
              </p>
              <div className="pt-2">
                <a
                  href="mailto:contato@edocbr.com.br"
                  className="text-xs font-bold text-amber-900 hover:text-amber-950 underline underline-offset-4 flex items-center gap-1"
                >
                  Falar com especialista legislativo
                  <ArrowRight className="size-3.5" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════
          SEÇÃO 7: FAQ EXECUTIVO (PERGUNTAS FREQUENTES)
          ═══════════════════════════════════════════════════════════════════════ */}
      <section id="faq" className="py-24 px-4 sm:px-8 bg-slate-100 border-t border-slate-200">
        <div className="max-w-4xl mx-auto space-y-12">
          <div className="text-center space-y-4">
            <Badge className="bg-slate-200 text-slate-800 border-slate-300 font-bold px-3 py-1">
              Tire suas Dúvidas
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
              Perguntas Frequentes de Presidentes e Diretores Legislativos
            </h2>
          </div>

          <div className="space-y-4">
            {[
              {
                q: 'É necessária alteração no Regimento Interno da Câmara para usar o Plenário Eletrônico?',
                a: 'A maioria dos Regimentos Internos já prevê a votação nominal e a proclamação pelo Presidente. Nossa equipe jurídica fornece minuta padrão de Resolução da Mesa Diretora para regulamentar o painel eletrônico e a votação por dispositivo digital, assegurando total validade jurídica e conformidade com a Lei Orgânica.',
              },
              {
                q: 'O que acontece se a internet da Câmara cair durante uma votação importante?',
                a: 'Graças à arquitetura híbrida LAN (ADR-027 e ADR-030), a sessão não é interrompida. A rede local isolada do plenário continua processando votos, cronômetros e transmissão interna com latência inferior a 5ms. Assim que o link de internet for restabelecido, os dados são sincronizados automaticamente com a nuvem.',
              },
              {
                q: 'Quais equipamentos de informática são necessários na Câmara?',
                a: 'O sistema é extremamente leve e roda em qualquer navegador moderno. Para a Mesa e Vereadores, qualquer tablet, notebook ou smartphone comum pode ser usado. Para a transmissão, uma TV comum com entrada HDMI ou receptor web é suficiente.',
              },
              {
                q: 'Como é garantida a segurança contra fraudes na votação?',
                a: 'Cada voto é assinado criptograficamente no momento do envio utilizando algoritmo SHA-256 com carimbo de tempo sequencial (hash chaining imutável). Ninguém, nem mesmo os administradores de banco de dados, consegue adulterar um voto registrado sem invalidar toda a cadeia de custódia pública.',
              },
              {
                q: 'O sistema atende às exigências dos Tribunais de Contas e Ministérios Públicos?',
                a: 'Sim. Todas as deliberações geram atas estruturadas, relatórios nominais de presença e arquivos de transparência ativa que cumprem integralmente as diretrizes dos Tribunais de Contas Estaduais (TCEs) e a Lei de Acesso à Informação (Lei 12.527/2011).',
              },
              {
                q: 'Como funciona o período de experimentação (Auto-Onboarding)?',
                a: 'Ao preencher o formulário de auto-onboarding, um ambiente completo com dados simulados é provisionado para a sua Câmara. Você pode convidar servidores e vereadores para testar a condução de sessões, painel de TV e votação nominal antes de qualquer contratação formal.',
              },
            ].map((item, index) => {
              const isOpen = openFaq === index
              return (
                <div
                  key={index}
                  className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden transition-colors"
                >
                  <button
                    onClick={() => toggleFaq(index)}
                    className="w-full p-5 text-left flex items-center justify-between gap-4 font-bold text-slate-900 hover:text-amber-600 transition-colors"
                    aria-expanded={isOpen}
                  >
                    <span>{item.q}</span>
                    <ChevronDown
                      className={`size-5 shrink-0 text-slate-400 transition-transform duration-200 ${
                        isOpen ? 'rotate-180 text-amber-500' : ''
                      }`}
                    />
                  </button>
                  {isOpen && (
                    <div className="px-5 pb-5 text-sm text-slate-600 leading-relaxed border-t border-slate-100 pt-3">
                      {item.a}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════
          RODAPÉ INSTITUCIONAL
          ═══════════════════════════════════════════════════════════════════════ */}
      <footer className="bg-[#020b18] text-white border-t border-white/10 pt-16 pb-12 px-4 sm:px-8">
        <div className="max-w-7xl mx-auto space-y-12">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-8">
            <div className="lg:col-span-2 space-y-4">
              <div className="flex items-center gap-3">
                <Image
                  src="/brand/edocbr-logo-white.svg"
                  alt="e-docBR"
                  width={130}
                  height={34}
                  className="h-8 w-auto object-contain"
                />
                <span className="h-5 w-[1px] bg-white/20" />
                <span className="text-xs font-extrabold tracking-[0.16em] text-amber-400">
                  PLENÁRIO
                </span>
              </div>
              <p className="text-xs text-slate-400 max-w-sm leading-relaxed">
                Plataforma de alta disponibilidade para governança legislativa, deliberação eletrônica, painel de plenário e transparência ativa nas Câmaras Municipais do Brasil.
              </p>
              <div className="text-xs text-slate-400 space-y-1 pt-2">
                <p>CNPJ / Registro: Plataforma Governamental Licenciada</p>
                <p>Tecnologia em conformidade com ADR-027 / ADR-030</p>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-amber-400">
                A Plataforma
              </h4>
              <ul className="text-xs space-y-2 text-slate-300">
                <li><a href="#hero" className="hover:text-white transition-colors">Início</a></li>
                <li><a href="#modulos" className="hover:text-white transition-colors">6 Módulos Integrados</a></li>
                <li><a href="#arquitetura" className="hover:text-white transition-colors">Resiliência LAN</a></li>
                <li><a href="#transparencia" className="hover:text-white transition-colors">Transparência Ativa</a></li>
                <li><a href="#onboarding" className="hover:text-white transition-colors">Auto-Onboarding</a></li>
              </ul>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-amber-400">
                Governança & Lei
              </h4>
              <ul className="text-xs space-y-2 text-slate-300">
                <li><a href="#lgpd" className="hover:text-white transition-colors">Trust Center LGPD</a></li>
                <li><a href="#transparencia" className="hover:text-white transition-colors">Lei de Acesso à Informação</a></li>
                <li><a href="#verificador" className="hover:text-white transition-colors">Verificador Criptográfico</a></li>
                <li><a href="#faq" className="hover:text-white transition-colors">Perguntas Frequentes</a></li>
                <li><span className="text-slate-400">Política de Privacidade</span></li>
              </ul>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-amber-400">
                Acesso Seguro
              </h4>
              <ul className="text-xs space-y-2 text-slate-300">
                <li>
                  {onOpenLoginModal ? (
                    <button onClick={onOpenLoginModal} className="hover:text-white text-left font-bold text-amber-400">
                      Entrar no Plenário
                    </button>
                  ) : (
                    <Link href="/login" className="hover:text-white font-bold text-amber-400">
                      Entrar no Plenário
                    </Link>
                  )}
                </li>
                <li><a href="#verificador" className="hover:text-white">Validar Código de Ata</a></li>
                <li><a href="#onboarding" className="hover:text-white">Criar Espaço Demo</a></li>
                <li><a href="mailto:contato@edocbr.com.br" className="hover:text-white">Suporte Técnico</a></li>
              </ul>
            </div>
          </div>

          <Separator className="bg-white/10" />

          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400">
            <p>© {new Date().getFullYear()} edocBR Plenário. Todos os direitos reservados.</p>
            <div className="flex items-center gap-6">
              <span className="flex items-center gap-1.5 text-emerald-400">
                <span className="size-2 rounded-full bg-emerald-400" />
                Sistemas 100% Operacionais
              </span>
              <span>Ambiente Protegido SHA-256</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

