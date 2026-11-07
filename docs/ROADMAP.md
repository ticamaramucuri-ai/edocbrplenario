# Plano de Continuidade — Legis SaaS

> **Roadmap histórico.** O [plano mestre do edocBR Plenário](PLANO-MESTRE.md) é a referência vigente de fases e gates; esta página conserva o desenho anterior.

Documento histórico de ondas do produto, consultável também no módulo Planejamento e
Roadmap. A **Onda 5 (fases 21–24) foi entregue na v0.13.0**, com 26 módulos; os
quadros de tarefas de §12 preservam o planejamento original. A **Onda 6 (§14) é
planejada**. Este documento preserva a história das ondas; para o estado verificado em
05/11/2026, a ordem de conclusão 045–057 e os gates institucionais, consulte o
[plano atualizado](PLANO-DESENVOLVIMENTO-ATUAL-2026-11-05.md) e a
[matriz de rastreabilidade](MATRIZ-RASTREABILIDADE-2026-11-04.md).

> Fonte de requisitos: `upload/PROMPT_MESTRE_RECONSTRUCAO_SAAS_LEGISLATIVA.md` (plano de
> implementação obrigatório, seção 18). Adaptações de ambiente registradas em `docs/adr/`.

---

## 1. Estado atual (fases 0–12 — ENTREGUES)

| Fase (prompt mestre) | Equivalente entregue | Status |
|---|---|---|
| Fase 0 — Descoberta e arquitetura | ADRs 001–005, `docs/api-contract.md`, schema multi-tenant | ✅ Entregue |
| Fase 1 — Fundação | Tenant/white-label, RBAC demo (`x-actor-id`), auditoria hash chain, outbox, tempo real (porta 3003), shell SPA, tema institucional | ✅ Entregue |
| Fase 2 — Estrutura e processo legislativo | **Parcial**: parlamentares e matérias básicos com autoria múltipla | ⚠️ Básico |
| Fase 3 — Sessão e votação | Motor completo de sessão/votação/presença/quórum/pauta, mesa do plenário, idempotência de voto, concorrência otimista | ✅ Entregue |
| Fase 4 — Discursos, telões e PWA | Discursos com timer server-side, telão kiosk com perfis e snapshot; **PWA pendente** | ⚠️ Parcial |
| Fase 5 — Portal, relatórios e integrações | Portal live, espelho de sessão imprimível; **pesquisa/dados abertos/webhooks/ata pendentes** | ⚠️ Parcial |
| Fase 6 — Agente local e offline | Não aplicável ao sandbox (Tauri/Rust) — ver §7 Limitações | 🚫 Fora de escopo |
| Fase 7 — Migração e piloto | Pipeline completo do importador + 2 tenants demo | ✅ Entregue (Task 9) |
| Fase 9 — Autenticação real | Login e-mail/senha (scrypt), sessões httpOnly revogáveis, módulo Usuários, enforcement de tenant ativo | ✅ Entregue (Task 14) |
| Fase 10 — Faturamento SaaS | Faturas, ciclo de cobrança com dunning, uso vs. limites, aba no Console | ✅ Entregue (Task 15) |
| Fase 11 — Publicações e participação | Diário eletrônico, audiências públicas com perguntas do cidadão moderadas | ✅ Entregue (Task 16) |
| Fase 12 — Analytics/BI | Rota somente-leitura + módulo com gráficos (presenças, produção, coesão) | ✅ Entregue (Task 17) |

### 1.1 Mapa atual de menus/módulos (AS-IS)

| Grupo | Módulo | Papéis (visível/editável) |
|---|---|---|
| Operação | Painel (dashboard) | Todos |
| Operação | Sessões | Todos (escrita: admin/legislativo) |
| Operação | Mesa do Plenário | Operador, presidência, admin |
| Operação | Telão (kiosk) | Todos (fullscreen) |
| Cadastros | Parlamentares | Todos (escrita: admin/legislativo) |
| Cadastros | Matérias | Todos (escrita: admin/legislativo) |
| Governança | Auditoria | Auditor, admin, plataforma |
| Governança | Relatórios | Todos |
| Governança | Portal Público | Todos |
| Administração | Configurações | Admin, plataforma |

### 1.2 Base técnica consolidada

- 20 rotas `/api/v1` com Problem Details, RBAC server-side, escopo de tenant derivado do ator.
- Máquinas de estado: sessão, pauta (item), votação, discurso — com transições validadas,
  concorrência otimista (`version`) e auditoria encadeada (hash chain).
- Tempo real: outbox transacional → `mini-services/realtime` (porta 3003, socket.io) → salas
  `tenant:{id}` (interno) e `public:{id}` (telão/portal).
- SQLite/Prisma com serialização de escritas (mutex in-process + `connection_limit=1`) — ADR-003.

---

## 2. Mapa-alvo de menus e páginas (TO-BE v2 — fases 9–12 ENTREGUES: 19 módulos)

```
Operação
├── Painel                        (dashboard — enriquecido: pendências de tramitação/prazos)
├── Sessões                       (existente)
├── Mesa do Plenário              (existente)
├── Telão                         (existente, kiosk)
└── App do Parlamentar (PWA)      (mobile-first: presença, voto, fila de oradores)

Processo Legislativo
└── Protocolo e Tramitação        (protocolo, tramitação, prazos e tarefas)

Cadastros
├── Parlamentares                 (vínculo com mandatos/afastamentos)
├── Matérias                      (timeline de tramitação, versões, anexos, ementa IA)
└── Estrutura Institucional       (legislaturas, partidos/blocos, mesa, comissões,
                                    mandatos e afastamentos)

Governança
├── Auditoria                     (existente)
├── Relatórios                    (existente — espelho, ata, artefatos de IA)
├── Publicações e Audiências      (NOVO — Fase 11: diário eletrônico oficial + audiências
│                                    públicas com participação popular moderada)
├── Analytics                     (NOVO — Fase 12: BI legislativo — presenças, produção,
│                                    tramitação, coesão partidária, aprovação)
├── Portal Público                (ganha abas Publicações e Audiências com envio de pergunta)
└── Acompanhamentos (Webhooks)    (existente)

Administração
├── Usuários                      (NOVO — Fase 9: gestão de acessos com senha, papéis,
│                                    vínculo com parlamentar, ativar/desativar)
├── Configurações                 (plano/entitlements do tenant)
├── Console da Plataforma         (ganha aba Faturamento — Fase 10: faturas, ciclo de
│                                    cobrança, dunning, uso por tenant)
└── Migração de Dados             (importador do legado com pipeline auditável)
```

Componentes transversais: login com e-mail/senha coexistindo com perfis de demonstração
(Fase 9), sino de notificações no topbar, indicador de conexão, assinatura de eventos por
webhooks e artefatos de IA sempre com origem/modelo/status de revisão visíveis.

### 2.1 Novo mapa v2 (fases 9–12) — 19 módulos

| Grupo | Módulo | Novidade | Papéis (visível/escrita) |
|---|---|---|---|
| Governança | Publicações e Audiências | NOVO | Todos (escrita: admin/legislativo; moderação idem) |
| Governança | Analytics | NOVO | Todos (leitura agregada do próprio tenant) |
| Administração | Usuários | NOVO | tenant_admin (escrita), platform_owner (leitura) |
| Administração | Console da Plataforma → aba Faturamento | NOVO | platform_owner |

---

## 2A. Fase 9 — Autenticação Real e Gestão de Usuários

> Evolução da base demo (ADR-005) rumo ao requisito de produção do prompt mestre (OIDC/MFA).
> No sandbox: login por e-mail/senha com sessão httpOnly; o header `x-actor-id` continua
> válido como atalho de demonstração. **Status: ✅ ENTREGUE (Task 14).**

**Objetivo**: credenciais reais (hash scrypt), sessões persistentes revogáveis, enforcement
de tenant desativado (gap documentado na Task 9) e ciclo de vida de usuários do tenant.

### 2A.1 Modelo de dados (adicionais)

| Modelo | Função | Campos-chave |
|---|---|---|
| `User.passwordHash` | Senha scrypt (opcional — atores demo continuam sem senha) | `passwordHash String?` |
| `AuthSession` | Sessão persistida (cookie httpOnly `legis_session`) | `userId`, `tokenHash`, `createdAt`, `expiresAt`, `revokedAt?`, `userAgent?`, `ip?` |

### 2A.2 Rotas de API (novas)

| Rota | Métodos | Descrição |
|---|---|---|
| `/api/v1/auth/login` | POST | `{email, password}` → cookie de sessão httpOnly + ator resolvido |
| `/api/v1/auth/logout` | POST | Revoga a sessão atual |
| `/api/v1/auth/me` | GET | Sessão vigente (para o front montar o ator) |
| `/api/v1/users` · `/:id` | GET, POST, PATCH | Gestão de usuários do tenant (`user.manage`: tenant_admin) |

Resolução do ator passa a ser: **cookie de sessão → x-actor-id (demo) → 401**. Tenant
`active=false` + papel não-platform → `403 TENANT_INACTIVE` (novo código estável).

### 2A.3 Telas

- Gate de entrada: formulário “Entrar com e-mail e senha” ACIMA dos perfis de demonstração.
- Módulo **Usuários** (Administração): tabela com papel/e-mail/status/vínculo, criar usuário
  (com senha inicial), redefinir senha, ativar/desativar, sem excluir (histórico de auditoria).
- Topbar: botão “Sair” quando houver sessão autenticada (volta ao gate).

### 2A.4 Critérios de aceite

- Senha NUNCA é retornada pela API (nem hash); hash scrypt com salt aleatório por usuário.
- Sessão expira (7 dias) e é revogada no logout; token no cookie é hash-SHA256 do registro.
- Usuário desativado perde acesso imediato (401); tenant desativado bloqueia papéis do tenant.
- Papel `parliamentarian` exige vínculo com parlamentar do próprio tenant.

---

## 2B. Fase 10 — Faturamento e Ciclo Comercial do SaaS

> Fecha o ciclo comercial iniciado na Fase 8 (planos/assinaturas): faturas, cobrança simulada,
dunning e métricas de uso. **Status: ✅ ENTREGUE (Task 15).**

### 2B.1 Modelo de dados (adicionais)

| Modelo | Função | Campos-chave |
|---|---|---|
| `Invoice` | Fatura por tenant/período | `tenantId`, `number` (auto `0001/AAAA`), `periodYear`, `periodMonth`, `status` (`draft\|open\|paid\|canceled`), `lines` (JSON), `subtotalCents`, `discountCents`, `totalCents`, `issuedAt`, `dueAt`, `paidAt?`, `paidMethod?`, `notes?` |

### 2B.2 Rotas de API (novas — RBAC `platform.manage`)

| Rota | Métodos | Descrição |
|---|---|---|
| `/api/v1/platform/billing/invoices` | GET, POST | Lista (filtros status/tenant/mês) e geração por tenant/período |
| `/api/v1/platform/billing/cycle` | POST | Executa o ciclo do mês: faturas `open` para assinaturas ativas (plano + excedentes), marca `overdue` vencidas, assinatura `past_due` |
| `/api/v1/platform/billing/invoices/:id/pay` | POST | Registra pagamento `{method}` → `paid`, assinatura volta a `active` |
| `/api/v1/platform/billing/invoices/:id/cancel` | POST | Cancela com justificativa (auditado) |
| `/api/v1/platform/tenants/:id/usage` | GET | Uso do período: sessões, parlamentares ativos, artefatos de IA, entregas de webhook vs. limites do plano |

### 2B.3 Regras de negócio

- Linhas da fatura: mensalidade do plano + excedente de parlamentares acima do limite +
  excedente de sessões/mês (tudo derivado de `Plan.limits` e do uso real).
- `overdue` é computado no ciclo (fatura `open` com `dueAt < hoje`); dunning: notificação
  ao admin do tenant + evento webhook `billing.invoice_overdue`.
- Eventos: `billing.invoice_created`, `billing.invoice_paid`, `billing.invoice_overdue`.
- Fatura paga é imutável (não reabre); cancelamento exige justificativa (auditoria).

### 2B.4 Telas

- Console da Plataforma ganha aba **Faturamento**: KPIs (MRR simulado, inadimplência, faturas
  abertas), botão “Executar ciclo do mês”, tabela de faturas com status/método/vencimento,
  ações pagar/cancelar (AlertDialog), e painel de uso por tenant (limites vs. consumo).

### 2B.5 Critérios de aceite

- Numeração sequencial por tenant sem buracos; fatura paga jamais alterada.
- Ciclo idempotente por tenant/período (não duplica fatura do mesmo mês).
- Nenhum dado de outro tenant vaza no cálculo de uso (isolamento).

---

## 2C. Fase 11 — Publicações Oficiais e Participação Popular

> Diário eletrônico (atas, decretos, resoluções, editais) + audiências públicas com perguntas
> do cidadão moderadas. Fecha o ciclo de transparência do portal (item 7.10/7.11 do mestre).
> **Status: ✅ ENTREGUE (Task 16).**

### 2C.1 Modelo de dados (adicionais)

| Modelo | Função | Campos-chave |
|---|---|---|
| `Publication` | Publicação oficial numerada | `tenantId`, `number` (auto/ano), `kind` (`ata_sessao\|decreto\|resolucao\|portaria\|edital\|ata`), `title`, `contentMd`, `sessionId?`, `matterId?`, `status` (`draft\|published\|revoked`), `publishedAt?`, `revokedAt?`, `revokedReason?`, `verificationCode` |
| `PublicHearing` | Audiência pública | `tenantId`, `title`, `subject`, `matterId?`, `scheduledAt`, `location`, `status` (`scheduled\|open\|closed\|canceled`), `questionsOpen` |
| `HearingQuestion` | Pergunta do cidadão | `hearingId`, `authorName`, `authorEmail?`, `district?`, `question`, `status` (`pending\|approved\|rejected\|answered`), `answer?`, `moderatedBy?`, `answeredAt?` |

### 2C.2 Rotas de API (novas)

