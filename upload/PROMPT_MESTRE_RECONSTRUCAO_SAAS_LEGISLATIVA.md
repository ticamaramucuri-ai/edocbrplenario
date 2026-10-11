# Prompt mestre — reconstrução de uma suíte legislativa SaaS

Copie todo o conteúdo a partir de **INÍCIO DO PROMPT** para o agente de programação responsável pelo novo projeto.

---

## INÍCIO DO PROMPT

Você é o arquiteto principal e agente de implementação de uma nova plataforma legislativa SaaS para Câmaras Municipais brasileiras. Trabalhe como uma equipe sênior de produto, arquitetura, segurança, backend, frontend, dados, infraestrutura, UX, QA e migração.

Sua missão é projetar e implementar uma substituição moderna, segura e comprovadamente superior ao PainelDeskLegis 8.1. Não faça uma simples reprodução visual do sistema antigo. Preserve todos os fluxos úteis, corrija suas limitações estruturais e entregue um produto SaaS multiempresa, white-label, auditável, acessível, resiliente e preparado para operação real de plenário.

O produto ainda não possui nome definitivo. Use `Legis SaaS` como codinome interno e mantenha nome, domínio, marca e textos institucionais configuráveis.

### 1. Regras de trabalho obrigatórias

1. Antes de implementar uma fase, leia o repositório, os ADRs, contratos e critérios de aceite existentes.
2. Não invente regras regimentais universais. Implemente um motor configurável por tenant e documente os valores padrão.
3. Não substitua requisitos difíceis por mocks permanentes, TODOs silenciosos ou botões sem comportamento.
4. Não considere uma funcionalidade pronta apenas porque compila ou exibe uma tela.
5. Toda funcionalidade crítica deve ter persistência, autorização, auditoria, tratamento de erro e testes automatizados.
6. Preserve compatibilidade retroativa dos contratos publicados ou forneça migração e versionamento explícitos.
7. Use TypeScript estrito; proíba `any` não justificado e valide todo dado nas fronteiras.
8. Separe domínio, aplicação, infraestrutura e apresentação. Componentes de UI não acessam banco diretamente.
9. Use transações para alterações legislativas e idempotência para comandos repetíveis.
10. Toda operação sensível deve registrar ator, tenant, dispositivo, IP, horário, correlação, valores anteriores/posteriores e justificativa quando aplicável.
11. Recursos de IA são assistivos, sempre revisados por humano e nunca produzem efeito legislativo automático.
12. A solução deve continuar operando no plenário durante indisponibilidade temporária da internet.
13. Não adote microserviços inicialmente. Construa um monólito modular com limites claros, eventos e contratos que permitam extração futura.
14. Ao encontrar ambiguidade de baixo risco, escolha a alternativa mais segura e registre a decisão em ADR. Para decisões legais ou regimentais, implemente configuração e marque para homologação.
15. Mantenha um changelog de cada fase e um relatório objetivo de testes executados, falhas e riscos remanescentes.

### 2. Contexto comprovado do legado

O sistema anterior é um fat JAR Java 8/Swing com HSQLDB local, Hibernate/JPA 2.0, JasperReports, webcam, múltiplas telas e socket TCP local na porta 5678. Ele reúne administração, processo legislativo, condução de sessão, votação, discursos, telões, relatórios e integração com LegisWEB.

Entidades legadas principais:

- configuração e ativação;
- parlamentar;
- sessão;
- parlamentar na sessão/presença;
- tipo de proposição;
- protocolo/proposição;
- tramitação e anexo;
- votação;
- parlamentar na votação/voto;
- discurso;
- lote de proposições.

Use o arquivo `DIAGNOSTICO_PAINELDESKLEGIS_8_1.md` como fonte do inventário legado. Quando houver divergência entre esse diagnóstico e uma base real fornecida posteriormente, preserve os dados, registre a divergência e solicite homologação funcional.

### 3. Resultado esperado

Entregue uma plataforma composta por:

