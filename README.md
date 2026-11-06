# edocBR Plenário — Suíte Legislativa Multiempresa

Substituição moderna do PainelDeskLegis 8.1 para Câmaras Municipais brasileiras:
backoffice legislativo, condução de sessão em tempo real, votação auditável com **recibos
verificáveis e opções regimentais**, discursos, telões, portal de transparência com **diário
eletrônico, participação popular e assinaturas do cidadão**, app do parlamentar, IA assistiva
com revisão humana, **autenticação real por e-mail/senha**, console SaaS multiempresa com
**faturamento, ciclo de cobrança e observabilidade**, **Analytics/BI**, **agenda legislativa
e pesquisa global (⌘K)**, **modelos de documento versionados**, **Central de Ajuda
in-app**, **ciclo de vida da matéria com sanção/veto e relacionamentos**, **suporte da
plataforma com impersonação auditada** e **Planejamento e Roadmap — o plano do produto
dentro do produto, com o progresso rastreável da Onda 5 (Fases 21–24) e a prévia da
Onda 6**. Piloto **v0.13.0** (26 módulos).

> Piloto funcional em ambiente local. A Câmara Municipal de Mucuri/BA está
> cadastrada com identidade, 13 parlamentares/mandatos, partidos, Mesa, contatos e fotos de fontes públicas; ainda não há usuários institucionais, regras aprovadas nem sessões oficiais. Os dados fictícios de Vila Nova/MG e Serra Azul/SP
> continuam disponíveis exclusivamente para demonstração.

O [plano atualizado de 05/11/2026](docs/PLANO-DESENVOLVIMENTO-ATUAL-2026-11-05.md) é a referência
atual para a ordem das fases; a [meta de execução](docs/META-EXECUCAO-PLENARIO-2026-11-05.md)
acompanha os marcos e o [pacote de homologação](docs/HOMOLOGACAO-PACOTE-EXECUCAO.md)
organiza a futura prova institucional. A [matriz de rastreabilidade](docs/MATRIZ-RASTREABILIDADE-2026-11-04.md)
liga funções, código, testes e evidências. O número v0.13.0 e os 26 módulos acima
descrevem a versão histórica do núcleo do produto, não a homologação do piloto. A
[etapa 045](docs/etapas/045-fundacao-operacional-saas.md) permanece aberta:
PostgreSQL e workers já rodam em uma [VPS dedicada de homologação](docs/etapas/045-vps-dedicada.md),
com dados sintéticos e acesso por túnel SSH; correio e recuperação institucionais
continuam pendentes. O [fluxo local → GitHub → VPS](docs/FLUXO-ENTREGA-LOCAL-GITHUB-VPS.md)
define a promoção de um commit com CI verde. O domínio `edocbrplenario.com.br` já
serve o laboratório sintético por HTTPS; isso ainda não representa o piloto oficial.

---

## Destaques

- **Sessão ponta a ponta**: pauta publicada → check-in → quórum em tempo real →
  votação nominal/simbólica com **idempotência de voto** e resultado
  determinístico → discursos com cronômetro → espelho com código de verificação.
- **Tempo real com outbox transacional**: eventos ficam persistidos para retomada;
  telão se reconstrói por snapshot; salas separadas para escopo interno e público.
  A entrega distribuída ainda depende da homologação operacional.
- **Auditoria à prova de adulteração**: trilha append-only com cadeia de hash
  verificável a um clique.
- **Multiempresa de verdade**: onboarding de Câmaras, planos com entitlements (a IA é
  gateada por plano) e health score por tenant — com isolamento de dados server-side.
- **IA assistiva responsável**: minuta de ata, ementa, resumo de tramitação, transcrição
  e OCR sempre como **rascunho com rastreabilidade** (modelo/horário/revisor) — IA não
  vota, não publica, não transiciona (ADR-006).
- **Autenticação real (Fase 9)**: login por e-mail/senha (scrypt) com sessão httpOnly
  revogável, gestão de usuários do tenant e bloqueio de tenant desativado — coexistindo
  com os perfis de demonstração (ADR-010).