| Rota | Métodos | RBAC |
|---|---|---|
| `/api/v1/publications` · `/:id` | GET, POST, PATCH (publicar/revogar/rascunho) | `publication.write` (admin, legislativo) |
| `/api/v1/hearings` · `/:id` | GET, POST, PATCH (agendar/abrir/encerrar/cancelar) | `hearing.write` (admin, legislativo) |
| `/api/v1/hearing-questions/:id` | PATCH (aprovar/rejeitar/responder) | idem (resposta registra `answeredAt`) |
| `/api/v1/public/publications?year=&kind=&q=&page=` | GET | público |
| `/api/v1/public/publications/:id` | GET | público (conteúdo + código de verificação) |
| `/api/v1/public/hearings` · `/:id` | GET | público (perguntas aprovadas/respondidas) |
| `/api/v1/public/hearings/:id/questions` | POST | público (cria `pending`; só quando `questionsOpen`) |

### 2C.3 Regras de negócio

- Publicação numerada automaticamente por ano/tenant (sem buracos); revogação NUNCA apaga —
  marca `revoked` com motivo auditado e o portal mantém o registro histórico.
- Pergunta pública fica `pending` até moderação; rejeitada não aparece no portal; respondida
  exibe pergunta + resposta + data. E-mail é opcional e nunca exibido (LGPD).
- Eventos: `publication.published`, `publication.revoked`, `hearing.opened`,
  `hearing.question_approved` → notificações + webhooks.

### 2C.4 Telas

- Módulo **Publicações e Audiências** (Governança), 3 abas: Publicações (livro numerado,
  criar rascunho, publicar, revogar com motivo) · Audiências (agendar, abrir/encerrar, status
  de perguntas) · Moderação (fila de perguntas pendentes com aprovar/rejeitar/responder).
- Portal Público ganha abas: **Publicações** (pesquisa por ano/tipo/texto + conteúdo com código
  de verificação) e **Audiências** (próximas/em andamento + formulário de envio de pergunta
  + perguntas respondidas).

### 2C.5 Critérios de aceite

- Cidadão SEM credencial consegue enviar pergunta em audiência aberta; pergunta não aparece
  antes da moderação.
- Publicação revogada aparece no portal com selo “Revogada” e motivo (transparência).
- Toda escrita audita (`publication.published`, `hearing.question_answered`, …).

---

## 2D. Fase 12 — Analytics e BI Legislativo

> Camada de leitura agregada sobre dados existentes (sem novos modelos). KPIs de produtividade
> do legislativo para imprensa, presidência e controle interno. **Status: ✅ ENTREGUE (Task 17).**

### 2D.1 Rota de API (nova)

| Rota | Métodos | RBAC | Descrição |
|---|---|---|---|
| `/api/v1/analytics/overview?year=` | GET | `analytics.read` (todos os papéis do tenant) | Payload agregado do ano |

Payload: `attendanceRanking` (presença % por parlamentar com médias), `attendanceBySession`,
`mattersByStatus`, `mattersByType`, `topAuthors`, `proceedingsFlow` (tempo médio por status),
`votingApproval` (taxa de aprovação e resultado por regra), `partyDiscipline` (coesão por
partido em votações nominais), `sessionsByMonth`.

### 2D.2 Telas

- Módulo **Analytics** (Governança): seletor de ano, KPI cards (presença média, matérias
  aprovadas, taxa de aprovação, tempo médio de tramitação), gráficos (recharts via shadcn
  chart): barras de presença por parlamentar, linha de sessões por mês, pizza de matérias por
  status, barras de coesão por partido, tabela de ranking com exportação CSV.

### 2D.3 Critérios de aceite

- Somente leitura — nenhuma rota de analytics escreve no banco.
- Votações secretas NÃO entram na coesão partidária (valor do voto é sigiloso).
- Isolamento: agregações sempre do tenant do ator.

---

## 3. Fase 5 — Estrutura Institucional & Processo Legislativo

> Corresponde à Fase 2 do prompt mestre (itens 7.2 e 7.3). **Status: ✅ ENTREGUE (Task 6).**

**Objetivo**: completar os cadastros institucionais e o ciclo de vida das matérias
(protocolo → tramitação → pauta → deliberação → arquivo), com fluxo configurável e histórico
temporal auditável.

### 3.1 Modelo de dados (adicionais ao schema)

| Modelo | Função | Campos-chave |
|---|---|---|
| `Party` | Partidos políticos do tenant | `acronym`, `name`, `number`, `active` |
| `Bloc` | Blocos parlamentares | `name`, `active`, `partyAcronyms` (JSON) |
| `BoardPosition` | Mesa diretora com vigência | `legislatureId`, `role`, `parliamentarianId`, `startDate`, `endDate?` |
| `Committee` | Comissões permanentes/temporárias | `name`, `acronym`, `kind`, `description`, `active` |
| `CommitteeMember` | Composição da comissão | `committeeId`, `parliamentarianId`, `role`, `startDate`, `endDate?` |
| `CommitteeMeeting` | Reuniões de comissão | `committeeId`, `scheduledAt`, `subject`, `status` |
| `Mandate` | Mandatos por legislatura | `parliamentarianId`, `legislatureId`, `startDate`, `endDate?`, `votes?` |
| `Leave` | Licenças/afastamentos/suplências | `parliamentarianId`, `kind`, `startDate`, `endDate?`, `reason`, `substituteId?` |
| `MatterTypeConfig` | Tipos de matéria configuráveis | `code`, `name`, `defaultRegime`, `active` |
| `Proceeding` | Tramitação append-only | `matterId`, `seq`, `action`, `fromStatus`, `toStatus`, `actorName`, `notes`, `dueAt?` |
| `MatterVersion` | Versões do texto integral | `matterId`, `version`, `text`, `authorName` |
| `MatterAttachment` | Anexos | `matterId`, `name`, `kind`, `sizeBytes`, `url` |
| `ProtocolEntry` | Protocolo de entrada | `number` (auto), `year`, `kind`, `senderName`, `subject`, `matterId?`, `status` |
| `LegislativeTask` | Prazos e pendências | `matterId?`, `title`, `kind`, `dueAt`, `status`, `assigneeName?` |

### 3.2 Rotas de API (novas)

| Rota | Métodos | RBAC (escrita) |
|---|---|---|
| `/api/v1/legislatures` · `/api/v1/legislatures/:id` | GET, POST, PATCH | `structure.write` (admin, legislativo) |
| `/api/v1/parties` · `/:id` | GET, POST, PATCH | idem |
| `/api/v1/blocs` · `/:id` | GET, POST, PATCH | idem |
| `/api/v1/board` (posições da mesa) | GET, POST, PATCH (encerrar vigência) | idem |
| `/api/v1/committees` · `/:id` · `/:id/members` · `/:id/meetings` | GET, POST, PATCH | idem |
| `/api/v1/mandates` · `/api/v1/leaves` | GET, POST, PATCH | idem |
| `/api/v1/matter-types` | GET, POST, PATCH | idem |
| `/api/v1/protocols` · `/:id` | GET, POST (auto-numerado), PATCH (distribuir/arquivar) | `protocol.write` (admin, legislativo) |
| `/api/v1/matters/:id/proceedings` | GET (timeline), POST (registrar despacho/parecer/emenda → transição de status) | `matter.write` |
| `/api/v1/matters/:id/versions` · `/api/v1/matters/:id/attachments` | GET, POST | `matter.write` |
| `/api/v1/tasks` · `/:id` | GET (filtros: status, vencidas), POST, PATCH (concluir) | `task.write` (admin, legislativo, operador conclui) |

Eventos outbox novos: `structure.changed`, `matter.proceeding`, `matter.status_changed`,
`protocol.registered`, `task.due_soon`. Auditoria: toda escrita (`party.update`,
`committee.member_added`, `matter.proceeding`, `protocol.archived`, …).

### 3.3 Telas (módulo `structure` e `workflow`)

- **Estrutura Institucional** (tabs): Legislaturas (CRUD, marcar atual) · Partidos e Blocos ·
  Mesa Diretora (composição vigente + histórico com vigência) · Comissões (composição, funções,
  reuniões) · Mandatos e Afastamentos (timeline por parlamentar).
- **Protocolo e Tramitação** (tabs): Protocolo (livro de protocolo com auto-numeração,
  distribuir/arquivar) · Em Tramitação (matérias por situação com timeline lateral de
  despachos/pareceres e registro de novo andamento com transição de status) · Prazos e Tarefas
  (lista com atraso destacado, concluir, criar).
- Matérias (módulo existente): drawer de detalhe ganha abas Tramitação/Versões/Anexos.
- Dashboard: ganha cartões de pendências (prazos vencidos, protocolos pendentes, matérias paradas).

### 3.4 Critérios de aceite

- Legislatura atual direciona defaults de mandato/comissão; histórico preservado (nunca editado).
- Transição de status de matéria SOMENTE via `Proceeding` (sem CRUD direto de status) e reflete
  no portal público (fase 6) e na pauta (aviso se matéria sair de tramitação após publicação).
- Protocolo auto-numerado por ano, sem buracos por tenant; anulação exige justificativa auditada.
- Timeline de tramitação append-only, ordenada por `seq`, exibida no espelho da matéria.

---

## 4. Fase 6 — Portal Público Completo, Dados Abertos, Notificações e Webhooks

> Corresponde à Fase 5 do prompt mestre (itens 7.10, 7.11 e 7.12). **Status: ✅ ENTREGUE (Task 7).**

**Objetivo**: transformar o portal em canal definitivo de transparência (pesquisa, histórico,
dados abertos), adicionar comunicação interna (notificações) e integração externa (webhooks
HMAC) e gerar minuta de ata.

### 4.1 Modelo de dados (adicionais)

| Modelo | Função | Campos-chave |
|---|---|---|
| `WebhookEndpoint` | Inscrições de integração | `url`, `secret`, `events` (JSON), `active`, `description` |
| `WebhookDelivery` | Entregas com retentativa | `endpointId`, `eventType`, `payload`, `signature`, `status` (`pending/success/failed/dead`), `attempts`, `lastError?`, `responseStatus?` |
| `Notification` | Notificações internas | `title`, `body`, `kind`, `module?`, `actorRole?` (destinatário por papel), `readAt?` |

### 4.2 Rotas públicas (sem autenticação, `?tenant=slug`)

| Rota | Descrição |
|---|---|
| `GET /api/v1/public/matters?type=&year=&status=&author=&q=&page=&pageSize=` | Pesquisa de matérias com paginação por cursor simples (retorna `nextCursor`) |
| `GET /api/v1/public/matters/:id` | Detalhe público: ementa, autores, situação, tramitação (pública), resultado de votação nominal |
| `GET /api/v1/public/sessions?year=&status=` | Sessões futuras/em andamento/históricas |
| `GET /api/v1/public/sessions/:id` | Pauta publicada, presença consolidada, resultados, discursos |
| `GET /api/v1/public/open-data?dataset=matters\|sessions\|attendance\|votes&format=json\|csv` | Dados abertos (somente dados publicáveis) |
| `GET /api/v1/public/sitemap.xml` | Sitemap básico de sessões e matérias publicadas |

### 4.3 Rotas internas

- `GET /api/v1/notifications?unread=&limit=` · `POST /api/v1/notifications/:id/read` ·
  `POST /api/v1/notifications/read-all` · `POST /api/v1/notifications` (broadcast manual,
  admin). Sino no topbar com contador, popover com lista (max-h + scroll) e marcar-como-lida.
- `GET|POST /api/v1/webhooks` · `PATCH /api/v1/webhooks/:id` · `GET /api/v1/webhooks/:id/deliveries` ·
  `POST /api/v1/webhooks/:id/test` · `POST /api/v1/webhooks/deliveries/:id/replay` (reenvio auditado).
- `GET /api/v1/reports/session/:id/ata` — minuta de ata estruturada (expediente, presença
  consolidada, oradores, votações nominais, encerramento) em HTML imprimível + JSON.

### 4.4 Mini-serviço de webhooks (`mini-services/webhooks`, porta 3004)

- Poller de `WebhookDelivery` `pending`: assinatura HMAC-SHA256 (`x-legis-signature: sha256=…`,
  `x-legis-timestamp` anti-replay), POST com timeout 10s, `2xx` = success; falha → backoff
  exponencial (tentativas 1–5; após 5 → `dead` = dead-letter), tudo persistido.
- Gatilho: fases de negócio gravam `WebhookDelivery` na mesma transação quando o evento
  público casa com um endpoint ativo inscrito no eventType.
- Endpoint de eco local (`POST /api/v1/webhooks/echo`) permite demonstração ponta a ponta sem
  internet. Health check `GET /health` (padrão do gateway, `?XTransformPort=3004`).

### 4.5 Notificações — gatilhos

`session.scheduled`, `session.opened/closed`, `voting.opened/closed` (resultado),
`task.due_soon` (vence em 48h), `webhook.dead` (entrega em dead-letter), `migration.finished`.
Destinatários por papel; sino com badge de não lidas; evento realtime `notification.new`.

### 4.6 Telas

- **Portal Público** (tabs): Ao Vivo (existente) · Pesquisa de Matérias · Sessões (histórico com
  detalhe público) · Dados Abertos (download JSON/CSV + link de API) · Sobre o painel de
  transparência.
- **Webhooks** (novo módulo, grupo Governança): lista de endpoints (ativo/inativo, segredo
  mascarado), criar/editar com seleção de eventos, entregas com status/tentativas/erro,
  botões Testar (cria entrega imediata) e Reprocessar, badge de entregas mortas.
- **Relatórios**: nova aba "Minuta de Ata" com visualização imprimível.

### 4.7 Critérios de aceite

- Dados abertos expõem apenas dados publicáveis (sem votos secretos nominais, sem dados
  pessoais além do público: nome/partido/bancada do parlamentar em seu papel público).
- Webhook entregue possui assinatura verificável (documentada com exemplo de verificação).
- Notificações nunca expõem conteúdo sigiloso; leitura é individual por ator (demo: por papel).
- Ata reflete exclusivamente dados persistidos da sessão (nenhum dado improvisado).

---

## 5. Fase 7 — IA Assistiva & App do Parlamentar (PWA)

> Corresponde às Fases 4 (PWA) e 8 (IA) do prompt mestre (itens 7.8 e 7.13).
> **Status: ✅ ENTREGUE (Task 8).**