1. Console SaaS do operador da plataforma.
2. Backoffice legislativo de cada Câmara.
3. Mesa de controle do plenário em tempo real.
4. PWA de parlamentares e servidores autorizados.
5. Portal público de transparência e acompanhamento ao vivo.
6. Painéis/telões responsivos para plenário e transmissão.
7. Agente local desktop para hardware e continuidade offline.
8. API pública e privada versionada.
9. Motor de relatórios e documentos.
10. Importador auditado do PainelDeskLegis/HSQLDB.

### 4. Stack obrigatória

Use versões estáveis compatíveis entre si e fixe versões por lockfile. Não use versões beta, canary ou release candidate em produção.

#### 4.1 Monorepo

- pnpm workspaces.
- Turborepo.
- TypeScript em modo estrito.
- Biome para formatação/lint principal e ESLint apenas onde um plugin específico for necessário.
- Changesets para versionamento de pacotes compartilhados.
- Conventional Commits e hooks leves de pre-commit.

Estrutura inicial:

```text
apps/
  web/                 # Next.js: backoffice, console SaaS, PWA e portal
  api/                 # NestJS/Fastify: API, WebSocket e workers
  edge-agent/          # Tauri 2/Rust: plenário, offline e hardware
packages/
  contracts/           # schemas Zod, DTOs, eventos e cliente tipado
  domain/              # tipos, políticas e regras puras compartilháveis
  database/            # Drizzle, migrations, seeds e RLS
  ui/                  # design system acessível
  config/              # configurações compartilhadas
  observability/       # logs, traces e métricas
  testkit/             # factories, fixtures e helpers
infra/
  compose/
  helm/
  terraform/examples/
docs/
  adr/
  api/
  domain/
  operations/
```

#### 4.2 Web

- Next.js 16 com App Router e React 19.
- Tailwind CSS e shadcn/ui, com tokens próprios de design.
- TanStack Query para estado de servidor e TanStack Table para grades complexas.
- React Hook Form e Zod para formulários.
- PWA instalável com service worker, atualização controlada e notificações push.
- Server Components por padrão; Client Components somente quando houver interação ou API de navegador.
- Rotas separadas para console SaaS, backoffice, plenário, PWA e portal público.

#### 4.3 Backend

- NestJS com adaptador Fastify.
- REST em `/api/v1`, OpenAPI 3.1 e cliente gerado/tipado.
- WebSocket autenticado para tempo real.
- Drizzle ORM e SQL explícito para consultas complexas, RLS e relatórios.
- BullMQ e Redis para filas, jobs, locks e eventos efêmeros.
- Outbox transacional para publicação confiável de eventos.
- Armazenamento S3-compatible; MinIO em desenvolvimento.
- OIDC/OAuth 2.1, MFA, RBAC e ABAC contextual.

#### 4.4 Agente local

- Tauri 2 e Rust estável.
- SQLite com migrações para cache, snapshots, comandos pendentes e log local.
- WebSocket seguro com fallback para sincronização HTTP.
- Janelas sem moldura e configuráveis por monitor, resolução e função.
- Adaptadores de áudio, câmera, biometria, impressora e outros periféricos atrás de interfaces.
- Atualização assinada, health check, diagnóstico exportável e rollback de versão.
- Nunca grave credenciais permanentes em texto puro; use o cofre seguro do sistema operacional.

#### 4.5 Infraestrutura

- Docker Compose para ambiente completo local.
- Imagens OCI mínimas, non-root e com health checks.
- Helm para Kubernetes, sem exigir Kubernetes no desenvolvimento.
- PostgreSQL 18, Redis e armazenamento S3-compatible.
- OpenTelemetry, Prometheus, Grafana e Loki; integração opcional compatível com Sentry.
- Segredos externos; nunca versionar credenciais.
- Backups criptografados e testes automáticos de restauração.

### 5. Arquitetura e isolamento multi-tenant

Use banco PostgreSQL compartilhado com coluna `tenant_id` nas tabelas pertencentes a uma Câmara e Row-Level Security como segunda barreira de segurança.

Requisitos:

- O tenant deve ser resolvido por sessão autenticada, não por valor arbitrário enviado pelo cliente.
- Toda transação deve configurar o contexto de tenant e ator no banco.
- Políticas RLS devem ser testadas com casos positivos e negativos.
- Tabelas globais devem ser explicitamente identificadas e conter apenas dados da plataforma.
- Índices compostos devem começar por `tenant_id` quando isso beneficiar filtros dominantes.
- Chaves naturais únicas devem considerar tenant quando forem locais à Câmara.
- Suporte futuro a banco dedicado por tenant enterprise sem alterar contratos de domínio.
- Impersonação de suporte exige permissão elevada, motivo, banner visível, prazo e auditoria.

### 6. Identidade, papéis e permissões

Implemente OIDC com possibilidade de provedor próprio ou SSO institucional. Modele ao menos:

- `platform_owner`: operação global do SaaS.
- `platform_support`: suporte com acesso controlado.
- `tenant_admin`: administração da Câmara.
- `legislative_admin`: processo legislativo e cadastros.
- `session_operator`: condução da sessão.
- `presiding_officer`: ações exclusivas da presidência.
- `parliamentarian`: presença, consulta e voto autorizado.
- `committee_member`: operações restritas à comissão.
- `communications`: portal, transmissão e publicações.
- `auditor`: leitura de dados e auditoria.
- `citizen`: acesso público/autenticado quando necessário.

Permissões devem ser granulares, por recurso e ação. Considere contexto de legislatura, comissão, sessão, mandato, dispositivo credenciado e estado do fluxo.

### 7. Módulos do domínio

Cada módulo deve possuir entidades, serviços de aplicação, políticas, repositórios, controladores, eventos, auditoria e testes próprios.

#### 7.1 Plataforma SaaS

- Tenants, unidades legislativas, domínios e white-label.
- Planos, assinatura, trial, limites, cobrança e inadimplência configurável.
- Feature flags e entitlements por plano/tenant.
- Onboarding, convite, suporte e health score.
- Métricas de uso sem expor conteúdo legislativo indevido.
- Exportação integral e encerramento seguro do tenant.

#### 7.2 Estrutura institucional

- Legislaturas, períodos legislativos e calendários.
- Parlamentares, mandatos, suplências, afastamentos e situações.
- Partidos, blocos, bancadas, gabinetes e lideranças.
- Mesa diretora, cargos e períodos de vigência.
- Comissões permanentes/temporárias, membros, funções e reuniões.
- Pessoas, cidadãos, autoridades, entidades e grupos envolvidos.

#### 7.3 Processo legislativo

- Tipos de matéria/proposição configuráveis.
- Protocolo, número, ano, autoria múltipla, coautoria e subscrição.
- Ementa, texto integral, anexos, versões e relacionamentos.
- Regime de tramitação, situação, prioridade e prazos.
- Despachos, pareceres, emendas, substitutivos, vetos e sanções.
- Fluxos configuráveis por tipo, com etapas, transições, responsáveis e SLA.
- Tarefas, alertas, pendências e histórico temporal.
- Publicação e classificação de transparência por campo/documento.

#### 7.4 Sessões e reuniões

- Tipos: ordinária, extraordinária, solene, especial, audiência, comissão e outros configuráveis.
- Número, data, período, local/plenário, presidente e secretaria.
- Estados mínimos: `draft`, `scheduled`, `check_in`, `open`, `suspended`, `resumed`, `closed`, `cancelled`.
- Toda transição deve validar pré-condições e gerar evento/auditoria.
- Agenda com expediente, ordem do dia e blocos configuráveis.
- Reordenação, retirada, adiamento, preferência e inclusão extraordinária com justificativa.
- Controle de presença e quórum em tempo real.
- Linha do tempo completa da sessão.

#### 7.5 Presença e quórum

- Check-in por operador, PWA, QR Code, terminal local ou biometria opcional.
- Credenciamento e revogação de dispositivos.
- Presente, ausente, licenciado, afastado e saída temporária.
- Histórico de entradas/saídas; não sobrescrever o passado.
- Regras de quórum configuráveis por tipo de sessão, etapa e matéria.
- Snapshot do quórum no momento da abertura e de cada votação.
- Alertas quando o quórum cair abaixo do necessário.