- **Faturamento SaaS (Fase 10)**: faturas por competência com excedentes de plano,
  ciclo de cobrança idempotente, dunning (past_due + notificação + webhook) e reativação
  por pagamento (ADR-011).
- **Diário eletrônico + participação popular (Fase 11)**: publicações oficiais numeradas
  com código de verificação (revogação nunca apaga) e audiências públicas com perguntas
  do cidadão **moderadas** — anônimo escreve, a Casa modera, o portal publica (ADR-012).
- **Analytics/BI (Fase 12)**: presenças, produção legislativa, tramitação e coesão
  partidária em votações nominais — camada 100% somente-leitura (ADR-013).
- **Agenda e pesquisa global (Fase 13)**: calendário único de sessões, audiências,
  reuniões e prazos + **command palette ⌘K** com navegação e pesquisa unificada
  (matérias, sessões, parlamentares, publicações) — agregação somente-leitura (ADR-014).
- **Modelos de documento versionados (Fase 14)**: atas, decretos, editais, portarias,
  resoluções e ofícios com placeholders e histórico **append-only**; publicações nascem
  de modelos renderizados no servidor com origem auditada (ADR-015).
- **Central de Ajuda in-app (Fase 15)**: guias por perfil, glossário, FAQ, atalhos e
  novidades versionados com o código — documentação viva dentro do produto (ADR-016).
- **Operação SaaS completa (Fase 16)**: aba Sistema com saúde dos serviços, filas e
  **alertas com ação sugerida**; **exportação integral** do tenant (sem segredos, voto
  secreto preservado) e **encerramento seguro** auditado que não apaga dados (ADR-017).
- **Desfechos de matéria (Fase 17)**: sanção, veto total/parcial e prazo regimental de
  apreciação (+15 dias, tarefa automática) como fatos append-only; relacionamentos entre
  matérias (emenda, substitutivo, altera, revoga, regula, subsidiária) com par único em
  qualquer direção — a situação Sancionada/Vetada só muda por desfecho auditado
  (ADR-018).
- **Recibos de voto verificáveis (Fase 18)**: cada voto nominal encerrado gera código
  HMAC-SHA256 determinístico por Casa; painel de **reconta** na Mesa com divergências
  visíveis e aba Recibos no app do parlamentar; votações com **opções regimentais**
  (até 5) substituindo Sim/Não/Abstenção com apuração por rótulo (ADR-019).
- **Participação do cidadão com rate limit (Fase 19)**: assinaturas com **dupla
  confirmação** por e-mail (aba Acompanhar do portal), verificação pública de
  autenticidade por código e **429 com Retry-After** nos endpoints públicos
  (ADR-020).
- **Suporte com impersonação auditada (Fase 20)**: módulo Suporte da Plataforma com
  "operar como usuário" (motivo, prazo ≤ 60 min, banner âmbar em todos os módulos e
  auditoria na Casa-alvo), **alertas persistentes com reconhecimento** e **exportação
  assíncrona com progresso real** (ADR-021).
- **Planejamento e Roadmap (v0.13.0)**: o plano de continuidade do produto consultável
  **dentro do produto** por qualquer papel autenticado — estado entregue (Ondas 1–4),
  **mapa-alvo TO-BE v5** (26 módulos), pacote documental e prévia da Onda 6; as
  **Fases 21–24 (Onda 5) ENTREGUES** aparecem com progresso real rastreável
  (4 fases · 34 tasks persistidas) e atualização exclusiva do dono da plataforma
  (RBAC `platform.manage`, autor e horário na própria linha).
- **Migração auditável**: pipeline de 8 estágios do PainelDeskLegis 8.1 com validação de
  órfãos, import idempotente, reconciliação por checksum, homologação irreversível e
  rollback por execução (ADR-008).

## Stack (ambiente piloto)