**Objetivo**: assistência de IA em fluxos de geração de documentos (sempre com revisão humana
obrigatória) e o app mobile-first do parlamentar (presença, voto e fila de oradores).

### 5.1 Modelo de dados

| Modelo | Função | Campos-chave |
|---|---|---|
| `AiArtifact` | Artefatos de IA com rastreabilidade | `kind` (`ata_draft\|ementa\|proceedings_summary\|transcript\|ocr_text`), `sessionId?`, `matterId?`, `input`, `output`, `model`, `provider`, `status` (`draft\|approved\|rejected`), `reviewedBy?`, `reviewedAt?`, `tokens?` |

### 5.2 Rotas de IA (backend, z-ai-web-dev-sdk — proibido no cliente)

| Rota | Função | Skill |
|---|---|---|
| `POST /api/v1/ai/ata-draft {sessionId}` | Minuta de ata a partir dos dados persistidos | LLM |
| `POST /api/v1/ai/ementa {matterId?}` | Sugestão de ementa + classificação temática | LLM |
| `POST /api/v1/ai/proceedings-summary {matterId}` | Resumo da tramitação | LLM |
| `POST /api/v1/ai/transcribe {audioBase64, mimeType}` | Transcrição de áudio da sessão | ASR |
| `POST /api/v1/ai/ocr {imageBase64}` | Extração de texto de documento fotografado | VLM |
| `GET /api/v1/ai/artifacts?kind=&sessionId=&matterId=` | Galeria de artefatos com status |
| `POST /api/v1/ai/artifacts/:id/review {decision, justification?}` | Aprovar/rejeitar (auditoria `ai.artifact_reviewed`) |

Regras invioláveis (prompt mestre 7.13): todo artefato exibe origem (modelo/provedor/versão),
horário e responsável; **nenhuma aprovação/publicação/transição é automática**; IA nunca vota,
publica ou altera resultado. RBAC: `ai.use` (admin, legislativo, operador) e revisão
`ai.review` (admin, legislativo).

### 5.3 App do Parlamentar — rotas `/api/v1/me/*`

| Rota | Função |
|---|---|
| `GET /api/v1/me/context` | Contexto vivo: sessão em andamento, minha presença, votação aberta + meu voto, minha posição na fila, estatísticas pessoais |
| `POST /api/v1/me/check-in` | Auto check-in (`source: 'pwa'`; habilitado por configuração do tenant `allowSelfCheckIn`) |
| `POST /api/v1/me/vote {votingId, value, commandId}` | Voto próprio (idempotente por `commandId`; parlamentar deve estar presente) |
| `POST /api/v1/me/speech {kind, subject?, side?}` | Entrar na fila de oradores |
| `GET /api/v1/me/history` | Histórico pessoal de presenças e votos |

RBAC: papel `parliamentarian` com `parliamentarianId` vinculado (o ator demo já é o vereador).

### 5.4 Telas

- **App do Parlamentar** (módulo `pwa`): layout mobile-first (funciona no desktop como painel),
  cartões grandes: sessão atual (status + quórum + botão "Registrar presença" quando permitido),
  votação aberta (Sim/Não/Abstenção grandes, confirmação, meu voto registrado, alteração se
  política permitir), Fila de oradores (minha posição, pedir a palavra), Meu histórico
  (presenças/votos por sessão). Status de conexão em tempo real sempre visível.
- **Relatórios → Minuta de Ata**: botão "Gerar com assistência de IA" → artefato em rascunho →
  revisão (aprovar/rejeitar com justificativa) → ata aprovada disponível para publicação.
- **Matérias → detalhe**: "Sugerir ementa com IA" (com diff manual, nunca aplicado sozinho) e
  timeline com "Resumir tramitação".

### 5.5 Critérios de aceite

- Artefato reprovado jamais aparece como documento oficial; aprovado registra revisor + auditoria.
- Voto do PWA passa pelas MESMAS regras do operador (presença, sessão aberta, idempotência,
  alteração conforme configuração) — zero atalhos.
- Transcrição/OCR registram modelo e horário; saída é sempre rascunho editável.

---

## 6. Fase 8 — Console da Plataforma (SaaS) & Importador de Migração

> Corresponde às Fases 1 (console/planos, remanescente) e 7 (migração) do prompt mestre
> (itens 7.1 e 14). **Status: ✅ ENTREGUE (Task 9).**

**Objetivo**: operação multiempresa pelo `platform_owner` (tenants, planos, entitlements, uso,
health score) e importador auditado do PainelDeskLegis com pipeline completo.

### 6.1 Modelo de dados

| Modelo | Função | Campos-chave |
|---|---|---|
| `Plan` | Planos comerciais | `name`, `priceCents`, `limits` (JSON: máx. vereadores, sessões/mês, features) |
| `Subscription` | Assinatura do tenant | `tenantId`, `planId`, `status` (`trial\|active\|past_due\|canceled`), `trialEndsAt`, `currentPeriodEnd` |
| `MigrationRun` | Execução do importador | `tenantId`, `stage`, `status`, `stats` (JSON), `report` (JSON), `startedAt/finishedAt` |
| `MigrationMapping` | Mapa id legado → novo | `runId`, `sourceTable`, `sourceId`, `targetModel`, `targetId` |
| `MigrationIssue` | Divergências e avisos | `runId`, `severity` (`info\|warn\|error`), `sourceRef`, `message` |

### 6.2 Rotas do console (RBAC `platform.*` — apenas `platform_owner`)

- `GET /api/v1/platform/overview` — KPIs globais (tenants ativos, sessões/mês, votos,
  eventos publicados, entregas de webhook falhando).
- `GET /api/v1/platform/tenants` — lista com uso (contagens), assinatura, health score
  (composto: atividade recente + falhas).
- `POST /api/v1/platform/tenants` — onboarding: cria tenant + legislatura + usuário admin +
  assinatura trial (white-label default).
- `PATCH /api/v1/platform/tenants/:id` — ativar/desativar, trocar plano (entitlements).
- `GET|POST /api/v1/platform/plans` — CRUD de planos com limits.

Entitlements: helper server-side `tenantEntitled(tenantId, feature)` lê `Plan.limits.features`;
recurso gateado de exemplo: `ai_assist` (plano profissional+). Configurações exibe o plano e
recursos habilitados do tenant.

### 6.3 Importador (pipeline do prompt mestre, item 14)

Estágios `inspect → validate → plan → dry_run → import → reconcile → report → rollback`
executados por `POST /api/v1/migration/run {stage, runId?}`, com `GET /api/v1/migration/runs`
e `GET /api/v1/migration/runs/:id`.

- **Fonte demo**: pacote sintético `upload/legacy/` simulando export do HSQLDB do
  PainelDeskLegis 8.1 (`manifest.json` + CSVs: parlamentares, partidos, sessoes, presencas,
  proposicoes, votacoes, votos) — gerado por script versionado, dados fictícios 2021–2024,
  com sujeira realista (datas inválidas, órfãos, duplicidades) para exercitar `validate`.
- **Mapeamento** preserva ID legado em `MigrationMapping` (nunca como PK nova); transformações
  registradas; conflitos nunca resolvidos silenciosamente (viram `MigrationIssue`).
- **Reconcile** compara contagens por tabela + amostras + checksums; **report** gera resumo
  JSON/HTML com divergências; **rollback** remove apenas dados do `runId` (bloqueado se
  homologado — flag no run).
- Nenhum voto/presença/resultado ausente é deduzido — viram issue `warn` para homologação.

### 6.4 Telas

- **Console da Plataforma** (grupo Administração, visível só a `platform_owner`): KPIs,
  tabela de tenants (uso, plano, health score com ícone+texto, ativar/desativar), dialog de
  onboarding de nova Câmara, CRUD de planos.
- **Migração de Dados** (Administração): wizard com os 8 estágios (cada um com resultado
  real: contagens, issues por severidade, amostras), lista de execuções, relatório final,
  rollback com confirmação reforçada.

### 6.5 Critérios de aceite

- Isolamento: tenant B nunca vê dados do tenant A (rotas platform enxergam apenas métricas
  agregadas, nunca conteúdo legislativo de outro tenant).
- Re-import idempotente: mappings existentes não duplicam.
- Rollback remete exatamente aos dados do run e é auditado.

---

## 7. Limitações declaradas do ambiente sandbox (fora de escopo)

| Item do prompt mestre | Situação no sandbox |
|---|---|
| Monorepo pnpm/Turborepo, NestJS, PostgreSQL/RLS, Redis/BullMQ, S3 | Substituídos por Next.js 16 App Router + Prisma/SQLite + mini-serviços Bun (ADR-001) |
| Agente local Tauri/Rust e operação offline | Não executável no sandbox; o modo degradado é coberto pela reconstrução por snapshot do telão e idempotência de comandos (ADR-003) |
| OIDC/MFA reais | RBAC demo via `x-actor-id` (ADR-005), matriz idêntica à de produção |
| Voto secreto com desenho criptográfico revisado | Implementado como sigilo operacional (valor jamais exposto); revisão criptográfica documentada como requisito de produção |
| Testcontainers/k6/axe CI | Verificação E2E com agent-browser + lint + testes de fluxo reais executados manualmente |

Essas limitações NÃO são dívida oculta: estão registradas nos ADRs e no `docs/runbook.md`,
com o caminho de migração para produção.

---

## 8. Pacote de documentação do produto

| Documento | Conteúdo | Status |
|---|---|---|
| `README.md` | Visão geral, stack, como executar, índice da documentação | ✅ Entregue |
| `docs/ROADMAP.md` | Este documento — plano de continuidade e mapa de funcionalidades | ✅ Este (fases 5–12 concluídas) |
| `docs/api-contract.md` | Contrato completo REST + eventos (fonte única de verdade) | ✅ Atualizado (fases 5–12) |
| `docs/adr/ADR-001..009` | Decisões de arquitetura (fases 1–8) | ✅ Entregues |
| `docs/adr/ADR-010..013` | Autenticação real · faturamento simulado · publicações/participação · analytics somente-leitura | ✅ Entregues |
| `docs/adr/ADR-006` | IA assistiva: rastreabilidade e revisão humana obrigatória | ✅ Entregue |
| `docs/adr/ADR-007` | Webhooks HMAC, retentativas e dead-letter | ✅ Entregue |
| `docs/adr/ADR-008` | Importador de migração com pipeline auditável | ✅ Entregue |
| `docs/adr/ADR-009` | PWA do parlamentar e endpoints `/me` | ✅ Entregue |
| `docs/user-manual.md` | Manual do usuário por perfil (operador, presidência, admin, auditor, parlamentar, plataforma) cobrindo TODOS os módulos | ✅ Atualizado (fases 9–12) |
| `docs/runbook.md` | Runbook operacional: subir ambiente, health checks, backup/restauração SQLite, sessão offline, restart de serviços, troubleshooting | ✅ Entregue |
| `docs/CHANGELOG.md` | Changelog por fase (padrão Keep a Changelog) | ✅ Entregue |
| `docs/test-report.md` | Relatório objetivo de testes executados (reais), falhas e riscos remanescentes | ✅ Entregue |
| `docs/migration-importer.md` | Guia do importador (fontes, estágios, homologação, rollback) | ✅ Entregue |
| `docs/adr/ADR-022..025` | Onda 5 — prontidão para produção · MFA/assinatura eletrônica · chaves de API · crescimento do SaaS | 🗓 Planejado (§12, Tasks 34–35) |

> Pacote documental em produção: a documentação VIVA é servida dentro do produto pela
> **Central de Ajuda** (Fase 15, ADR-016 — guias por papel, FAQ, glossário, changelog e
> índice de documentos) e, desde a v0.12.0, pelo módulo **Planejamento e Roadmap**
> (estado entregue, mapa-alvo, fases e pacote documental).

---

## 9. Ordem de execução e rastreabilidade

| Task | Fase | Executor | Dependências |
|---|---|---|---|
| 5 | Plano (este documento) | main | — |
| 6 | Fase 5 — Estrutura + Protocolo/Tramitação | ✅ subagente + main | Task 5 |
| 7 | Fase 6 — Portal completo + Notificações + Webhooks + Ata | ✅ subagente + main | Task 6 |
| 8 | Fase 7 — IA assistiva + PWA parlamentar | ✅ subagente + main | Task 7 |
| 9 | Fase 8 — Console SaaS + Importador | ✅ subagente + main | Task 8 |
| 10 | Documentação completa | ✅ main | Tasks 6–9 |
| 11 | Verificação E2E final + worklog | ✅ main | Task 10 |
| 12 | Plano das Fases 9–12 (este documento, §2A–2D) | main | Task 11 |
| 13 | Schema Prisma das Fases 9–12 + db:push | main | Task 12 |
| 14 | Fase 9 — Autenticação real + Usuários | ✅ subagente + main | Task 13 |
| 15 | Fase 10 — Faturamento + ciclo comercial | ✅ subagente + main | Task 13 |
| 16 | Fase 11 — Publicações + Audiências | ✅ subagente + main | Task 13 |
| 17 | Fase 12 — Analytics/BI | ✅ subagente + main | Task 13 |
| 18 | Integração (store/sidebar/page/seed) + lint | ✅ main | Tasks 14–17 |
| 19 | Verificação E2E final + documentação (ADR-010..013) + worklog | ✅ main | Task 18 |

Cada fase encerra com: código funcional, migration executada (`db:push`), seed estendido,
`bun run lint` limpo, verificação real via agent-browser e registro no `worklog.md`.

---

## 10. Onda 3 — Fases 13–16: produtividade, padronização documental, adoção e operação SaaS

> Planejamento da continuidade após a v0.9.0 (fases 0–12). Origem das fases: lacunas REAIS do
> prompt mestre ainda não entregues — **calendários** (§7.2), **templates versionados por
> tenant** (§7.10), **exportação integral e encerramento seguro do tenant** (§7.1),
> **painel operacional e alertas** (§15) — somadas à **documentação viva dentro do produto**
> (onboarding/suporte, §7.1), exigência explícita de pacote de documentação acompanhando o
> sistema.