#### 7.6 Pauta, lotes e ordem do dia

- Construção de pauta por busca, filtros e seleção múltipla.
- Itens individuais, atas e lotes de proposições.
- Ementa própria do lote e lista ordenada de itens.
- Quórum de deliberação e aprovação por item.
- Estados de leitura, discussões e votação configuráveis.
- Versões publicadas da pauta com data e autor da mudança.
- Comparação entre versões e atualização ao vivo do portal.

#### 7.7 Votação

- Modos nominal, simbólico e secreto quando legalmente configurado.
- Opções Sim, Não, Abstenção, ausência, impedimento e opções customizadas aprovadas.
- Estados: `draft`, `ready`, `open`, `paused`, `closed`, `annulled`.
- Idempotência por `votingId + parliamentarianId + commandId`.
- Política configurável para alteração do voto enquanto aberta.
- Bloqueio absoluto após fechamento, salvo anulação formal e auditada.
- Snapshot de presença, elegibilidade e quórum no início/fechamento.
- Cálculo determinístico de resultado, maioria e desempate.
- Voto secreto não pode ser correlacionável no resultado; preserve prova de elegibilidade sem quebrar sigilo.
- Voto nominal deve registrar recibo verificável, dispositivo e horário.
- Possibilidade de ocultar resultados parciais até o fechamento.
- Subscrição e declaração de voto.
- Operações simultâneas devem usar controle de concorrência otimista e locks de curta duração.

#### 7.8 Discursos e tempo

- Lista de oradores, ordem e prioridade.
- Parlamentar, cidadão, autoridade ou representante de grupo.
- Momento, tipo, assunto e classificação situação/oposição quando aplicável.
- Tempo previsto, utilizado e saldo.
- Iniciar, pausar, retomar, acrescentar tempo e encerrar.
- Eventos de relógio baseados em horário monotônico no agente local.
- Reconciliação com servidor sem saltos visuais.
- Alertas sonoros configuráveis e acessíveis.
- Transcrição e geração assistida de resumo opcionais, sempre revisáveis.

#### 7.9 Painéis e plenário

- Editor de layouts baseado em componentes, sem classes duplicadas por resolução.
- Perfis: boas-vindas, silêncio, presença, pauta, votação, discurso, ordem do dia, intervalo e encerramento.
- Grade responsiva para qualquer quantidade de parlamentares.
- Saída por monitor, videowall ou URL de navegador em modo kiosk.
- Temas, brasão, cores, fundos, tipografia e áreas seguras configuráveis.
- Contraste, legibilidade à distância e fallback quando foto estiver ausente.
- Atualização em tempo real por eventos versionados.
- Snapshot local para reconstruir a tela após reinício.
- Controles de congelar, limpar, pré-visualizar e publicar.

#### 7.10 Documentos e relatórios

- Pauta, ata, espelho de sessão, presença, discursos, votação nominal e ficha parlamentar.
- Templates versionados por tenant.
- PDF acessível quando tecnicamente aplicável e HTML para visualização pública.
- Jobs assíncronos com progresso, retentativa e expiração.
- Assinatura eletrônica por adaptador, incluindo integração futura ICP-Brasil.
- QR Code ou código de verificação para documentos públicos.
- Nunca interpolar SQL ou HTML não sanitizado em templates.

#### 7.11 Portal público e dados abertos

- Página institucional white-label e domínio próprio.
- Sessões futuras, em andamento e históricas.
- Pauta ao vivo, presença, votações, discursos e documentos publicados.
- Pesquisa por número, ano, tipo, autor, assunto, texto e tramitação.
- Dados abertos em JSON/CSV e API pública com rate limit.
- Sitemap, metadados sociais, SEO e URLs permanentes.
- Política clara para dados pessoais, sigilo e despublicação justificada.
- Canal de acompanhamento/assinatura e notificações.
- Acessibilidade WCAG 2.2 AA e recomendações eMAG.

#### 7.12 Integrações

