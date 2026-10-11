# ADR-001 — Adaptação da arquitetura alvo ao ambiente do sandbox

## Status
Aceito (fase de fundação)

## Contexto
O prompt mestre pede um monorepo (pnpm/Turborepo) com apps `web` (Next.js), `api` (NestJS),
`edge-agent` (Tauri/Rust), PostgreSQL com RLS, Redis/BullMQ, S3 e Kubernetes. O ambiente de
execução disponível é um sandbox único com: Next.js 16 (App Router, porta 3000), Prisma ORM
com SQLite, mini-serviços Bun em portas próprias atrás de um gateway Caddy (query
`XTransformPort`), e z-ai-web-dev-sdk para recursos assistivos no backend.

## Decisão
1. Preservar o **núcleo de domínio** do produto (motor de sessões, votação idempotente,
   presença/quórum, discursos, auditoria, white-label, portal público, tempo real) e as
   **decisões arquiteturais** que não dependem de infraestrutura.
2. Substituições pragmáticas de infraestrutura:
   - Monorepo NestJS → **rotas de API do Next.js** sob `/api/v1` com camada de serviço
     dedicada (`src/lib/server/*`), mantendo a separação domínio/aplicação/infra.
   - PostgreSQL+RLS → **Prisma/SQLite** com `tenantId` em todas as tabelas de domínio e
     verificação de escopo de tenant em TODA consulta/mutação server-side (segunda
     barreira garantida em código, função `assertTenantScope`).
   - Redis/BullMQ → **tabela `OutboxEvent`** (outbox transacional) consumida pelo serviço
     de tempo real (ADR-003); jobs síncronos nas rotas.
   - Tauri edge-agent → **modo telão (kiosk) no navegador** + snapshot de reconstrução,
     comunicado como degradação controlada (o protocolo edge/cloud completo fica como fase
     futura fora do sandbox).
3. Contratos públicos versionados (`/api/v1`) e envelope `RealtimeEvent` seguem exatamente
   a especificação do prompt mestre, permitindo extração futura para o monorepo alvo sem
   quebra de contrato.

## Consequências
- Ganho: sistema executável ponta a ponta no sandbox com os fluxos críticos reais.
- Dívida registrada: RLS em banco, filas distribuídas, agente desktop offline e
  migração HSQLDB ficam como fases subsequentes (fora do escopo do sandbox).