### 10.0 Mapa-alvo de menus e páginas (TO-BE v3 — 22 módulos)

```
Operação
├── Painel
├── Agenda Legislativa              (NOVO — Fase 13: calendário unificado de sessões,
│                                    audiências, reuniões de comissão e prazos)
├── Sessões
├── Mesa do Plenário
├── Telão
└── App do Parlamentar (PWA)

Processo Legislativo
└── Protocolo e Tramitação

Cadastros
├── Parlamentares
├── Matérias
└── Estrutura Institucional

Governança
├── Auditoria
├── Relatórios
├── Publicações e Audiências        (ganha "criar a partir de modelo" — Fase 14)
├── Analytics
├── Portal Público
└── Webhooks

Administração
├── Usuários
├── Modelos de Documento            (NOVO — Fase 14: templates versionados por tenant)
├── Configurações
├── Console da Plataforma           (ganha aba Sistema — Fase 16: observabilidade,
│                                    exportação integral e encerramento seguro)
└── Migração de Dados

Ajuda
└── Central de Ajuda                (NOVO — Fase 15: documentação in-app por perfil,
                                     glossário, FAQ, atalhos e novidades)
```

Componente transversal novo: **command palette global (⌘K/Ctrl+K)** na topbar — navegação
entre módulos + pesquisa unificada de matérias, sessões, parlamentares e publicações (Fase 13).

### 10.1 Fase 13 — Agenda Legislativa & Pesquisa Unificada

> Fecha a lacuna de calendário (§7.2 do prompt mestre) e adiciona produtividade de busca
> interna. **ADR-014. Status: ✅ ENTREGUE (Task 22-a).**

**Objetivo**: visão única do calendário operacional da Casa (sessões, audiências, reuniões de
comissão e prazos de tarefas) e pesquisa global instantânea (⌘K) para qualquer papel
autenticado.

#### Modelo de dados

Nenhum modelo novo — agregação somente-leitura sobre `Session`, `PublicHearing`,
`CommitteeMeeting` e `LegislativeTask`.

#### Rotas de API (novas — qualquer papel do tenant, escopo derivado server-side)

| Rota | Métodos | Descrição |
|---|---|---|
| `/api/v1/calendar?year=&month=` | GET | Eventos do mês: `{id, kind, title, date, status, meta}` com `kind ∈ session\|hearing\|committee_meeting\|task_deadline` |
| `/api/v1/search?q=` | GET | Top-5 por seção: matérias, sessões, parlamentares e publicações (`{query, sections[]}`) |

#### Telas

- Módulo **Agenda Legislativa** (Operação): grade mensal (date-fns, pt-BR, semana iniciando em
  domingo), chips por tipo com ícone + cor + texto (nunca só cor), painel lateral do dia
  selecionado com detalhes e ação "Ir para…" (navega ao módulo correspondente, ex. prazo →
  Protocolo e Tramitação), filtros por tipo, navegação anterior/próximo/Hoje e seção "Próximos
  eventos" (próximos 7 dias).
- **Command palette** (`src/components/app/command-palette.tsx`): abre com ⌘K/Ctrl+K ou botão
  "Pesquisar" na topbar; grupos Navegação (módulos, filtrados) + Resultados (API com debounce
  300ms e mínimo de 2 caracteres); Enter navega; ESC fecha; skeletons e estado vazio.

#### Critérios de aceite

- Somente leitura; nenhum dado de outro tenant é retornado (escopo derivado do ator).
- Prazos (`task_deadline`) incluem apenas tarefas PENDENTES (concluídas não poluem a agenda).
- Palette 100% navegável por teclado (cmdk) e acessível a leitores de tela (roles ARIA).

### 10.2 Fase 14 — Modelos de Documento versionados por tenant

> Fecha a lacuna "Templates versionados por tenant" (§7.10). **ADR-015. Status: ✅ ENTREGUE (Task 23-a).**

**Objetivo**: padronizar a redação de atas, decretos, editais, portarias, resoluções e
ofícios com placeholders e histórico de versões append-only; alimentar o módulo Publicações.

#### Modelo de dados (adicionais)

| Modelo | Função | Campos-chave |
|---|---|---|
| `DocumentTemplate` | Cabeçalho do modelo | `tenantId`, `name`, `kind` (`ata_sessao\|decreto\|resolucao\|portaria\|edital\|oficio`), `description?`, `active`, `currentVersion`, `createdAt/updatedAt` |
| `DocumentTemplateVersion` | Versão append-only do corpo | `templateId`, `version` (único por template), `bodyMd`, `changeNote?`, `authorName`, `createdAt` |

#### Rotas de API (novas — RBAC `template.write`: tenant_admin, legislative_admin)

| Rota | Métodos | Descrição |
|---|---|---|
| `/api/v1/templates` | GET, POST | Lista (kind/ativo/versão atual) e criação (v1) |
| `/api/v1/templates/:id` | GET, PATCH | Detalhe com versões; ações `edit` (nome/descrição/ativo), `new_version` (bodyMd + changeNote → v+1), `restore` (nova versão com corpo de versão anterior) |
| `/api/v1/templates/:id/render` | POST | Preview com placeholders resolvidos (`{rendered, unresolved[]}`); contexto opcional `{sessionId?, matterId?}` |

Placeholders suportados: `{{camara}}`, `{{cidade}}`, `{{uf}}`, `{{data}}`, `{{hora}}`, `{{ano}}`,
`{{sessao.numero}}`, `{{sessao.data}}`, `{{sessao.tipo}}`, `{{materia.titulo}}`,
`{{materia.ementa}}`, `{{materia.autores}}`. Desconhecidos NÃO falham o render — retornam em
`unresolved` para revisão humana.

#### Regras de negócio

- Histórico append-only: versões nunca são editadas nem apagadas; `restore` cria versão NOVA.
- Desativação não exclui (modelos podem lastrear publicações já emitidas).
- Auditoria: `template.created`, `template.updated`, `template.version_added`,
  `template.deactivated`, `template.rendered`. Sem eventos outbox/webhooks (consumidor
  interno — decisão registrada no ADR-015).
- Render não interpola HTML: corpo é Markdown puro, renderizado no front com react-markdown
  (sanitizado) — coerente com §7.10 do mestre.

#### Telas

- Módulo **Modelos de Documento** (Administração): lista com tipo/versão/ativo, criar/editar
  (nome, tipo, descrição, corpo Markdown com painel de placeholders clicáveis), histórico de
  versões em timeline (autor + nota de mudança + restaurar) e preview renderizado ao vivo.
- **Publicações**: dialog "Nova publicação" ganha "Criar a partir de modelo" (modelos ativos
  do tipo escolhido; corpo renderizado no SERVIDOR com contexto de sessão/matéria).

#### Critérios de aceite

- Versão sequencial sem buracos por template; edição de corpo SEMPRE gera nova versão.
- Publicação criada a partir de modelo registra origem na auditoria (`template.rendered`).
- Isolamento por tenant (template de outro tenant → 404 sem vazar existência).

### 10.3 Fase 15 — Central de Ajuda e Documentação In-App

> Transforma a documentação (hoje apenas em arquivos do repositório) em documentação VIVA
> dentro do produto — onboarding por perfil e suporte de primeiro nível (§7.1). **ADR-016.
> Status: ✅ ENTREGUE (Task 22-b).**

**Objetivo**: reduzir o atrito de adoção: guias por papel, glossário legislativo, FAQ,
atalhos e novidades do produto consultáveis sem sair do sistema.

#### Modelo de dados

Nenhum — conteúdo versionado com o código em `src/lib/server/help-content.ts` (fonte única,
editada junto com o release que documenta).

#### Rota de API (nova — qualquer papel autenticado)

| Rota | Métodos | Descrição |
|---|---|---|
| `/api/v1/help` | GET | `{guides[], glossary[], faq[], shortcuts[], changelog[], about}` — conteúdo estruturado da central |

#### Telas

- Módulo **Central de Ajuda** (grupo Ajuda, visível a todos): abas **Primeiros passos** (guia
  do papel do ator com passos e módulos relacionados + seletor para outros papéis),
  **Glossário** (termos legislativos com busca instantânea), **Perguntas frequentes**
  (accordion), **Atalhos** (tabela incl. ⌘K), **Novidades** (timeline das versões
  0.1.0→0.10.0) e **Sobre** (visão da arquitetura + índice dos documentos do produto).
- Busca local unificada no topo da central (filtra glossário + FAQ + guias simultaneamente).

#### Critérios de aceite

- Conteúdo acompanha o código (nada hardcoded no front; vem da API).
- Nenhum dado sensível ou credencial é exposto; guias orientam, mas o RBAC real é server-side.
- Acessível: accordions ARIA, busca com rótulo, navegação por teclado.

### 10.4 Fase 16 — Observabilidade, Exportação Integral e Encerramento Seguro

> Fecha as lacunas do prompt mestre §15 (painel operacional/alertas) e §7.1 (exportação
> integral e encerramento seguro do tenant). **ADR-017. Status: ✅ ENTREGUE (Task 23-b).**

**Objetivo**: dar ao `platform_owner` visibilidade operacional quase em tempo real do SaaS e
concluir o ciclo de vida comercial do tenant (onboarding → operação → exportação →
encerramento formal).

#### Rotas de API (novas — RBAC `platform.manage`)

| Rota | Métodos | Descrição |
|---|---|---|
| `/api/v1/platform/system-status` | GET | Health dos mini-serviços (3003/3004, com latência e timeout curto), tamanho do banco/WAL, filas (outbox pendente + idade do mais antigo; entregas de webhook pendentes/mortas), atividade (tenants ativos, sessões hoje, último evento auditado), runtime (uptime, memória) e `alerts[]` derivados |
| `/api/v1/platform/tenants/:id/export` | POST | Exportação INTEGRAL do tenant em JSON para download (sem hashes de senha, sem tokens, sem segredos de webhook, sem valores de voto SECRETO) + auditoria `platform.tenant_exported` |
| `/api/v1/platform/tenants/:id/close` | POST | Encerramento formal `{justification ≥ 10, confirm: 'ENCERRAR'}`: tenant `active=false` + revoga TODAS as sessões + assinatura `canceled` + auditoria `platform.tenant_closed` |

#### Regras de negócio

- Exportação nunca inclui segredos: `passwordHash`, tokens de `AuthSession`, `secret` de
  webhooks e VALORES de votos secretos (participação incluída, valor jamais — coerente com o
  resto do sistema).
- Encerramento NÃO apaga dados (retenção LGPD + cadeia de auditoria); reversível apenas por
  reativação auditada; tenant encerrado passa a responder `403 TENANT_INACTIVE` (Fase 9).
- Health checks com timeout curto (`AbortSignal.timeout` 2s) — a rota nunca trava por serviço
  caído; serviço parado aparece como "parado", não como erro 500.

#### Telas

- Console da Plataforma → nova aba **Sistema**: cards por verificação (status OK/degradado/
  parado com ícone + texto, latência, tamanho), filas com contadores, `alerts[]` em destaque
  (banner por alerta com ação sugerida), botão "Verificar novamente" (refetch) e nota de
  restart dos serviços (referência ao runbook).
- Aba Visão Geral → ações por tenant: **Exportar dados** (download JSON no navegador) e
  **Encerrar** (AlertDialog com justificativa obrigatória e digitação de "ENCERRAR" — mesmo
  padrão da homologação do importador).

#### Critérios de aceite

- Painel reflete a realidade: serviço parado → card "parado" (nunca 500 na rota).
- Export da Vila Nova contém TODAS as entidades do tenant (verificável por contagens).
- Encerrar exige confirmação digitada; após encerrar, usuários do tenant recebem 403 e a
  assinatura aparece como cancelada no Faturamento.

### 10.5 Ordem de execução (Tasks 20–25)

| Task | Fase | Executor | Dependências |
|---|---|---|---|
| 20 | Planejamento das Fases 13–16 (este §10) | ✅ main | — |
| 21 | Base compartilhada: schema `DocumentTemplate(+Version)` + db:push, `ModuleId`s, RBAC `template.write` espelhado, sidebar (22 módulos), page.tsx + stubs, topbar + stub do command palette, seed de 5 modelos | ✅ main | Task 20 |
| 22-a | Fase 13 — Agenda Legislativa + pesquisa unificada + command palette | ✅ subagente | Task 21 |
| 22-b | Fase 15 — Central de Ajuda (conteúdo + rota + módulo) | ✅ subagente | Task 21 |
| 23-a | Fase 14 — Modelos de documento (domínio + rotas + módulo + integração Publicações) | ✅ subagente | Task 21 |
| 23-b | Fase 16 — Observabilidade + exportação + encerramento | ✅ subagente | Task 21 |
| 24 | Integração final, reseed da base demo, `bun run lint` | ✅ main | Tasks 22–23 |
| 25 | Verificação E2E (agent-browser) + pacote de documentação (ADR-014..017, api-contract, user-manual, CHANGELOG 0.10.0, test-report, README, runbook) + worklog | ✅ main | Task 24 |

---

## 11. Onda 4 — Fases 17–20: maturidade do processo legislativo, confiança da votação, participação pública e operação/suporte

> Planejamento da continuidade após a v0.10.0 (Ondas 1–3, fases 0–16, 22 módulos). Origem:
> lacunas REAIS do prompt mestre ainda não entregues — **emendas/substitutivos/vetos/sanções e
> relacionamentos entre matérias** (§7.3), **opções de votação customizadas, declaração de voto
> e recibo verificável** (§7.7), **canal de acompanhamento do cidadão, verificação de
> documentos públicos por código e rate limit** (§7.11/§7.10/§11), **impersonação de suporte
> auditada** (§5/§6), **alertas persistentes** (§15) e **exportação assíncrona com progresso**
> (§7.10) — consolidando o SAAS como produto operável e auditável de ponta a ponta.

### 11.0 Mapa-alvo de menus e páginas (TO-BE v4 — 23 módulos)