- Webhooks assinados com HMAC, timestamp, proteção contra replay e rotação de segredo.
- Retentativa exponencial, dead-letter queue e reenvio manual auditado.
- Adaptadores para LegisWEB, diário oficial, e-mail, WhatsApp, streaming, assinatura e sistemas municipais.
- Mapeamento externo por tenant e sistema, sem reutilizar IDs externos como chave primária.
- Importação/exportação idempotente com relatório de conflitos.

#### 7.13 IA assistiva

- OCR de documentos.
- Transcrição de sessão e identificação assistida de trechos.
- Minuta de ata e resumo de tramitação.
- Sugestão de ementa e classificação temática.
- Busca semântica com permissão e isolamento por tenant.
- Detecção de campos ausentes e inconsistências.
- Toda saída deve indicar origem, modelo, versão, horário e responsável pela aprovação.
- Proíba aprovação, publicação, voto, alteração de resultado ou transição legislativa automática por IA.

### 8. Modelo de dados mínimo

Use UUIDv7 ou identificadores ordenáveis equivalentes para novas entidades. Datas devem ser armazenadas em UTC e exibidas no fuso do tenant. Datas legislativas sem horário devem usar tipo `date`.

Entidades mínimas:

```text
Tenant, TenantDomain, TenantTheme, Plan, Subscription, Entitlement
User, Identity, Role, Permission, Membership, SupportImpersonation
Legislature, LegislativePeriod, Party, Bloc, Office, Committee
Person, Parliamentarian, Mandate, Leave, LeadershipPosition
MatterType, LegislativeMatter, Authorship, MatterVersion, RelatedMatter
Protocol, WorkflowDefinition, WorkflowStep, Proceeding, Deadline, Task
Attachment, Document, DocumentTemplate, ElectronicSignature
SessionType, Session, SessionAgenda, AgendaSection, AgendaItem, AgendaVersion
AttendanceEvent, AttendanceSnapshot, QuorumRule, QuorumSnapshot
Voting, VotingOption, EligibilitySnapshot, Vote, VotingResult, VoteReceipt
SpeechQueue, Speech, TimerEvent, Transcript, ReviewedSummary
DisplayProfile, DisplayLayout, DisplayInstance, Device, DeviceCredential
Notification, WebhookEndpoint, WebhookDelivery, IntegrationMapping
AuditEvent, OutboxEvent, IdempotencyKey, SyncCheckpoint, SyncConflict
MigrationRun, MigrationMapping, MigrationIssue, ReconciliationResult
```

Requisitos de persistência:

- Soft delete apenas onde fizer sentido; registros legislativos consumados devem ser anulados/versionados, não apagados.
- Colunas `created_at`, `updated_at`, `created_by`, `updated_by` nas entidades mutáveis.
- Versão otimista em agregados concorrentes.
- Histórico append-only para presença, voto, timer, estado da sessão e auditoria.
- Integridade referencial real no banco.
- Índices documentados a partir dos casos de consulta.
- Política explícita de retenção e anonimização por categoria de dado.

### 9. Máquinas de estado

Implemente máquinas de estado explícitas e testadas. Não permita alterar `status` diretamente por CRUD genérico.

Cada transição deve possuir:

- comando dedicado;
- permissões necessárias;
- estados de origem válidos;
- pré-condições;
- efeitos transacionais;
- evento de domínio;
- auditoria;
- erro de negócio estável e documentado;
- testes positivos, negativos e concorrentes.

Inclua pelo menos máquinas para sessão, pauta publicada, matéria, tramitação, votação, discurso, documento e migração.

### 10. APIs e contratos

#### 10.1 REST

- Prefixo `/api/v1`.
- OpenAPI 3.1 gerado e validado no CI.
- Paginação por cursor para listas grandes.
- Filtros tipados, ordenação permitida por allowlist e busca textual segura.
- Erros no formato Problem Details com `type`, `title`, `status`, `detail`, `code`, `correlationId` e erros de campo.
- `Idempotency-Key` obrigatório em comandos críticos externos.
- ETags/versionamento para edição concorrente quando aplicável.
- Endpoints públicos separados dos administrativos.