| Camada | Tecnologia |
|---|---|
| App + API | Next.js 16 (App Router) · React 19 · TypeScript estrito |
| UI | Tailwind CSS 4 · shadcn/ui (New York) · Lucide · TanStack Query |
| Dados | Prisma + SQLite (WAL, escritas serializadas) |
| Tempo real | socket.io — mini-serviço dedicado (porta 3003) |
| Webhooks | mini-serviço dedicado com HMAC + retry/dead-letter (porta 3004) |
| IA | z-ai-web-dev-sdk (LLM · ASR · VLM) — somente backend |
| Gateway | Caddy (porta única externa; `?XTransformPort={porta}` para serviços) |

> O prompt mestre especifica pnpm/NestJS/PostgreSQL/Tauri para produção; as adaptações do
> sandbox estão registradas em `docs/adr/ADR-001` com o caminho de migração.

## Como executar

Para desenvolvimento local, configure `DATABASE_URL` para a base SQLite do projeto e
defina `REALTIME_AUTH_SECRET` (mínimo 32 bytes) **com o mesmo valor** para o app e o
mini-serviço realtime. A seleção de perfis fictícios só aparece com
`LEGIS_DEMO_MODE=true` fora de produção. Sem essa opção, entre com e-mail/senha.
O progresso verificável do desenvolvimento está em [`docs/etapas/`](docs/etapas/README.md).
As próximas entregas possíveis sem conta de rede social estão em [`docs/FASES-SEM-CONTA-SOCIAL.md`](docs/FASES-SEM-CONTA-SOCIAL.md).
O roteiro funcional completo, da criação da sessão à votação, transmissão e ata, está em
[`docs/PLANO-FUNCIONAL-EDOCBR-PLENARIO.md`](docs/PLANO-FUNCIONAL-EDOCBR-PLENARIO.md).
O diagnóstico atualizado do que existe, dos bloqueios e da ordem proposta das fases 043–057
está em [`docs/DIAGNOSTICO-E-PLANO-DE-CONCLUSAO.md`](docs/DIAGNOSTICO-E-PLANO-DE-CONCLUSAO.md).
O cadastro institucional de Mucuri e a identidade edocBR estão em
[`docs/etapas/009-identidade-edocbr-mucuri.md`](docs/etapas/009-identidade-edocbr-mucuri.md).
A criação de sessões em rascunho e a numeração anual segura estão em
[`docs/etapas/010-preparacao-sessao.md`](docs/etapas/010-preparacao-sessao.md).
A política de publicação configurável por Câmara e a revisão inicial da pauta estão em
[`docs/etapas/011-politica-publicacao-saas.md`](docs/etapas/011-politica-publicacao-saas.md).
As emendas à pauta publicada, com prévia e nova revisão pública, estão em
[`docs/etapas/012-emendas-pauta-publicada.md`](docs/etapas/012-emendas-pauta-publicada.md).
A convocação pública com antecedência por Câmara e SHA-256 por revisão está em
[`docs/etapas/013-convocacao-publica-saas.md`](docs/etapas/013-convocacao-publica-saas.md).
O desenho de integração com Nextcloud e Alfresco está em
[`docs/integracoes/arquitetura-edocbr.md`](docs/integracoes/arquitetura-edocbr.md).
A prova local de transmissão está em [`docs/transmissao/prova-local.md`](docs/transmissao/prova-local.md), e o contrato inicial do painel em [`docs/transmissao/painel-operacao.md`](docs/transmissao/painel-operacao.md).
A primeira versão da aba Transmissão da Mesa do Plenário está descrita em [`docs/etapas/003-painel-transmissao-local.md`](docs/etapas/003-painel-transmissao-local.md).
O controle de destinos RTMPS, o papel audiovisual e a prova local com MediaMTX estão em [`docs/etapas/004-destinos-rtmps.md`](docs/etapas/004-destinos-rtmps.md); a configuração operacional está em [`docs/transmissao/destinos-rtmps.md`](docs/transmissao/destinos-rtmps.md).
O catálogo de gravação no painel e seus limites estão em [`docs/etapas/005-gravacao-e-resiliencia.md`](docs/etapas/005-gravacao-e-resiliencia.md).
O worker de reconciliação de destinos e sua migração estão em [`docs/etapas/006-intencao-reconciliacao-midia.md`](docs/etapas/006-intencao-reconciliacao-midia.md).
O heartbeat e a verificação operacional do worker estão em [`docs/etapas/007-saude-operacional-midia.md`](docs/etapas/007-saude-operacional-midia.md); use `bun run media:health` para integrar o resultado ao monitoramento.
A proteção contra alterações concorrentes de destinos da mesma sessão está em [`docs/etapas/008-concorrencia-destinos-midia.md`](docs/etapas/008-concorrencia-destinos-midia.md).