```
Operação
├── Painel                        (existente)
├── Agenda Legislativa            (existente)
├── Sessões                       (existente)
├── Mesa do Plenário              (ganha: opções customizadas de votação + recibos)
├── Telão                         (ganha: rótulos das opções customizadas)
└── App do Parlamentar (PWA)      (ganha: recibo do voto nominal)

Processo Legislativo
└── Protocolo e Tramitação        (existente)

Cadastros
├── Parlamentares                 (existente)
└── Matérias                      (ganha: relacionamentos, emendas/substitutivos,
                                   desfechos de sanção/veto com prazo)

Governança
├── Auditoria                     (existente)
├── Relatórios                    (existente)
├── Publicações e Audiências      (ganha: código de verificação consultável)
├── Analytics                     (existente)
├── Portal Público                (ganha: aba Acompanhar — assinatura do cidadão —
│                                    e verificação de autenticidade de documentos)
└── Acompanhamentos (Webhooks)    (existente)

Administração
├── Usuários                      (existente)
├── Configurações                 (existente)
├── Console da Plataforma         (ganha: alertas persistentes com reconhecimento e
│                                    exportação assíncrona com progresso)
├── Migração de Dados             (existente)
├── Modelos de Documento          (existente)
└── Suporte da Plataforma         (NOVO — Fase 20: impersonação auditada com banner
                                    e prazo, alertas ativos, saúde resumida)

Ajuda
└── Central de Ajuda              (existente — conteúdo estendido à v0.11.0)
```

### 11.1 Fase 17 — Ciclo de vida da matéria: relacionamentos, emendas, substitutivos, veto e sanção