#### 10.2 Eventos WebSocket

Envelope obrigatório:

```ts
type RealtimeEvent<T> = {
  eventId: string;
  eventType: string;
  schemaVersion: number;
  tenantId: string;
  sessionId?: string;
  aggregateId: string;
  aggregateVersion: number;
  occurredAt: string;
  origin: 'cloud' | 'edge' | 'pwa' | 'operator' | 'integration';
  correlationId: string;
  payload: T;
};
```

Requisitos:

- Autenticação no handshake e renovação segura.
- Salas/namespaces por tenant e sessão.
- Autorização por evento/comando.
- Sequência por agregado, detecção de lacuna e recuperação por snapshot.
- Heartbeat, reconexão exponencial e limite de backpressure.
- Eventos públicos devem conter somente campos aprovados para transparência.

#### 10.3 Sincronização edge/cloud

Use protocolo explícito:

1. Agente obtém snapshot assinado e checkpoint.
2. Registra comandos locais em log append-only antes de aplicá-los.
3. Envia lote com `commandId`, sequência local e idempotency key.
4. Servidor confirma individualmente aceito, rejeitado ou em conflito.
5. Agente avança checkpoint somente após confirmação durável.
6. Lacunas geram ressincronização por eventos ou novo snapshot.
7. Conflitos nunca são descartados silenciosamente.

Durante indisponibilidade, permita apenas comandos que a política offline autorizar. Fechamento definitivo de votação, anulação, publicação formal e outras ações de alto impacto devem exigir regra explícita e posterior reconciliação.

### 11. Segurança e privacidade

- Senhas com Argon2id quando houver credencial local; preferir OIDC.
- MFA obrigatório para operadores privilegiados.
- TLS em trânsito e criptografia em repouso.
- Cookies `HttpOnly`, `Secure`, `SameSite` apropriado; proteção CSRF quando aplicável.
- CSP restritiva, proteção contra XSS, SSRF, injection, path traversal e upload malicioso.
- Upload com limite, MIME real, checksum, quarentena e antivírus configurável.
- Rate limit por IP, usuário, tenant e endpoint.
- Segredos em secret manager, com rotação.
- Logs sem tokens, senhas, biometria bruta ou conteúdo pessoal desnecessário.
- Biometria deve ser opcional, com template protegido, consentimento/base legal configurada e alternativa operacional.
- Votos secretos precisam de desenho criptográfico revisado por especialista antes de produção.
- Threat model para votação, impersonação, tenant escape, replay, insider, indisponibilidade e adulteração de telão.
- SAST, dependency scanning, secret scanning, SBOM e assinatura de imagens/releases no CI.

### 12. Auditoria e conformidade

- Auditoria append-only e resistente a adulteração, com encadeamento/hash por lote quando viável.
- Exportação verificável da trilha por sessão/processo.
- LGPD: inventário de dados, finalidade, base legal configurável, minimização, retenção e atendimento ao titular.
- LAI/transparência: classificação pública, restrita ou sigilosa por recurso e documento.
- Acessibilidade: WCAG 2.2 AA e eMAG, incluindo teclado, foco, leitor de tela, contraste, zoom e redução de movimento.
- Regras jurídicas e regimentais devem ser submetidas à homologação da Câmara; não declare conformidade apenas com testes técnicos.

### 13. UX e design system

- Interface em português do Brasil, pronta para i18n.
- Design institucional moderno, sóbrio e de alta legibilidade.
- Navegação por módulos e ações contextuais, não por telas monolíticas.
- Dashboard orientado a pendências, próximas sessões, prazos e saúde operacional.
- Tabelas com filtros persistentes, colunas configuráveis, exportação e estados vazios úteis.
- Confirmação reforçada para anulação, encerramento, exclusão e publicação.
- Atalhos de teclado na mesa do plenário, com ajuda visível.
- Status de conexão, sincronização e agente local sempre visíveis durante sessão.
- Telões devem priorizar leitura à distância e não reproduzir a densidade do backoffice.
- Nunca depender somente de cor para transmitir voto ou presença.

### 14. Migração integral do legado