```bash
bun run dev        # app na porta 3000 (rota única /)
bun prisma/seed.ts # somente em base descartável de demonstração, sem Mucuri
bun run db:register:mucuri # cadastro idempotente da Câmara real, sem usuários

# serviços de suporte (ver docs/runbook.md §1)
(cd mini-services/realtime  && bun run dev)   # porta 3003
(cd mini-services/webhooks  && bun run dev)   # porta 3004
```

O ambiente completo usa **4 portas**: app Next.js (3000) · realtime socket.io (3003) ·
webhooks (3004) · gateway Caddy (única porta externa, com `?XTransformPort={porta}`
para os serviços). Acesse pela **porta do gateway** (preview do sandbox). Duas formas de
entrar:

- **E-mail e senha** — contas do seed, senha `DemoLegis!2026`. Os sete papéis
  oferecidos na entrada por perfil também entram por senha (gate
  `bun run test:seed:demo-logins`):

  | Papel | E-mail |
  |---|---|
  | Administrador da Câmara | `ana.ribeiro@vilanova.mg.leg.br` |
  | Administração Legislativa | `paula.andrade@vilanova.mg.leg.br` |
  | Operador de Sessão | `marcos.vieira@vilanova.mg.leg.br` |
  | Presidência | `roberto.nogueira@vilanova.mg.leg.br` |
  | Parlamentar | `carla.mendes@vilanova.mg.leg.br` |
  | Auditor | `helena.costa@tce.mg.gov.br` |
  | Operação da Plataforma | `suporte@legissaas.dev` |

  Também no seed: `marta.lima@serraazul.sp.leg.br` (admin da 2ª Câmara) e
  `joao.prado@legissaas.dev` (**Suporte da Plataforma**).
- **Perfis de demonstração** (um clique): os mesmos sete papéis, sem senha.

## Documentação (índice)

O pacote de validação institucional — cinco formulários para a Câmara preencher escolhendo — está em
[`docs/aceite/README.md`](docs/aceite/README.md). Nenhum dado oficial é cadastrado antes da assinatura.

| Documento | Conteúdo |
|---|---|
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Plano de continuidade: mapa de funcionalidades/menus/páginas, fases 5–20 entregues, **Onda 5 entregue (§12), Onda 6 planejada (§14) e fases 043–057 no diagnóstico** |
| [`docs/user-manual.md`](docs/user-manual.md) | Manual do usuário por perfil (todos os 26 módulos) |
| [`docs/api-contract.md`](docs/api-contract.md) | Contrato REST `/api/v1` (~76 grupos de rotas) + eventos de tempo real (fonte única de verdade) |
| [`docs/runbook.md`](docs/runbook.md) | Operação: subir ambiente, health checks, backup/restauração, incidentes |
| [`docs/migration-importer.md`](docs/migration-importer.md) | Guia do importador PainelDeskLegis 8.1 (pipeline, homologação, rollback) |
| [`docs/CHANGELOG.md`](docs/CHANGELOG.md) | Histórico de entregas por fase |
| [`docs/test-report.md`](docs/test-report.md) | Testes reais executados, defeitos corrigidos, riscos remanescentes |
| `docs/adr/ADR-001..021` | Decisões de arquitetura entregues |
| `docs/adr/ADR-022..025` | Decisões de arquitetura da Onda 5 entregue |
| [`docs/adr/ADR-026-configuracao-por-camara.md`](docs/adr/ADR-026-configuracao-por-camara.md) | Diretriz SaaS para políticas por Câmara, snapshots e isolamento |