> Fecha a lacuna do prompt mestre §7.3 ("Despachos, pareceres, **emendas, substitutivos, vetos
> e sanções**" e "relacionamentos"). **ADR-018. Status: ✅ ENTREGUE (Task 28-a).**

**Objetivo**: material formalizado do ciclo pós-aprovação — a matéria aprovada recebe sanção
ou veto (com prazo configurável de 15 dias úteis), emendas e substitutivos são vinculados à
matéria principal, e relacionamentos (altera/revoga/regula/subsidiária) ficam rastreáveis.

#### Modelo de dados (adicionais)

| Modelo | Campos-chave | Regras |
|---|---|---|
| `RelatedMatter` | `matterId`, `relatedMatterId`, `kind ∈ altera\|revoga\|regula\|subsidiaria\|emenda\|substitutivo`, `notes?` | append-only; par único `(matterId, relatedMatterId)`; emenda/substitutivo → a filiada NÃO tramita sozinha no fluxo da principal |
| `MatterOutcome` | `matterId`, `kind ∈ sancao\|veto_total\|veto_parcial`, `actorName`, `date`, `notes?`, `dueAt?` | append-only; exige matéria `aprovado`; `veto_*` agenda `LegislativeTask` de apreciação do veto |

`MatterStatus` ganha `sancionado | vetado` (transições: `aprovado → sancionado|vetado`
somente via outcome, nunca por edição direta).

#### Rotas de API (novas)

| Rota | Métodos | RBAC | Descrição |
|---|---|---|---|
| `/api/v1/matters/:id/related` | GET/POST/DELETE | `matter.write` (leitura: todos do tenant) | Lista/vincula/desvincula relacionamentos com validação de auto-referência e ciclo |
| `/api/v1/matters/:id/outcomes` | GET/POST | `matter.write` (leitura: todos) | Registra sanção/veto (justificativa obrigatória no veto), transiciona a matéria e audita `matter.outcome` |

`GET /api/v1/matters/:id` (detalhe) passa a incluir `related[]` e `outcomes[]`;
`GET /api/v1/public/matters/:id` publica desfecho quando existente (transparência).

#### Telas

- **Matérias → drawer da matéria**: seções "Relacionamentos" (tabela com tipo, matéria-alvo,
  nota, ações de desvincular com confirmação) e "Desfecho" (badge Sanção/Veto + timeline
  com prazo); dialog "Vincular matéria" com seletor de tipo; dialog "Registrar sanção/veto"
  com justificativa obrigatória para veto e AlertDialog de confirmação.
- **Matérias → tabela**: novos filtros de status (Sancionada/Vetada) e coluna de badges de
  desfecho.
- **Portal Público → matéria**: desfecho visível ao cidadão.

#### Critérios de aceite

- Emenda/substitutivo vinculado aparece na timeline da principal e na contagem de
  "produção" do autor.
- Veto total bloqueia novo outcome duplicado; sanção após veto parcial registrada como novo
  outcome (histórico preservado).
- Veto cria tarefa "Apreciar veto" com prazo; auditoria com valores anterior/posterior.

### 11.2 Fase 18 — Votação avançada: opções customizadas, declaração de voto e recibos verificáveis

> Fecha a lacuna do prompt mestre §7.7 ("opções customizadas aprovadas", "Subscrição e
> declaração de voto", "Voto nominal deve registrar **recibo verificável**"). `hidePartial`
> já existe (Onda 2). **ADR-019. Status: ✅ ENTREGUE (Task 29-a).**

**Objetivo**: votações nominais/simbólicas com opções além de Sim/Não/Abstenção (ex.:
"Constar em ata", opções regimentais), e cada voto nominal gera recibo verificável
determinístico que o parlamentar consulta e a auditoria reconfere por reconta.

#### Modelo de dados (adicionais)

| Modelo | Campos-chave | Regras |
|---|---|---|
| `VotingOption` | `votingId`, `key` (slug), `label`, `order` | 1–5 opções por votação; exclusivas quando presentes (substituem sim/nao/abstencao) |
| `VoteReceipt` | `votingId`, `parliamentarianId`, `receiptCode`, `payloadHash`, `issuedAt` | criado no fechamento da votação; `receiptCode = HMAC-SHA256(segredo tenant, votingId+parl+valor+closedAt)[:12]` |

`Vote.value` passa a aceitar chaves customizadas (validadas contra `VotingOption`).
`resultCounts`/`resultDetail` contam/rotulam as opções customizadas; cálculo de resultado
continua determinístico (maioria sobre a opção mais votada; regra regimental mantida).

#### Rotas de API (novas/alteradas)

| Rota | Métodos | RBAC | Descrição |
|---|---|---|---|
| `POST /api/v1/sessions/:id/votings` | POST | `voting.write` | Aceita `options?: [{key,label}]` (1–5, labels ≠ vazios) |
| `POST /api/v1/me/vote` | POST | `self.vote` | Resposta passa a incluir `receiptPending: true` quando nominal |
| `/api/v1/votings/:id/receipts` | GET | `audit.read` + `voting.write` | Recibos emitidos + `verification: {ok, recomputedCount, mismatchCount}` (reconta determinística) |
| `/api/v1/me/receipts` | GET | `self.vote` | Recibos do próprio parlamentar (PWA) |

#### Telas

- **Mesa do Plenário → Nova votação**: seção "Opções de resposta" (padrão Sim/Não/Abstenção;
  alternador para customizadas com até 5 pares chave/rótulo).
- **Mesa do Plenário → votação fechada**: painel "Recibos" com contagem verificada
  (`ok`/`divergências`), lista código+parlamentar e botão "Reverificar".
- **Painel de votação/telão**: rótulos das opções customizadas (sem depender só de cor).
- **App do Parlamentar → histórico**: recibo do voto nominal com código e horário.

#### Critérios de aceite

- Voto com chave inexistente → 422 com Problem Details (validação de fronteira).
- Recomputação do HMAC bate com 100% dos recibos emitidos (verificação determinística).
- Votação secreta NÃO emite recibo com valor (apenas participação).
- Fechamento é idempotente: recibos não são duplicados em retry do comando.

### 11.3 Fase 19 — Participação e confiança pública: assinaturas do cidadão, verificação de documentos e rate limit

> Fecha as lacunas do prompt mestre §7.11 ("Canal de acompanhamento/assinatura"),
> §7.10 ("QR Code ou código de verificação para documentos públicos") e §11
> ("Rate limit por IP, usuário, tenant e endpoint"). **ADR-020. Status: ✅ ENTREGUE (Task 28-b).**

**Objetivo**: o cidadão acompanha matérias/sessões/audiências por e-mail (dupla confirmação),
qualquer pessoa verifica a autenticidade de uma publicação pelo código impresso, e os
endpoints públicos de escrita ficam protegidos por rate limit em memória.

#### Modelo de dados (adicionais)

| Modelo | Campos-chave | Regras |
|---|---|---|
| `CitizenSubscription` | `tenantId`, `email`, `targetKind ∈ matter\|session\|hearing`, `targetId`, `token`, `confirmedAt?`, `revokedAt?` | dupla confirmação por token; e-mail único por alvo; revogável pelo tenant |

Rate limit: janela deslizante em memória (`lib/server/rate-limit.ts`) — produção: Redis
(documentado no ADR). Limite padrão: perguntas de audiência 5/10min/IP; assinaturas
5/h/IP; verificação 30/min/IP.

#### Rotas de API (novas)

| Rota | Métodos | Descrição |
|---|---|---|
| `/api/v1/public/subscriptions` | POST | Cria assinatura pendente (e-mail, alvo, tenant por slug) + retorna aviso de confirmação; rate limited |
| `/api/v1/public/subscriptions/confirm` | GET | `?token=` confirma (idempotente) |
| `/api/v1/public/verify` | GET | `?code=` consulta publicações/atas por código de verificação → título, data, situação (válida/revogada) e checksum; rate limited |
| `/api/v1/subscriptions` | GET/DELETE | Listagem/revogação pelo tenant (`subscription.manage`); contagem de confirmadas por alvo |

`POST /api/v1/public/hearings/:id/questions` passa pelo rate limit (429 com Retry-After).

#### Telas

- **Portal Público → nova aba "Acompanhar"**: formulário de assinatura (e-mail + tipo +
  alvo com buscador), estado "pendente de confirmação" e instruções; link de exemplo do
  fluxo de confirmação (demo).
- **Portal Público → publicação**: botão "Verificar autenticidade" → consulta pública pelo
  código e selo resultante (válida/revogada).
- **Publicações → tabela**: código de verificação com botão de copiar e hint do fluxo público.
- **Publicações → aba Assinaturas**: lista de assinantes confirmados/pendentes por alvo com
  revogação (AlertDialog).

#### Critérios de aceite

- Assinatura não confirmada não recebe contagem pública; confirmação é idempotente.
- Verificação distingue publicação válida, revogada e código inexistente.
- Exceder o limite de perguntas retorna 429 com `Retry-After` (demonstrável no teste).
- E-mail normalizado (lowercase/trim) e validado (Zod) na fronteira.

### 11.4 Fase 20 — Operação e suporte: impersonação auditada, alertas persistentes e exportação assíncrona

> Fecha as lacunas do prompt mestre §5/§6 ("Impersonação de suporte exige permissão
> elevada, motivo, banner visível, prazo e auditoria"; papel `platform_support`), §15
> ("Alertas para fila travada, agente offline, lag de eventos") e §7.10 ("Jobs assíncronos
> com progresso"). **ADR-021. Status: ✅ ENTREGUE (Task 29-b).**

**Objetivo**: o suporte da plataforma opera com transparência total (banner, prazo, motivo,
auditoria dedicada), alertas operacionais deixam de ser efêmeros (persistem com
reconhecimento) e a exportação integral do tenant roda como job assíncrono com progresso
visível — ciclo de vida comercial completo e operável.

#### Modelo de dados (adicionais)

| Modelo | Campos-chave | Regras |
|---|---|---|
| `SupportImpersonation` | `supportUserId`, `targetUserId`, `reason` (≥10), `expiresAt` (≤60min), `startedAt`, `endedAt?` | uma ativa por suporte; encerra em logout/fim do prazo (lazy) |
| `PlatformAlert` | `kind`, `severity ∈ info\|warning\|critical`, `message`, `actionHint`, `meta`, `createdAt`, `ackAt?`, `ackBy?` | deduplicada por `kind` aberto; `ack` audita |
| `ExportJob` | `tenantId`, `status ∈ pending\|running\|done\|failed`, `progress` (0–100), `fileName`, `error?`, `createdAt`, `finishedAt?` | processada em chunks; resultado idêntico ao export atual (sem segredos) |

`AuthSession` ganha `impersonationId?` — a sessão de suporte carrega a impersonação;
`/api/v1/auth/me` retorna `impersonation {supportName, reason, expiresAt}` quando ativa.

#### Rotas de API (novas)

| Rota | Métodos | RBAC | Descrição |
|---|---|---|---|
| `/api/v1/platform/impersonations` | GET/POST | `impersonation.manage` (platform_support/owner) | Lista histórico/inicia `{targetUserId, reason, minutes}` — cria sessão de suporte com banner |
| `/api/v1/platform/impersonations/:id/end` | POST | idem | Encerra a impersonação (banner some) |
| `/api/v1/platform/alerts` | GET | `platform.read` | Alertas persistidos (abertos + reconhecidos recentes) |
| `/api/v1/platform/alerts/:id/ack` | POST | `platform.manage` | Reconhece alerta com auditoria |
| `/api/v1/platform/tenants/:id/export` | POST | `platform.manage` | Agora cria `ExportJob` e responde `{jobId}` imediatamente |
| `/api/v1/platform/exports/:id` | GET | `platform.manage` | Status/progresso do job |
| `/api/v1/platform/exports/:id/download` | GET | `platform.manage` | Download do JSON quando `done` |

`platform_support` recebe `platform.read` (system-status, alerts, help) — sem
`platform.manage`; seed ganha usuário de suporte dedicado.

#### Telas

- **Módulo NOVO "Suporte da Plataforma"** (Administração; platform_support/owner): saúde
  resumida (system-status), alertas ativos com ack, e "Operar como usuário" (seletor de
  usuário, motivo, prazo ≤60min) com histórico e encerramento.
- **Topbar**: banner âmbar persistente "Suporte operando como {nome} — {motivo} — termina em
  {X} min" com botão "Encerrar agora" (só durante impersonação).
- **Console → Sistema**: alertas persistentes com estado (aberto/reconhecido) e ação de
  reconhecer; derivados continuam como reforço.
- **Console → Visão Geral**: "Exportar dados" agora mostra progresso (0–100%) e habilita o
  download ao concluir; toast ao término.

#### Critérios de aceite

- Impersonação sem motivo ou com prazo >60min → 422; banner visível em TODOS os módulos
  enquanto ativa; encerramento audita `support.impersonation_ended`.
- Alerta deduplicado por kind enquanto aberto; ack audita quem/quando.
- Export job: progresso monotônico, download íntegro (mesmo shape do export síncrono
  anterior), falha registrada em `error`.
- platform_support NÃO acessa rotas `platform.manage` (403 demonstrável).

### 11.5 Ordem de execução (Tasks 26–31)

| Task | Fase | Executor | Dependências |
|---|---|---|---|
| 26 | Planejamento das Fases 17–20 (este §11) | ✅ main | — |
| 27 | Base compartilhada: schema (RelatedMatter, MatterOutcome, VotingOption, VoteReceipt, CitizenSubscription, SupportImpersonation, PlatformAlert, ExportJob + AuthSession.impersonationId) + db:push, contracts.ts (todos os tipos novos), RBAC (`subscription.manage`, `impersonation.manage`, `platform.read`), sidebar (23 módulos) + page.tsx + stub, seed (usuário platform_support, desfechos, opções, assinaturas, alerta) | ✅ main | Task 26 |
| 28-a | Fase 17 — Relacionamentos + emendas/substitutivos + veto/sanção (rotas + Matérias) | ✅ subagente | Task 27 |
| 28-b | Fase 19 — Assinaturas do cidadão + verificação pública + rate limit (rotas + Portal/Publicações) | ✅ subagente | Task 27 |
| 29-a | Fase 18 — Opções customizadas + recibos verificáveis (rotas + Plenário/PWA) | ✅ subagente | Task 27 |
| 29-b | Fase 20 — Impersonação + alertas persistentes + export assíncrona (rotas + módulo Suporte + topbar + Console) | ✅ subagente | Task 27 |
| 30 | Integração final, reseed da base demo, `bun run lint` | ✅ main | Tasks 28–29 |
| 31 | Verificação E2E (agent-browser) + pacote de documentação (ADR-018..021, api-contract, user-manual, help-content, CHANGELOG 0.11.0, test-report, README, runbook) + worklog | ✅ main | Task 30 |

---

## 12. Onda 5 — Fases 21–24: prontidão para produção, confiança de acesso, ecossistema de integração e crescimento do SaaS

> Planejamento da continuidade após a v0.11.0 (Ondas 1–4, fases 0–20, 23 módulos). Origem:
> **pendências acumuladas e declaradas** no fechamento da Onda 4 — alertas por cron, worker
> dedicado para export (job órfão em `running`), validação de ciclos de relacionamento,
> índice de busca (FTS/pg_trgm), MFA, desenho criptográfico do voto/assinaturas, PostgreSQL+RLS,
> Redis, SMTP, gateway de pagamento real, CI com testes — somadas às lacunas de maturidade
> **do produto como negócio**: API pública autenticada para integradores, self-onboarding com
> trial, saúde do tenant (anti-churn) e voz do usuário (NPS). O que não é executável no
> sandbox fica registrado como caminho de produção no ADR correspondente (padrão do §7).

**Entregável imediato desta onda de planejamento (v0.12.0)**: módulo **Planejamento e
Roadmap** no produto (menu Administração) — consulta do estado entregue, mapa-alvo TO-BE v5,
fases com progresso rastreável (tasks persistidas, edição `platform.manage`) e o pacote
documental do sistema. Este módulo é a "documentação viva" exigida pelo prompt mestre (§7.1)
estendida ao planejamento.

### 12.0 Mapa-alvo de menus e páginas (TO-BE v5 — 26 módulos)

```
Operação
├── Painel                        (existente)
├── Agenda Legislativa            (existente)
├── Sessões                       (existente)
├── Mesa do Plenário              (ganha: coleta de assinaturas da ata no encerramento — Fase 22)
├── Telão                         (existente)
└── App do Parlamentar (PWA)      (ganha: "Assinar ata" da sessão encerrada — Fase 22)

Processo Legislativo
└── Protocolo e Tramitação        (ganha: validação de ciclos ao vincular matérias — Fase 21)

Cadastros
├── Parlamentares                 (existente)
├── Matérias                      (ganha: rejeição de ciclo em relacionamentos — Fase 21)
└── Estrutura Institucional       (existente)

Governança
├── Auditoria                     (existente)
├── Relatórios                    (ganha: painel de assinaturas da ata — Fase 22)
├── Publicações e Audiências      (existente)
├── Analytics                     (existente)
├── Portal Público                (ganha: verificação pública de assinaturas da ata — Fase 22)
├── Webhooks                      (existente)
└── Integrações & API             (NOVO — Fase 23: chaves de API com escopos, playground
│                                    de consultas reais e referência para desenvolvedores)

Administração
├── Usuários                      (ganha: MFA por usuário e sessões ativas — Fase 22)
├── Modelos de Documento          (existente)
├── Configurações                 (existente)
├── Console da Plataforma         (ganha: aba Agendamentos — Fase 21 — e aba Crescimento — Fase 24)
├── Migração de Dados             (existente)
├── Suporte da Plataforma         (ganha: watchdog de jobs órfãos — Fase 21)
├── Planejamento e Roadmap        (NOVO — v0.12.0: este plano, consultável no produto)
└── Crescimento                   (NOVO — Fase 24: health score por tenant, MRR/churn simulados,
                                     trials e NPS consolidado)

Ajuda
└── Central de Ajuda              (ganha: guia do desenvolvedor de API e widget NPS — Fases 23–24)
```

Componentes transversais novos: **login em dois passos com MFA** (Fase 22), **banner de
trial** no topbar com dias restantes e bloqueio suave de escrita após expiração (Fase 24).

### 12.1 Fase 21 — Prontidão para produção: agendador, watchdog e hardening

> Fecha as pendências da Onda 4: **alertas por cron**, **worker dedicado** (aqui, watchdog de
> jobs de export órfãos), **validação de ciclos de relacionamento**, **índice de busca** e
> **CI com testes**; registra o caminho de produção para PostgreSQL+RLS, Redis e SMTP.
> **ADR-022. Status: 🗓 Planejado (Task 34-a).**

**Objetivo**: o sistema deixa de depender de gatilhos pontuais para operar com tarefas
agendadas verificáveis (alertas, health, watchdog), o grafo de relacionamentos de matérias
fica livre de ciclos, e a esteira de CI garante lint/tipos/smoke a cada commit.

#### Modelo de dados (adicionais)

| Modelo | Campos-chave | Regras |
|---|---|---|
| `ScheduledJob` | `kind ∈ alert.scan\|export.watchdog\|health.check\|tenant.health_snapshot`, `title`, `everySeconds`, `lastRunAt?`, `nextRunAt`, `lastStatus?`, `lastNote?`, `active`, `createdAt` | singleton por `kind` (dedupe); `nextRunAt` recalculado após cada execução; execução manual nunca adianta a agenda |

Sem transições auditáveis em cadeia de tenant: alterações de agendamento registram
`before/after` na própria linha e o **nome do ator** (`updatedBy`) — decisões de plataforma
fora do escopo de tenant (padrão do `SystemStatus`).

#### Arquitetura (mini-serviço)

`mini-services/scheduler` (porta **3005**, Bun, `--hot`): tick de 30s lê `ScheduledJob`
diretamente no SQLite (mesmo padrão do `realtime`/outbox — ADR-003), executa os kinds e grava
resultado/`nextRunAt`. Kinds:

- `alert.scan` — avalia condições de negócio (fatura vencida > 3d, sessão agendada ≤ 48h sem
  pauta, webhook em dead-letter) → `PlatformAlert` deduplicada por kind aberto (Fase 20);
- `export.watchdog` — `ExportJob` em `running` por > 10 min → `failed` + alerta persistente
  (pendência "job órfão" do worklog Task 31);
- `health.check` — ping periódico do socket.io (3003), do serviço de webhooks (3004) e do
  banco → alerta de degradação;
- `tenant.health_snapshot` — captura diária do health score (Fase 24) para tendência.

#### Rotas de API (novas)

| Rota | Métodos | RBAC | Descrição |
|---|---|---|---|
| `/api/v1/platform/schedules` | GET | `platform.read` | Lista os jobs com `nextRunAt`, `lastRunAt`, `lastStatus`, `active` |
| `/api/v1/platform/schedules/:id/run` | POST | `platform.manage` | Execução manual imediata (audita `platform.schedule_run` no log do job) |
| `/api/v1/platform/schedules/:id` | PATCH | `platform.manage` | Pausar/retomar (`active`) e ajustar `everySeconds` (mín. 60s) |

#### Hardening declarado nesta fase

- **Validação de ciclos**: `POST /matters/:id/related` percorre o grafo (DFS bidirecional,
  limite de profundidade 50) → `422 MATTER_CYCLE` quando o vínculo fechar um ciclo
  (pendência real da Onda 4).
- **Índice de busca**: índice SQLite (LIKE otimizado por índice de prefixo no sandbox) e
  caminho documentado para `pg_trgm`/FTS em produção.
- **CI**: `.github/workflows/ci.yml` — `bun install`, `prisma generate`, `bun run lint`,
  `tsc --noEmit` e smoke das rotas públicas após `db:push`+seed.
- **Caminho de produção (ADR-022)**: PostgreSQL+RLS (isolamento por política em vez de
  `tenantId` aplicado), Redis para rate limit/filas/dedupe, SMTP transacional para double
  opt-in e worker dedicado com posse exclusiva da fila de export.

#### Telas

- **Console da Plataforma → aba Sistema → seção "Agendamentos"**: tabela (job, intervalo,
  próxima execução, última execução + status, ativo) com "Rodar agora" (AlertDialog) e
  pausar/retomar.
- **Suporte da Plataforma**: card "Watchdog" com jobs órfãos detectados e ação de reprocessar.
- **Matérias → Vincular matéria**: erro de ciclo com explicação do caminho encontrado
  (ex.: "PL 47 → PL 49 → PL 47").

#### Critérios de aceite

- Ciclo A→B→C→A rejeitado com `422 MATTER_CYCLE` e caminho exibido.
- Export em `running` simulado por > 10 min vira `failed` + `PlatformAlert` (dedupe por kind).
- Execução manual atualiza `lastRunAt`/`lastStatus` e NÃO adianta `nextRunAt`.
- Scheduler sobrevive a restart (`--hot`) e o Console reflete estado real do banco.

### 12.2 Fase 22 — Confiança de acesso e assinatura eletrônica de documentos

> Fecha a pendência **MFA** (worklog Task 31 / §7 "OIDC/MFA reais") no degrau executável no
> sandbox (TOTP nativo com `node:crypto`), adiciona gestão de sessões ativas e estende a
> confiança da cadeia de auditoria (ADR-004) e dos recibos (ADR-019) para **atas assinadas
> eletronicamente pelos parlamentares**. **ADR-023. Status: 🗓 Planejado (Task 34-b).**

**Objetivo**: login por senha com segundo fator (TOTP), usuário enxerga e revoga suas sessões,
e a ata da sessão encerrada pode ser assinada eletronicamente pelos parlamentares — com
cadeia de hash verificável publicamente (quem assinou, quando e se o documento é íntegro).

#### Modelo de dados (adicionais)

| Modelo / campo | Campos-chave | Regras |
|---|---|---|
| `User.mfaSecret?` + `User.mfaEnabled` | segredo TOTP base32 | `mfaEnabled=false` nunca exige código; segredo só existe enquanto desabilitado ou ativo — nunca é retornado por API após enable |
| `AuthSession` (sem mudança) | — | revogação individual via nova rota; "Redefinir senha" já revoga todas (Fase 9) |
| `DocumentSignature` | `tenantId`, `kind ∈ ata_sessao\|parecer`, `documentId`, `signatoryParliamentarianId`, `signatoryName`, `docHash`, `prevHash?`, `signatureCode`, `signedAt` | append-only; idempotente por `(documentId, signatory)`; `docHash = sha256(conteúdo publicado da ata)`; cadeia por documento (`prevHash` da última assinatura); `signatureCode = HMAC(segredo tenant, docHash+parl+signedAt)[:16]` (padrão ADR-019) |

#### Rotas de API (novas)

| Rota | Métodos | RBAC | Descrição |
|---|---|---|---|
| `/api/v1/auth/mfa/setup` | POST | autenticado | Gera segredo + URL `otpauth://` (nunca persiste habilitado) |
| `/api/v1/auth/mfa/enable` | POST | autenticado | Valida código TOTP do segredo e habilita (audita `user.mfa_enabled`) |
| `/api/v1/auth/mfa/disable` | POST | autenticado | Exige senha atual + código válido (audita) |
| `/api/v1/auth/login` | POST | público | Com MFA ativo → `401 MFA_REQUIRED` (sem cookie de sessão) |
| `/api/v1/auth/login/mfa` | POST | público | `email, password, totp` — valida janela ±1 e emite a sessão |
| `/api/v1/auth/sessions` | GET/DELETE | autenticado | Sessões ativas do próprio usuário; revogação individual |
| `/api/v1/me/ata/sign` | POST | `self.vote` (parlamentar) | Assina a ata da sessão encerrada da Casa (idempotente) |
| `/api/v1/reports/session/:id/ata/signatures` | GET | leitura do tenant | Painel: presentes na sessão, assinaram, pendentes, cadeia verificada |
| `/api/v1/public/documents/ata/:sessionId` | GET | público (`?tenant=`) | Ata pública com assinaturas (nome, horário, código) e integridade |
| `/api/v1/public/documents/verify-signature` | GET | público | `?code=` → válido/inválido + documento + signatário (rate limited) |

TOTP sem dependência externa: HMAC-SHA1 de 30s (RFC 6238) com `node:crypto`; drift ±1 janela.

#### Telas

- **Login**: passo 2 com `input-otp` (6 dígitos) quando `401 MFA_REQUIRED`.
- **Usuários → próprio perfil (Meu acesso)**: setup MFA (segredo + URL + campo de confirmação),
  desabilitar com senha, e tabela de sessões ativas (dispositivo, último uso, "Encerrar").
- **Mesa do Plenário / Relatórios → ata da sessão encerrada**: painel "Assinaturas" com
  pendentes/assinadas, integridade da cadeia e instruções do app.
- **App do Parlamentar**: card "Assinar ata da sessão de {data}" (1 toque; feedback do código).
- **Portal Público → ata**: seção "Assinado eletronicamente por" com verificação de
  autenticidade pelo código.

#### Critérios de aceite

- Login sem código com MFA ativo → `401 MFA_REQUIRED` sem sessão emitida.
- Assinatura duplicada → 200 idempotente (sem nova linha).
- Cadeia verificável: recompute de `docHash`+`prevHash` bate 100% (verificação pública).
- Votação secreta continua sigilosa; a assinatura da ata atesta presença, nunca o voto.
- O segredo TOTP jamais é retornado por API após habilitado.

### 12.3 Fase 23 — Ecossistema: chaves de API e documentação para desenvolvedores

> Extensão natural dos webhooks HMAC (ADR-007): quem consome dados do Legis SaaS sem ser
> notificação passiva precisa de **acesso programático autenticado, escopado e limitado**.
> Fecha a lacuna de ecossistema (integrações de painéis municipais, transparência, TV Câmara
> etc.). **ADR-024. Status: 🗓 Planejado (Task 35-a).**

**Objetivo**: o administrador da Câmara emite chaves de API com escopos de leitura, executa
consultas reais num playground in-app e acompanha uso/revogação — com documentação de
desenvolvedor dentro da Central de Ajuda.

#### Modelo de dados (adicionais)

| Modelo | Campos-chave | Regras |
|---|---|---|
| `ApiKey` | `tenantId`, `name`, `prefix` (`legk_` + 8 chars exibíveis), `hash` (sha256 da chave completa), `scopes` (JSON: `matters.read`, `sessions.read`, `publications.read`, `calendar.read`), `lastUsedAt?`, `revokedAt?`, `createdAt` | chave completa exibida UMA vez na criação; só o hash é persistido; revogação append-only (nunca apaga) |

#### Rotas de API (novas)

| Rota | Métodos | RBAC | Descrição |
|---|---|---|---|
| `/api/v1/api-keys` | GET/POST | `apikey.manage` (tenant_admin) | Lista (prefixo, escopos, último uso, estado) e cria (`{name, scopes}`) → chave completa UMA vez |
| `/api/v1/api-keys/:id` | DELETE | `apikey.manage` | Revoga (idempotente; auditoria `apikey.revoked`) |
| `/api/v1/external/matters` | GET | Bearer `legk_…` + `matters.read` | Matérias públicas do tenant (paginação, filtros de leitura) |
| `/api/v1/external/sessions` | GET | Bearer + `sessions.read` | Sessões (agendadas/realizadas) com pauta pública |
| `/api/v1/external/publications` | GET | Bearer + `publications.read` | Publicações do diário eletrônico |
| `/api/v1/external/calendar` | GET | Bearer + `calendar.read` | Eventos do calendário legislativo |

Rate limit por chave: janela deslizante em memória (produção: Redis — ADR-024) —
60 req/min/chave; excesso → `429 RATE_LIMITED` + `Retry-After`. `lastUsedAt` atualizado
(best-effort) sem log de IP (minimização LGPD).

#### Telas

- **Módulo NOVO "Integrações & API"** (Governança), 3 abas:
  - **Chaves de API**: tabela (nome, prefixo, escopos, último uso, ativa), dialog de criação
    com checkboxes de escopo, AlertDialog de revogação, exibição única da chave com botão
    copiar e aviso;
  - **Playground**: seleção de endpoint + chave ativa → executa a consulta REAL (fetch
    server-side com a chave selecionada, sem expô-la ao cliente) e renderiza o JSON com
    realce, status e latência;
  - **Documentação**: referência dos endpoints externos, exemplos `curl`, formato de erro
    Problem Details e limites.
- **Central de Ajuda**: guia "Desenvolvedores" (como emitir chave, escopos, exemplos, 429).

#### Critérios de aceite

- Sem chave → 401; chave revogada → 401 imediato; escopo ausente → 403 com code explícito.
- 61ª requisição no minuto → 429 com `Retry-After` (demonstrável no playground).
- A chave completa nunca é re-exibida nem logada; o playground não a expõe ao browser.
- Dados de outro tenant jamais retornam (escopo derivado da chave, como o `x-actor-id`).

### 12.4 Fase 24 — Crescimento do SaaS: self-onboarding, trial, health e NPS

> Fecha as pendências comerciais: **gateway de pagamento real** (aqui: o ciclo comercial
> simulado ganha self-onboarding e trial — o gateway de verdade é caminho de produção no
> ADR) e adiciona as ferramentas clássicas de crescimento SaaS: **health score anti-churn**,
> **métricas de negócio** (MRR simulado, churn, trials) e **NPS in-app**. **ADR-025.
> Status: 🗓 Planejado (Task 35-b).**

**Objetivo**: uma câmara nova entra sozinha (pedido público → ativação humana → trial de 14
dias com plano profissional), a plataforma enxerga a saúde de cada tenant antes do churn, e
os usuários deixam a voz do produto dentro do produto (NPS consolidado por versão).

#### Modelo de dados (adicionais)

| Modelo / campo | Campos-chave | Regras |
|---|---|---|
| `Tenant.trialEndsAt?` | — | definido na ativação (+14d); vencido → escrita bloqueada com `403 TRIAL_EXPIRED`, leitura liberada |
| `OnboardingRequest` | `chamberName`, `city`, `uf`, `email`, `slugDesejado`, `status ∈ pendente\|ativada\|rejeitada`, `note?`, `createdAt` | POST público rate limited (3/h/IP); ativação cria tenant + usuário owner; rejeita exige nota |
| `TenantHealthSnapshot` | `tenantId`, `score` (0–100), `metrics` (JSON), `capturedAt` | 1/dia pelo scheduler (Fase 21); score determinístico: sessões, matérias, logins e webhooks ativos dos últimos 30d |
| `NpsResponse` | `userId`, `role`, `score` (0–10), `comment?`, `version`, `createdAt` | idempotente por `(user, version)` — atualiza a própria resposta; consolidação apenas agregada |

#### Rotas de API (novas)

| Rota | Métodos | RBAC | Descrição |
|---|---|---|---|
| `/api/v1/public/onboarding` | POST | público (rate limited) | Pedido de criação da câmara (valida slug, e-mail, UF) |
| `/api/v1/platform/onboarding` | GET | `platform.read` | Pedidos pendentes/histórico |
| `/api/v1/platform/onboarding/:id/activate` | POST | `platform.manage` | Cria tenant trial (+14d) + owner com senha temporária exibita UMA vez (sem SMTP no sandbox) |
| `/api/v1/platform/onboarding/:id/reject` | POST | `platform.manage` | Rejeita com nota (audita) |
| `/api/v1/platform/tenants/:id/health` | GET/POST | `platform.read` / `platform.manage` | Health atual (recomputa) e captura forçada |
| `/api/v1/platform/metrics` | GET | `platform.read` | MRR simulado (planos ativos × preço), churn 90d, tenants ativos, trials, NPS médio |
| `/api/v1/help/nps` | POST | autenticado | Registra NPS (0–10 + comentário) da versão atual — idempotente |

#### Telas

- **Login**: link "Criar câmara (trial 14 dias)" → formulário público (nome, cidade/UF,
  e-mail do responsável, slug) com confirmação de análise.
- **Console da Plataforma → aba "Crescimento"** (ou módulo "Crescimento" irmão do Console,
  ambos `platform_owner`): cards (tenants ativos, MRR simulado, churn 90d, trials, NPS),
  tabela de health por tenant (score, bucket `saudável|atenção|risco`, métricas-chave,
  tendência vs. captura anterior) e fila de pedidos de onboarding (ativar/rejeitar).
- **Topbar (tenant em trial)**: banner "Trial termina em N dias — falar com a plataforma";
  expirado: "Trial expirado — leitura liberada, gravação bloqueada".
- **Central de Ajuda**: widget NPS ("Como está sua experiência?" 0–10 + comentário opcional).

#### Critérios de aceite

- Onboarding sem login cria pedido pendente; 4º pedido/h/IP → 429.
- Ativação cria tenant trial + owner; a senha temporária é exibida UMA vez (200 inicial).
- Trial expirado: `POST` de escrita do tenant → `403 TRIAL_EXPIRED`; `GET` continua 200.
- Health recompute determinístico (mesmo banco → mesmo score) e snapshot diário gravado.
- NPS do mesmo usuário na mesma versão atualiza a resposta (não duplica).

### 12.5 Ordem de execução (Tasks 32–38)

| Task | Fase | Executor | Dependências |
|---|---|---|---|
| 32 | Planejamento da Onda 5 (este §12) + módulo **Planejamento e Roadmap** (v0.12.0: schema `RoadmapPhase`/`RoadmapTask`, rotas `/api/v1/roadmap`, stub e registro no shell) | ✅ main | Task 31 |
| 33-a | UI completa do módulo Planejamento e Roadmap (abas: visão, fases com progresso, mapa TO-BE, documentação, Onda 6) | ✅ subagente | Task 32 |
| 33-b | Pacote de documentação v0.12.0 (CHANGELOG, user-manual, help-content, README, runbook, test-report) | ✅ subagente | Task 32 |
| 34 | Base da Onda 5: schema (ScheduledJob, DocumentSignature, ApiKey, OnboardingRequest, TenantHealthSnapshot, NpsResponse, `User.mfa*`, `Tenant.trialEndsAt`) + db:push + contracts + RBAC (`apikey.manage`) + sidebar (26 módulos) + seed + stubs | main | Task 32 |
| 34-a | Fase 21 — Agendador + watchdog + ciclos + CI (rotas + Console/Suporte + `mini-services/scheduler` :3005) | subagente | Task 34 |
| 34-b | Fase 22 — MFA + sessões + assinatura eletrônica de atas (rotas + Login/Usuários/Relatórios/PWA/Portal) | subagente | Task 34 |
| 35-a | Fase 23 — Chaves de API + rotas externas + playground (rotas + módulo Integrações & API + guia dev) | subagente | Task 34 |
| 35-b | Fase 24 — Onboarding/trial/health/NPS (rotas + Crescimento + banner + widget) | subagente | Task 34 |
| 36 | Integração final, reseed da base demo, `bun run lint` | main | Tasks 34–35 |
| 37 | Verificação E2E (agent-browser) + ADRs 022–025 + api-contract/user-manual/help-content 0.13.0 + CHANGELOG + test-report | main + subagente docs | Task 36 |

---

## 13. Onda 6 — Fases 25–28 (prévia consolidada na v0.13.0)

> Prévia de alto nível para alinhamento de direção — **detalhada em §14** após o
> fechamento da Onda 5 (v0.13.0), seguindo o padrão deste documento. O que não é
> executável no sandbox permanece registrado como caminho de produção no ADR
> correspondente (padrão do §7).

| Fase | Tema | Resumo |
|---|---|---|
| Fase 25 | Produção real (infraestrutura) | Migração executada de fato: PostgreSQL com RLS por tenant, Redis (rate limit, filas, dedupe de alertas), S3 para anexos, SMTP transacional, worker dedicado de export com posse da fila, CI completo com testes automatizados (unit + E2E) e deploy blue-green |
| Fase 26 | Identidade federada e cripto de confiança | OIDC/SAML para câmaras com IdP próprio, desenho criptográfico do voto secreto (mixnet/assinatura cega), assinatura qualificada ICP-Brasil para atas, HSM/KMS para segredos por tenant |
| Fase 27 | Multi-idioma e acessibilidade AA | pt-BR/en/es na UI e no portal, auditoria WCAG 2.1 AA completa (telão e PWA incluídos), narrativa de áudio para baixa visão no telão |
| Fase 28 | Ecossistema amplo | Marketplace de integrações verificadas (apps de terceiros com revisão), agente desktop Tauri com modo offline + sync por snapshot, dados abertos em CKAN, API GraphQL opcional sobre o mesmo contrato |

---

## 14. Onda 6 — Fases 25–28: infraestrutura executável, identidade e cripto, multi-idioma/AA e ecossistema

> Planejamento da continuidade após a v0.13.0 (Ondas 1–5, fases 0–24, 26 módulos, ~92 grupos
> de rotas, 25 ADRs). Origem: **prévia de longo prazo da §13** consolidada no fechamento da
> Onda 5 + pendências declaradas: índice de busca real (FTS — pendência da Onda 4 que o LIKE
> do /search apenas contorna), posse exclusiva da fila de export (o watchdog da F21 detecta
> órfãos, mas o processamento ainda vive no ciclo de request), backup automatizado do SQLite,
> rotação de segredos por tenant (recibos/assinaturas verificáveis para sempre mesmo com chave
> rotacionada), SSO para câmaras com IdP próprio, multi-idioma (next-intl já presente no
> package.json), acessibilidade WCAG 2.1 AA sistemática e um ecossistema de integrações além
> das chaves legk_. O que não é executável no sandbox fica registrado como caminho de
> produção no ADR correspondente (padrão do §7).

**Entregável imediato desta onda de planejamento (v0.13.0)**: este §14 + o flip do módulo
**Planejamento e Roadmap** (Onda 5 marcada entregue, 34/34, prévia da Onda 6 apontando para
cá). A implementação fecha na **v0.14.0**, com o roadmap do produto rastreando as tasks da
Onda 6 no mesmo módulo (padrão da v0.12.0 → v0.13.0).

### 14.0 Mapa-alvo de menus e páginas (TO-BE v6 — 26 módulos, 1 mini-service novo)

```
Operação
├── Painel                        (existente)
├── Agenda Legislativa            (existente)
├── Sessões                       (existente)
├── Mesa do Plenário              (existente)
├── Telão                         (ganha: narração por áudio para baixa visão — Fase 27)
└── App do Parlamentar (PWA)      (existente)

Processo Legislativo
└── Protocolo e Tramitação        (existente)

Cadastros
├── Parlamentares                 (existente)
├── Matérias                      (existente — busca interna passa a usar o índice FTS — Fase 25)
└── Estrutura Institucional       (existente)

Governança
├── Auditoria                     (existente)
├── Relatórios                    (existente)
├── Publicações e Audiências      (existente)
├── Analytics                     (existente)
├── Portal Público                (ganha: multi-idioma pt-BR/en/es — Fase 27)
├── Webhooks                      (existente)
└── Integrações & API             (ganha: aba "Explorar" do marketplace — Fase 28)

Administração
├── Usuários                      (ganha: login federado demo + idioma preferido — Fases 26–27)
├── Modelos de Documento          (existente)
├── Configurações                 (ganha: idioma padrão do tenant e chave de assinatura ativa — Fases 26–27)
├── Console da Plataforma         (ganha: seção Backups com restore — Fase 25)
├── Migração de Dados             (existente)
├── Suporte da Plataforma         (ganha: saúde do export-worker :3006 — Fase 25)
├── Planejamento e Roadmap        (existente — rastreia a Onda 6)
└── Crescimento                   (existente)

Ajuda
└── Central de Ajuda              (ganha: relatório de acessibilidade AA por release — Fase 27)
```

Componentes transversais novos: **seletor de idioma** no topbar e no portal (Fase 27),
**key ring de assinatura por tenant** com verificação retroativa (Fase 26) e o
**mini-service `mini-services/export-worker` (porta 3006)** com posse exclusiva da fila de
exportações (Fase 25 — quarto serviço, ao lado de realtime :3003, webhooks :3004 e
scheduler :3005). A contagem de módulos permanece 26: a onda é de endurecimento e
alcance (extensões), não de superfície nova.

### 14.1 Fase 25 — Infraestrutura executável: export-worker, backup, FTS e observabilidade

> Fecha as pendências remanescentes da Onda 4/Onda 5: **worker dedicado com posse da fila de
> export**, **backup automatizado**, **índice de busca real** e **correlação de logs ponta a
> ponta**; registra o caminho de produção para PostgreSQL+RLS, Redis, S3, SMTP, CI completo
> e blue-green. **ADR-026. Status: 🗓 Planejado (Task 38-a).**

**Objetivo**: operações de longa duração saem do ciclo de request (export processado por um
> worker dono da fila), o dado fica protegido por backup restaurável verificado, a pesquisa
> unificada usa índice real com ranking, e toda a stack (app + 4 mini-services) emite logs
> estruturados com `correlationId`.

#### Modelo de dados (adicionais)

| Modelo | Campos-chave | Regras |
|---|---|---|
| `BackupRun` | `kind ∈ daily\|manual`, `file`, `sizeBytes`, `checksumSha256`, `status`, `startedAt`, `finishedAt?`, `note?` | nível PLATAFORMA; retenção configurável (padrão 7); restore NÃO é automático — verificado pelo runbook com checksum |
| `SigningKey` (Fase 25 cria a tabela; uso pleno na F26) | `tenantId?`, `purpose ∈ receipt\|signature\|federation`, `keyId`, `active`, `createdAt`, `retiredAt?` | key ring versionado; segredo derivado determinístico no sandbox (HSM/KMS no caminho de produção) |

FTS5 (SQLite): tabela virtual `search_index(content, matterId?, publicationId?, agendaItemId?)`
reconstruída por `ScheduledJob` (kind `search.reindex`) e incremental nas escritas de
matéria/publicação/pauta — o `/api/v1/search` passa a consultar o índice com ranking BM25,
mantendo o contrato de resposta atual.

#### Rotas e serviços (adicionais)

| Rota/Serviço | Método | RBAC | Comportamento |
|---|---|---|---|
| `mini-services/export-worker` (:3006) | — | — | loop 5s: claiming transacional de `ExportJob` `pending` → `running` → `completed/failed`; grava progresso e emite outbox `export.progress`; NÃO processa jobs marcados `failed` (watchdog da F21 segue detectando órfãos) |
| `GET /api/v1/platform/backups` | GET | `platform.read` | lista `BackupRun` com status/checksum/tamanho |
| `POST /api/v1/platform/backups/run` | POST | `platform.manage` | dispara backup manual (SQLite backup API — cópia consistente com WAL); 429 se outro em andamento |
| `GET /api/v1/platform/backups/:id/download` | GET | `platform.manage` | download do arquivo (produção: URL assinada do S3) |
| `PATCH /api/v1/platform/schedules/:id` | PATCH | `platform.manage` | estende kinds existentes com `backup.daily` e `search.reindex` (schema validado) |

#### Critérios de aceite

1. Exportação de tenant grande (seed completo) processada pelo worker :3006 com progresso em
   tempo real (outbox → toast/console) e NENHUM processamento no ciclo de request.
2. Backup diário executando pelo agendador; `checksumSha256` conferido no restore de
   verificação documentado no runbook; retenção respeitada.
3. `/api/v1/search` respondendo pelo índice FTS com ranking (ordem difere do LIKE atual) e
   latência menor em base semeada; reindex manual disponível no Console → Sistema.
4. Todos os serviços emitindo JSON log com `correlationId` propagado (request → rota →
   mini-service) — amostra coletada no test-report.

### 14.2 Fase 26 — Identidade federada e cripto de confiança (adaptado ao sandbox)

> SSO simulado para câmaras com IdP próprio, **key ring com rotação retroverificável**, ICP
> simulada na verificação pública de assinaturas e o **desenho do voto secreto** (mixnet /
> assinatura cega) registrado como ADR de design. Caminho de produção: OIDC/SAML real,
> ICP-Brasil qualificada e HSM/KMS. **ADR-027 (inclui o design do voto secreto). Status:
> 🗓 Planejado (Task 38-b).**

**Objetivo**: a confiança de acesso (F22) ganha os três pilares de produção — federação de
> identidade, rotação de chaves sem quebrar o histórico verificável e qualificação de
> assinatura — com o desenho criptográfico do voto secreto documentado antes de qualquer
> implementação.

#### Modelo de dados (adicionais)

| Modelo | Campos-chave | Regras |
|---|---|---|
| `FederatedIdentity` | `userId`, `provider`, `subject`, `email`, `claims`, `lastLoginAt` | um usuário pode ter múltiplos provedores; login federado cria/atualiza por `subject` |
| `SigningKey` (uso pleno) | ver Fase 25 | `computeDocumentSignature`/recibos passam a gravar `keyId`; verificação tenta a chave ativa e as aposentadas (retroverificável) |

#### Rotas (adicionais)

| Rota | Método | RBAC | Comportamento |
|---|---|---|---|
| `GET /api/v1/auth/federation/providers` | GET | público | provedores habilitados (sandbox: 1 demo “IdP da Câmara” — e-mail institucional) |
| `POST /api/v1/auth/federation/login` | POST | público | fluxo simulado: e-mail institucional + token exibido uma vez (padrão da senha temporária da F24); cria/atualiza `FederatedIdentity` + auditoria `auth.federated` |
| `POST /api/v1/tenants/keys/rotate` | POST | `tenant_admin` | aposenta a chave ativa e promove a derivada seguinte (key ring); recibos/assinaturas ANTERIORES continuam verificáveis (testes de retrocompatibilidade) |
| `GET /api/v1/public/documents/verify-signature` | GET | público (rate 30/min) | passa a aceitar `?format=icp` com verificação X.509 auto-assinada DEMO (sha256WithRSA) — sandbox apenas, rotulada como simulação |

#### Critérios de aceite

1. Login federado demo em dois passos com auditoria `auth.federated` e sessão equivalente à
   de senha (MFA compatível).
2. Rotação de chave: assinatura feita com chave K1 permanece `valid: true` após rotação
   para K2 (verificação retroativa com `keyId`).
3. Verificação pública `?format=icp` valida certificado demo e MARCA CLARAMENTE a
   simulação (produção: ICP-Brasil real).
4. ADR-027 com o design do voto secreto (mixnet de 3 fases / assinatura cega) revisado —
   pronto para a Onda 7 sem comprometer os recibos HMAC atuais.

### 14.3 Fase 27 — Multi-idioma e acessibilidade AA

> pt-BR/en/es na UI e no portal (next-intl já no package.json), auditoria WCAG 2.1 AA
> sistemática dos 26 módulos + telão + PWA + portal, e narração por áudio do telão para
> baixa visão (TTS server-side). **ADR-028. Status: 🗓 Planejado (Task 38-c).**

**Objetivo**: o produto fala o idioma do usuário (não apenas do tenant), atende AA de ponta
> a ponta com evidência auditável por release, e o telão ganha narração sintética para
> inclusão em plenário.

#### Modelo de dados (adicionais)

| Modelo/Campo | Regras |
|---|---|
| `User.locale` | `pt-BR` (default) \| `en` \| `es`; seletor do topbar persiste por usuário |
| `Tenant.defaultLocale` | idioma inicial de novos usuários e do PORTAL público (`?lang=` com cookie) |
| `AccessibilityAudit` | por release: módulo, critério WCAG, severidade, correção, `fixedInRelease` — alimenta o relatório da Central de Ajuda |

#### Rotas e componentes (adicionais)

| Rota/Componente | RBAC | Comportamento |
|---|---|---|
| `GET /api/v1/me/locale` · `PATCH /me/locale` | próprio usuário | leitura/gravação do idioma preferido |
| `POST /api/v1/display/narration` | `display.command` | gera áudio (TTS server-side, cache por texto+idioma) do estado atual do telão — pauta, votação aberta ou resultado |
| Seletor de idioma (topbar + portal) | — | troca sem recarregar; strings de módulo via next-intl com namespace por módulo (26 módulos × ~150 chaves estimadas) |

#### Critérios de aceite

1. Troca de idioma instantânea (sem reload) em todos os módulos, persistida por usuário;
   portal público servindo pt-BR/en/es com cookie `lang`.
2. Auditoria WCAG 2.1 AA executada (ferramenta + revisão manual de teclado/foco): achados
   classificados, bloqueantes corrigidos NA onda, relatório versionado por release na
   Central de Ajuda.
3. Narração do telão funcional (áudio gerado pelo TTS com cache) com controle de
   reprodução acessível por teclado.
4. Sem regressão visual: snapshots dos módulos nos 3 idiomas no test-report.

### 14.4 Fase 28 — Ecossistema amplo (adaptado ao sandbox)

> Marketplace de integrações com revisão, dados abertos no padrão CKAN/DCAT e a documentação
> do caminho para agente desktop (Tauri) e GraphQL opcional. **ADR-029. Status: 🗓 Planejado
> (Task 38-d).**

**Objetivo**: transformar as chaves legk_ e webhooks HMAC (F23/ADR-007/024) em um
> ecossistema consumível: catálogo in-app de integrações verificadas, datasets abertos no
> padrão usado por portais de transparência reais e um caminho claro para apps de terceiros.

#### Modelo de dados (adicionais)

| Modelo | Campos-chave | Regras |
|---|---|---|
| `MarketplaceApp` | `slug`, `name`, `category`, `summary`, `descriptionMd`, `scopes`, `webhookEvents`, `publisher`, `status ∈ draft\|in_review\|published\|retired`, `reviewNote?`, `reviewedBy?` | nível PLATAFORMA; publicação exige revisão registrada (padrão onboarding F24) |

#### Rotas (adicionais)

| Rota | Método | RBAC | Comportamento |
|---|---|---|---|
| `GET /api/v1/marketplace/apps` | GET | autenticado | catálogo `published` (público do tenant via portal em produção) |
| `GET/POST /api/v1/platform/marketplace/apps` · `PATCH …/:id` | GET/POST/PATCH | `platform.manage` | curadoria: submeter `draft`, revisar (`in_review` → `published`/`retired`) com nota |
| `GET /api/v1/public/open-data/ckan` | GET | público | dataset DCAT/CKAN (data.json + package_show JSON) das matérias/sessões/publicações — validável no validador CKAN |

Integrações & API ganha a aba **Explorar**: cards dos apps publicados com “instalar” =
criar chave legk_ com os escopos sugeridos + webhook opcional pré-configurado (um clique,
limites explícitos). Caminho de produção (ADR-029): revisão humana real de terceiros,
agente Tauri offline com sync por snapshot e gateway GraphQL sobre o mesmo contrato.

#### Critérios de aceite

1. 4–6 apps demo publicados (Transparência, CRM, Imprensa, BI local…), instaláveis com um
   clique (chave + webhook criados e exibidos uma única vez).
2. Dataset CKAN exportado e estruturalmente válido (data.json + package_show) com link
   permanente no Portal → Dados Abertos.
3. Curadoria auditada: draft → in_review → published com `reviewedBy`/nota; retire disponível.
4. ADR-029 registrando o caminho para terceiros reais, Tauri e GraphQL.

### 14.5 Ordem de execução (Tasks 38–40)

| Task | Fase | Executor | Dependências |
|---|---|---|---|
| 38 | Base da Onda 6: schema (`BackupRun`, `SigningKey`, `FederatedIdentity`, `User.locale`, `Tenant.defaultLocale`, `AccessibilityAudit`, `MarketplaceApp`, FTS5) + db:push + contracts + RBAC + api-client + seed (apps demo + tasks da Onda 6 no roadmap) + stubs | main | v0.13.0 |
| 38-a | Fase 25 — export-worker :3006 + backup diário + FTS5 + observabilidade (ADR-026) | subagente | Task 38 |
| 38-b | Fase 26 — SSO demo + key ring retroverificável + ICP simulada + design do voto secreto (ADR-027) | subagente | Task 38 |
| 38-c | Fase 27 — i18n pt-BR/en/es + auditoria WCAG AA + narração TTS (ADR-028) | subagente | Task 38 |
| 38-d | Fase 28 — marketplace + CKAN + caminho Tauri/GraphQL (ADR-029) | subagente | Task 38 |
| 39 | Integração final, reseed da base demo, `bun run lint` | main | Tasks 38-a–38-d |
| 40 | Verificação E2E (agent-browser) + flip do roadmap para v0.14.0 + documentação v0.14.0 (CHANGELOG, manual, ajuda, README, runbook, test-report, api-contract) | main + subagente docs | Task 39 |

> Nota de ambiente (aplica à onda inteira): a re-semente preserva os recibos/assinaturas
> determinísticos; a rotação de chaves deve manter a verificação retroativa nos seeds — o
> critério 2 da F26 é verificado no fechamento (Task 40) com o mesmo rigor das evidências da
> v0.13.0.