Crie um importador separado, reproduzível e somente leitura na origem.

Fontes esperadas:

- arquivos HSQLDB do PainelDeskLegis;
- fotos e cards;
- anexos de tramitação;
- fundos, brasão e sons;
- arquivos de configuração;
- possíveis exports LegisWEB.

Fluxo obrigatório:

1. `inspect`: identifica versão, tabelas, colunas, contagens e arquivos.
2. `validate`: detecta órfãos, duplicidades, datas inválidas, encoding e arquivos ausentes.
3. `plan`: produz mapeamento e impacto sem gravar no destino.
4. `dry-run`: executa transformação em staging descartável.
5. `import`: grava em lotes transacionais e retomáveis.
6. `reconcile`: compara contagens, somatórios, amostras e checksums.
7. `report`: gera relatório HTML/JSON assinado com divergências.
8. `rollback`: remove somente dados associados ao `migrationRunId`, se ainda não homologados.

Preserve IDs legados em tabela de mapeamento; não os use como IDs primários novos. Registre fonte, tabela, ID original, transformações e avisos. Nunca deduza silenciosamente um voto, presença ou resultado ausente.

### 15. Observabilidade e operação

- Logs JSON com correlation ID, tenant e serviço, evitando dados sensíveis.
- Traces distribuídos de HTTP, WebSocket, filas, banco e integrações.
- Métricas de latência, erros, conexões, filas, sincronização, jobs e uso de recursos.
- Painel operacional da sessão com saúde de API, Redis, banco, agente e telões.
- Alertas para fila travada, agente offline, lag de eventos, falha de backup e erro de integração.
- Runbooks de indisponibilidade, restauração, rotação de segredo e sessão offline.
- SLOs iniciais documentados e revisados após piloto.

### 16. Testes obrigatórios

#### 16.1 Unitários

- Regras de quórum e maioria.
- Máquinas de estado.
- Elegibilidade e cálculo de votação.
- Cronômetro e acréscimos.
- Políticas de autorização.
- Mapeamentos de migração.

#### 16.2 Integração

- PostgreSQL real via Testcontainers, incluindo RLS.
- Redis/BullMQ e outbox.
- S3-compatible.
- OIDC de teste.
- Webhooks, assinatura e retentativas.
- Importação HSQLDB quando a fonte for disponibilizada.

#### 16.3 Contrato

- OpenAPI sem breaking changes não autorizados.
- Eventos WebSocket por versão.
- Sincronização edge/cloud.
- Webhooks e clientes gerados.

#### 16.4 E2E

- Criar, agendar, abrir, suspender, retomar e encerrar sessão.
- Registrar presença simultânea e recalcular quórum.
- Criar pauta, publicar versão e exibi-la no portal.
- Abrir votação, receber votos concorrentes, impedir duplicidade e fechar resultado.
- Pausar/reiniciar agente durante votação sem perder comandos.
- Conduzir discurso com timer e telão.
- Gerar e verificar relatório.
- Confirmar isolamento entre dois tenants.
- Validar impersonação auditada.

#### 16.5 Não funcionais

- k6 para múltiplas Câmaras, sessões, PWA, telões e portal.
- Testes de caos controlado: queda de internet, API, Redis, banco e reinício do agente.
- axe-core, navegação por teclado e testes manuais com leitor de tela.
- Backup e restauração em ambiente descartável.
- Segurança conforme OWASP ASVS proporcional ao risco.

### 17. Critérios de aceite críticos

Uma release de piloto somente pode ser aprovada quando:

- uma sessão completa funcionar ponta a ponta;
- o plenário continuar operando durante perda temporária de internet;
- nenhum voto confirmado for perdido ou duplicado;
- resultados forem determinísticos e reproduzíveis;
- isolamento de tenant tiver testes negativos automatizados;
- ações críticas aparecerem na auditoria;
- o agente reconstruir telões após reinício;
- relatórios e portal refletirem somente dados publicados;
- a migração produzir reconciliação verificável;
- não existirem vulnerabilidades críticas conhecidas;
- não houver violações críticas de acessibilidade automatizada;
- backup tenha sido restaurado com sucesso;
- documentação operacional permitir que outra pessoa execute o ambiente.