### ADRs

| ADR | Decisão |
|---|---|
| 001 | Adaptação da arquitetura ao sandbox (SQLite/Next/mini-serviços) |
| 002 | Motor de sessão e votação (máquinas de estado, idempotência, snapshots) |
| 003 | Tempo real via outbox transacional + serialização de escritas SQLite |
| 004 | Auditoria append-only com cadeia de hash verificável |
| 005 | RBAC demo via `x-actor-id` (matriz idêntica à de produção) |
| 006 | IA assistiva: rastreabilidade total e revisão humana obrigatória |
| 007 | Webhooks HMAC com retentativa exponencial e dead-letter |
| 008 | Importador de migração com pipeline auditável de 8 estágios |
| 009 | App do parlamentar e endpoints `/me` (identidade do vínculo, nunca do payload) |
| 010 | Autenticação real (scrypt + sessão httpOnly) coexistindo com o modo demo |
| 011 | Faturamento simulado do SaaS (faturas, ciclo, dunning) |
| 012 | Publicações oficiais + participação popular com moderação |
| 013 | Analytics/BI como camada somente-leitura (voto secreto excluído) |
| 014 | Agenda Legislativa e pesquisa unificada (agregação somente-leitura + ⌘K) |
| 015 | Modelos de documento versionados por tenant (append-only + render server-side) |
| 016 | Central de Ajuda in-app versionada com o código |
| 017 | Observabilidade on-demand, exportação integral e encerramento seguro do tenant |
| 018 | Desfechos da matéria (sanção/veto) e relacionamentos como fatos auditados |
| 019 | Recibos de voto verificáveis (HMAC por tenant) e opções regimentais |
| 020 | Participação e confiança pública (assinaturas, verificação por código, rate limit) |
| 021 | Suporte com impersonação auditada, alertas persistentes e exportação assíncrona |
| 022 | Prontidão para produção (PostgreSQL+RLS, Redis, SMTP, worker) — **planejado** (Fase 21) |
| 023 | MFA TOTP e assinatura eletrônica de atas — **planejado** (Fase 22) |
| 024 | Chaves de API com escopos e revogação — **planejado** (Fase 23) |
| 025 | Crescimento do SaaS (self-onboarding, trial, health, NPS) — **planejado** (Fase 24) |

## Mapa de módulos (24)

```
Operação           Painel · Agenda Legislativa · Sessões · Mesa do Plenário · Telão · App do Parlamentar
Processo Legislativo  Protocolo e Tramitação
Cadastros          Parlamentares · Matérias · Estrutura Institucional
Governança         Auditoria · Relatórios · Publicações e Audiências · Analytics · Portal Público · Webhooks
Administração      Usuários · Modelos de Documento · Configurações · Console da Plataforma (com Faturamento e Sistema) · Migração de Dados · Suporte da Plataforma · Planejamento e Roadmap
Ajuda              Central de Ajuda
```

Componente transversal: **command palette global (⌘K/Ctrl+K)** na topbar — navegação
entre os 26 módulos + pesquisa unificada.

> Os módulos **Integrações & API** e **Crescimento**, as extensões do mapa-alvo TO-BE v5
> (MFA, assinatura de atas, verificação pública de assinaturas, aba Agendamentos, guia do
> desenvolvedor, widget NPS…) e o mini-serviço scheduler (porta 3005) são **planejados**
> para a Onda 5 (ROADMAP §12) — o mapa completo com estado por módulo está visível no
> módulo **Planejamento e Roadmap** (aba Mapa-alvo v5).

## Limitações declaradas do piloto

Sessões de login em SQLite (sem OIDC/MFA/Redis), voto secreto por sigilo operacional
(não criptográfico), rate limit público em memória por processo (produção: Redis), worker
de exportação in-process (job órfão após restart — interpretável pelo runbook §8),
faturamento sem gateway de pagamento real, SQLite single-writer e agente local offline
(Tauri) fora do sandbox — todas com caminho de produção documentado em `docs/runbook.md`
§10 e nos ADRs.