### 18. Plano de implementação obrigatório

Execute em fases. Ao final de cada fase, entregue código funcional, migrations, testes, documentação e demonstração reproduzível.

#### Fase 0 — Descoberta e arquitetura

- Confirmar requisitos e glossário.
- Criar mapa de contexto, modelo de domínio e diagramas C4.
- Escrever ADRs de tenancy, autenticação, auditoria, tempo real, offline, armazenamento e migração.
- Definir contratos iniciais e critérios de aceite.
- Produzir threat model e matriz de permissões.

#### Fase 1 — Fundação

- Monorepo, CI, ambientes e observabilidade.
- PostgreSQL, migrations, RLS, Redis, S3 e outbox.
- OIDC, usuários, memberships, RBAC e auditoria.
- Tenant, white-label, plano e entitlements.
- Design system e shell dos aplicativos.

#### Fase 2 — Estrutura e processo legislativo

- Legislaturas, mandatos, partidos, mesa e comissões.
- Pessoas, parlamentares e grupos.
- Tipos, protocolos, matérias, anexos e autoria.
- Workflow configurável, tramitação, prazos e tarefas.

#### Fase 3 — Sessão e votação

- Sessões, agenda, presença, quórum e estados.
- Pauta, lotes, discussões e ordem do dia.
- Votação, votos, resultados, recibos e auditoria.
- WebSocket e mesa de controle em tempo real.

#### Fase 4 — Discursos, telões e PWA

- Fila de oradores e cronômetros.
- Painéis responsivos e editor de layout.
- PWA parlamentar, credenciamento e push.
- Modo kiosk e pré-visualização.

#### Fase 5 — Portal, relatórios e integrações

- Portal público, pesquisa e dados abertos.
- Templates e relatórios.
- Webhooks e primeiros adaptadores.
- Publicação controlada e transparência.

#### Fase 6 — Agente local e offline

- Tauri, SQLite, dispositivos e múltiplos monitores.
- Snapshots, log local e sincronização.
- Operação degradada, recuperação e diagnóstico.
- Testes de falha e atualização assinada.

#### Fase 7 — Migração e piloto

- Importador HSQLDB e arquivos.
- Dry-run, reconciliação e correções.
- Operação paralela controlada.
- Treinamento, runbooks, rollback e homologação.

#### Fase 8 — Expansões

- IA assistiva.
- Assinaturas avançadas.
- Integrações adicionais.
- Analytics e otimizações baseadas em dados reais.

### 19. Protocolo de entrega do agente

Antes de codificar cada fase, apresente:

1. Objetivo da fase.
2. Requisitos atendidos.
3. Decisões e ADRs necessários.
4. Alterações de schema e contratos.
5. Riscos e plano de teste.

Depois de codificar, apresente:

1. Resultado funcional entregue.
2. Arquivos e módulos relevantes.
3. Migrations executadas.
4. Testes executados e resultados reais.
5. Evidência de critérios de aceite.
6. Dívidas ou riscos remanescentes.
7. Instruções reproduzíveis para executar e validar.

Se algum teste não puder ser executado, informe claramente o motivo. Nunca apresente teste não executado como aprovado.

### 20. Definition of Done

Uma história está concluída somente quando:

- regra de negócio e estados estão implementados;
- autorização e isolamento de tenant foram aplicados;
- dados são persistidos por migration versionada;
- auditoria existe quando necessária;
- erros são tratados e observáveis;
- UX inclui loading, vazio, erro e sucesso;
- acessibilidade foi considerada;
- testes proporcionais ao risco passam;
- contrato/documentação foi atualizado;
- não há TODO ocultando requisito obrigatório;
- o fluxo pode ser demonstrado ponta a ponta.

Comece pela Fase 0. Não tente implementar toda a plataforma em uma única alteração. Construa fundações verificáveis, preserve rastreabilidade entre requisitos e código e mantenha o sistema executável ao final de cada fase.

## FIM DO PROMPT
