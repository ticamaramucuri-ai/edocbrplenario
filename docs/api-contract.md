# Contrato da API `/api/v1` — Legis SaaS

Fonte única de verdade compartilhada por backend e frontend. Tipos em `src/lib/contracts.ts`.
Cobre as Ondas 1–4 (fases 0–20): **~75 grupos de rotas** (internas, de plataforma e
públicas), a matriz RBAC completa, os eventos outbox e de auditoria e as regras de rate
limit dos endpoints públicos.

## Convenções gerais

- **Ator**: rotas internas usam sessão autenticada; `x-actor-id` só funciona no modo
  demonstrativo explícito fora de produção. Resolução em `src/lib/server/actor.ts`.
- **Tenant**: NUNCA vem do cliente para escopo de dados. O tenant é derivado do ator
  (`actor.tenantId`), exceto papéis `platform_*` (escopo global) e endpoints públicos
  (`/api/v1/public/*`) que recebem `?tenant=slug`.
- **Erros**: Problem Details:
  ```json
  { "type": "https://legis-saas/errors/forbidden", "title": "Acesso negado",
    "status": 403, "detail": "...", "code": "FORBIDDEN_ROLE",
    "correlationId": "uuid" }
  ```
  Códigos estáveis: `UNAUTHENTICATED`, `FORBIDDEN_ROLE`, `FORBIDDEN_TENANT`,
  `NOT_FOUND`, `VALIDATION_ERROR`, `CONFLICT_VERSION`, `SESSION_INVALID_TRANSITION`,
  `SESSION_PRECONDITION`, `VOTING_INVALID_TRANSITION`, `VOTING_NOT_OPEN`,
  `VOTE_PARLIAMENTARIAN_NOT_PRESENT`, `VOTE_CHANGE_NOT_ALLOWED`,
  `VOTE_DUPLICATE_COMMAND`, `QUORUM_INSUFFICIENT` (warning, não erro em close),
  `AGENDA_INVALID_STATE`, `SPEECH_INVALID_TRANSITION`. O **429** de rate limit (Onda 4)
  usa Problem Details com `code: "RATE_LIMITED"` + `retryAfterSeconds` + header
  `Retry-After` (montado fora de `ApiErrorCode`, contrato estável).
- **Versão otimista**: comandos de transição aceitam `version` no body; divergência →
  409 `CONFLICT_VERSION`.
- **Idempotência**: `POST /votings/:id/votes` exige `commandId` (uuid) no body.
- **Matriz RBAC** (`src/lib/server/rbac.ts`):
  | Ação | Papéis permitidos |
  |---|---|
  | tenant.update | tenant_admin, platform_owner |
  | parliamentarian.write | tenant_admin, legislative_admin |
  | matter.write | tenant_admin, legislative_admin |
  | session.create | tenant_admin, legislative_admin |
  | session.transition | session_operator, presiding_officer, tenant_admin |
  | attendance.write | session_operator, tenant_admin |
  | voting.write (criar/transições) | session_operator, presiding_officer, tenant_admin |
  | vote.cast | session_operator, presiding_officer, parliamentarian (próprio) |
  | speech.write | session_operator, tenant_admin |
  | display.command | session_operator, tenant_admin |
  | media.read / media.manage | media_operator, session_operator, tenant_admin |
  | audit.read | auditor, tenant_admin, platform_owner |
  | subscription.manage | tenant_admin, legislative_admin |
  | platform.read (system-status/alerts/help) | platform_owner, platform_support |
  | impersonation.manage | platform_owner, platform_support |
  | public.* | sem autenticação (rate limit REAL desde a Fase 19 — ver Onda 4) |

## Rotas

### GET `/api/v1/bootstrap`
Sem parâmetros (usa tenant do ator; `platform_*` usa `?tenant=slug`, default primeiro tenant).
→ `BootstrapView` (types). **Primeira chamada do frontend.**

### GET `/api/v1/sessions`
→ `{ sessions: SessionSummary[] }` ordenadas por scheduledAt desc. Inclui `presentCount`
derivado (presença atual), `agendaCount`, `totalMembers`.

### POST `/api/v1/sessions`
Body: `{ type: SessionType, scheduledAt: ISO, presidentId, secretaryName?, notes?, matterIds?: string[] }`
Cria sempre em `draft` com pauta preliminar (expediente fixo + ordem_do_dia pelas matérias selecionadas + comunicações). A pauta só é publicada pela transição `schedule`. A numeração anual é alocada atomicamente por Câmara; o ano usa o fuso configurado da Câmara. `matterIds` duplicados e tipos de sessão desabilitados para a Câmara são rejeitados.
→ `{ session: SessionSummary }` (201).

### GET `/api/v1/sessions/:id`
→ `SessionDetail` completo (session, agenda, attendance atual, quorum, votings com votos,
speeches). Votos de votação **secreta** retornam `votes: null`. `votes` incluídos para
todos os papéis internos (transparência nominal) exceto secreto.

### PATCH `/api/v1/sessions/:id`
Permissão `session.create`. Somente `draft`. Body: `{ version, type?, scheduledAt?, presidentId?, secretaryName?, location?, notes? }`, com ao menos um campo além de `version`.
→ `{ session: SessionSummary }`. Incrementa a versão e audita antes/depois. Rejeita versão desatualizada, tipo desabilitado, presidente inativo/de outra Câmara e data em ano diferente da numeração anual. Campos nulos removem secretário e observações.

### POST `/api/v1/sessions/:id/transition`
Body: `{ action, version, justification?, noticeExceptionReason? }`; `noticeExceptionReason` só é aceito em `schedule` quando o prazo mínimo da Câmara não é atendido e o tipo de sessão admite exceção.
Actions: `schedule` (draft→scheduled, publica pauta), `open_checkin` (scheduled→check_in),
`open_session` (check_in→open; exige presidente; exige quórum mínimo? — NÃO bloquear,
apenas registrar alerta), `suspend` (open|resumed→suspended), `resume` (suspended→resumed),
`close` (open|suspended|resumed→closed), `cancel` (draft|scheduled|check_in→cancelled, exige justificativa).
→ `{ session: SessionSummary, quorum: QuorumInfo }`. Emite `session.state_changed` +
`session.quorum` (outbox). Auditoria `session.<action>`.
`schedule` valida a política vigente do tenant (tipo habilitado, secretário quando exigido, mínimo de matérias e presidente ativo). Registra a revisão 1 da pauta e uma cópia da política usada, sem alterar revisões anteriores.
Também verifica `minimumNoticeHours` da Câmara e emite, na mesma transação, conteúdo de convocação e SHA-256. Mesmo com mínimo 0, a data da sessão deve estar no futuro. A exceção exige motivo público e tipo habilitado em `urgentNoticeExceptionTypes`.

### GET `/api/v1/sessions/:id/agenda-revisions`
→ `{ revisions: [{ id, number, createdAt, actorId, agenda, policy, change, justification, notice, noticeSha256 }] }`, somente no escopo da Câmara do ator. `change`/`justification` são nulos na publicação inicial. `notice`/`noticeSha256` podem ser nulos em revisões legadas; o sistema não fabrica histórico.

### GET `/api/v1/public/sessions/:id/notices?tenant=slug&revision=n`
Sem autenticação, mas escopado pela Câmara pública e por sessão não rascunho. `revision` é opcional; sem ela, retorna a convocação mais recente. → `{ revision, publishedAt, sha256, notice }`. Convocação ausente ou pertencente a outra Câmara → 404. O SHA-256 corresponde aos bytes UTF-8 do JSON serializado em `notice`.

### GET/POST `/api/v1/me/notices`
`GET` exige parlamentar autenticado/vinculado e `sessionId` na query; retorna `{ notice }` da revisão vigente da sessão, ou `null` quando não há destinatário. `POST` exige `{ sessionId, revision, noticeSha256 }`; confirma ciência somente se ambos correspondem à convocação vigente e o ator consta da lista congelada. Resposta idempotente; revisão alterada retorna 409. Essa confirmação não é prova de entrega externa.

### GET `/api/v1/sessions/:id/notice-recipients`
Exige `session.transition`; devolve a revisão vigente, hash, total, número de ciências e lista de nomes/horários dos destinatários daquela Câmara. Revisões legadas sem convocação retornam revisão nula.

### GET `/api/v1/sessions/:id/notice-recipient-preview`
Exige `session.transition`; devolve `{ policy, total, recipients: [{ id, name }] }` para a próxima publicação/retificação. `active` inclui parlamentares ativos. `mandate_and_leave` exige mandato na data civil da sessão no fuso da Câmara, exclui titular afastado e inclui suplente ativo explicitamente indicado. A política é configurada em `PATCH /api/v1/tenants/:id` pelo campo `settings.noticeRecipientPolicy`. A prévia pode mudar; só a lista gravada na revisão é definitiva. Sem elegíveis nesse modo, publicar ou retificar retorna 409.

### Política de votação por tipo de matéria
`PATCH /api/v1/tenants/:id` aceita `settings.votingPoliciesByMatterType`, objeto com chaves de tipo de matéria e valores `{ rule, quorumMinimum }` (`quorumMinimum` entre 1 e 100). Em `POST /api/v1/sessions/:id/votings`, uma votação vinculada a matéria herda a regra configurada; enviar regra divergente retorna 422. A resposta inclui `requiredQuorum` e, após a abertura, `memberBaseAtOpen`. `POST /api/v1/votings/:id/transition` verifica o quórum gravado na votação, registra a base de membros na abertura e reutiliza ambos no fechamento. Votações sem política específica seguem o quórum geral e a regra enviada pela Mesa.

### Base deliberativa
`PATCH /api/v1/tenants/:id` aceita `settings.deliberativeRosterPolicy` = `active` (padrão) ou `mandate_and_leave`. Neste último modo, presença e quórum filtram mandatos vigentes na data civil da sessão, excluem titulares afastados e incluem suplentes ativos indicados. Presença fora da base retorna 409. Ao abrir a votação, `Voting.eligibleVoterIdsAtOpen` congela os IDs elegíveis; votos fora dela retornam 409. Fechamento e maioria absoluta usam a base congelada. A política de convocação (`noticeRecipientPolicy`) é independente.

### GET `/api/v1/sessions/notice-calendar`
Exige `session.transition`; retorna `{ timezone, generatedAt, rows }` para até 50 sessões futuras em `draft` ou `scheduled` da Câmara do ator. Cada linha contém `sessionId`, número/ano/tipo, fase (`initial` ou `amendment`), horário da sessão, vencimento, mínimo de horas, estado (`on_time`, `due_soon`, `passed`) e possibilidade de exceção configurada para o tipo. `Cache-Control: no-store`.

O agendador `notice.deadline_alerts` usa o mesmo cálculo e cria notificações internas para administração e operação de sessão. A Câmara configura `noticeAlertLeadHours` (1–168; padrão 24). A chave `Notification.dedupeKey` impede duplicação por sessão, prazo, estado e papel. Não há envio externo.

### POST `/api/v1/sessions/:id/agenda-amendments`
Permissão `session.transition`. Body: `{ action: 'add'|'move'|'retire', mode: 'preview'|'apply', version, justification, exceptionReason?, matterId? | itemId?, position? }`. `position` é índice zero da Ordem do Dia. Disponível somente em `scheduled`, com pauta publicada e revisão inicial. `preview` → `{ preview: { before, after, summary, revision, policy } }` sem mutação. `apply` → `{ amendment: ... }` (201); grava revisão, auditoria e outbox atomicamente. Exige mínimo de matérias e `minimumAmendmentHours` conforme política da Câmara; exceção exige tipo habilitado em `urgentNoticeExceptionTypes` e justificativa pública. Mesmo com mínimo 0, a sessão deve estar no futuro. Versão antiga → 409; matéria de outra Câmara → 404; outra Câmara não acessa a sessão → 403.

### GET/POST `/api/v1/sessions/:id/transmission`
Etapa 003: acompanhamento da **fonte local**, sem controle do encoder ou confirmação de
destino social. GET exige `media.read`, devolve `TransmissionView` com estado persistido
e `source` consultado nas métricas MediaMTX; `effectiveStatus: signal_lost` indica perda
de sinal enquanto o acompanhamento continua. `Cache-Control: no-store`.

POST exige `media.manage`; body `{ action: 'prepare'|'start_monitoring'|'stop_monitoring',
version: number, idempotencyKey: string }`. Sequência `draft → ready → monitoring → ended`.
`start_monitoring` exige sinal pronto no caminho `session-<id>`; não inicia o OBS.
Versão divergente → 409 `CONFLICT_VERSION`; sinal ausente → 409
`MEDIA_SOURCE_UNAVAILABLE`; transição inválida → 409 `MEDIA_INVALID_TRANSITION`.
Repetição da mesma chave/ação retorna `replayed: true` sem repetir escrita; chave
reusada com ação diferente → 409 `MEDIA_DUPLICATE_COMMAND`. Cada alteração grava
`TransmissionCommand`, `AuditEvent` e `transmission.state_changed` interno na mesma
transação. O estado não altera a sessão legislativa nem aparece no telão público.

### GET/POST `/api/v1/sessions/:id/transmission/destinations`
GET exige `media.read` e retorna somente `id`, `label`, `platform`, `enabled`,
`state` (`disabled|idle|forwarding|error|unknown`), bytes de saída,
`desiredEnabled`, `syncStatus` (`unmanaged|pending|applied|error`) e código
de erro operacional para os destinos do
tenant. O estado vem da Control API do MediaMTX e indica transporte RTMPS,
sem comprovar a live pública na rede social. Stream keys e URLs não aparecem
na resposta nem na auditoria. POST exige `media.manage`, body
`{ destinationId: string, enabled: boolean }`. Ativação exige acompanhamento
local `monitoring` e fonte pronta; desativação independe do sinal. POST grava
a intenção e auditoria na mesma transação e responde **202**. O worker
`bun run media:reconcile` reivindica a intenção por lease no banco, aplica
o comando e confirma a configuração externa; após reinício, compara novamente
o estado desejado com o MediaMTX. GET continua disponível quando a Control API
falha, com `controllerAvailable: false`, estado observado `unknown` e intenção
persistida. Encerrar o acompanhamento com intenção ativa ou destino ainda
ativo → 409 `MEDIA_DESTINATIONS_ACTIVE`. Destino inexistente retorna
`MEDIA_DESTINATION_NOT_FOUND`; falhas externas ficam em `lastErrorCode`.
Um lease por caminho serializa alterações de destinos distintos entre workers;
contenção prolongada aparece como `MEDIA_PATH_BUSY` e recebe retry.

### GET `/api/v1/sessions/:id/transmission/recording`
Exige `media.read` e retorna `{ configured, segmentCount,
latestSegmentAt }` a partir da configuração e do catálogo de gravações do
MediaMTX para o caminho exato da sessão. A presença de segmentos não atesta
integridade, continuidade ou presença de áudio. `Cache-Control: no-store`.

### POST `/api/v1/sessions/:id/attendance`
Body: `{ parliamentarianId, action, note?, source? }`
Actions: `check_in`, `check_out` (saída temporária), `return`, `mark_licenca`,
`mark_afastado`, `mark_ausente`, `mark_presente` (atalho = check_in).
Regras: `check_in/return` exigem sessão em `check_in|open|suspended|resumed`; `mark_*`
também funcionam em `scheduled`. Append-only em `AttendanceEvent`.
→ `{ attendance: AttendanceRow, quorum: QuorumInfo }`. Emite `attendance.changed` +
`session.quorum`. Auditoria `attendance.changed`.

### POST `/api/v1/sessions/:id/agenda`
Body: `{ matterIds: string[] }` (adiciona à ordem do dia apenas em `draft`; alterações após publicação exigirão fluxo versionado).
→ `{ agenda: AgendaItemView[] }`. Emite `agenda.updated`.

### PATCH `/api/v1/agenda-items/:itemId`
Body: `{ action: 'reorder'|'status'|'retirar'|'adiar', order?, status?, justification? }`
`reorder` só é aceito em `draft`; demais ações de condução seguem as regras da sessão.
→ `{ agenda: AgendaItemView[] }` (da sessão do item). Emite `agenda.updated`.

### GET|POST `/api/v1/sessions/:id/votings`
POST Body: `{ agendaItemId?, question?, mode: VotingMode, rule?: VotingRule, hidePartial?: boolean }`
Cria votação `ready` vinculada ao item da pauta (e à matéria do item, se houver); item → `em_votacao`.
→ `{ voting: VotingView }`. Emite `voting.created` + `agenda.updated`.

### POST `/api/v1/votings/:id/transition`
Body: `{ action: 'open'|'pause'|'resume'|'close'|'annul', version, justification?, sim?, nao?, abstencoes? }`
- `open`: ready|paused→open; snapshot `presentAtOpen` + quórum atual; exigir sessão aberta
  (open|resumed) e quórum OK → se quórum insuficiente: 409 `QUORUM_INSUFFICIENT`.
- `pause`/`resume`: open⇄paused.
- `close`: open|paused→closed; snapshot close; **simbólico exige `sim`/`nao`/`abstencoes` no body**;
  calcula resultado determinístico (ADR-002); atualiza matéria (aprovado/rejeitado) e item
  da pauta (+`resultSummary`); emite `voting.result` + `agenda.updated`.
- `annul`: closed→annulled; **exige justificativa**; reverte item/matéria; emite eventos.
→ `{ voting: VotingView }`.

### POST `/api/v1/votings/:id/votes`
Body: `{ parliamentarianId, value: 'sim'|'nao'|'abstencao', commandId: uuid }`
Regras: votação `open`; parlamentar presente (status atual `presente`); idempotente por
`commandId` (mesma chave → retorna estado atual, sem duplicar); alteração de voto permitida
se `tenant.settings.allowVoteChange` (senão 409 `VOTE_CHANGE_NOT_ALLOWED`); parlamentar só
vota por si (papel parliamentarian), operador/mesa votam por qualquer presente.
→ `{ vote: VoteRow, registeredCount: number }`. Emite `vote.recorded` (interno com valor —
exceto secreto; público SEMPRE sem valor, apenas contagem). Auditoria `vote.cast`
(secreto: sem valor) / `vote.changed`.

### GET|POST `/api/v1/sessions/:id/speeches`
POST Body: `{ parliamentarianId?, externalSpeaker?, kind, subject?, side?, plannedSeconds? }`
→ `{ speech: SpeechView }`. Emite `speech.state_changed`.

### POST `/api/v1/speeches/:id/transition`
Body: `{ action: 'start'|'pause'|'resume'|'extend'|'finish', seconds? }`
Cronômetro server-side: `elapsedSeconds` + `startedAt`/`pausedAt`; `extend` adiciona
`seconds` (ou 60 default) ao `plannedSeconds`. → `{ speech: SpeechView }`. Emite evento.

### GET `/api/v1/parliamentarians` · POST · PATCH `/api/v1/parliamentarians/:id` · DELETE (soft)
POST Body: `{ name, party, bloc?, boardRole?, committee?, email?, phone? }`
PATCH: campos parciais. DELETE: `active: false` (soft).
→ `{ parliamentarians: ParliamentarianView[] }` / `{ parliamentarian }`.

### GET `/api/v1/matters?search=&type=&year=&status=`
POST Body: `{ type, ementa, authors: string[], regime?, number? }` (number auto por tipo/ano).
→ `{ matters: MatterView[] }` / `{ matter }`.

### GET `/api/v1/audit?action=&aggregateType=&aggregateId=&limit=&verify=true`
`verify=true` valida a cadeia de hashes e devolve `{ valid, head }`.
→ `{ events: AuditView[], chain?: { valid: boolean, head: string | null } }`.

### GET `/api/v1/reports/session/:id`
→ `ReportView` (espelho completo + código de verificação = head da cadeia truncado).

### GET `/api/v1/public/live?tenant=camara-vila-nova`
Sem autenticação. Somente campos públicos (`PublicLiveView`). Sessão ao vivo = sessão em
check_in|open|suspended|resumed mais recente; senão a próxima agendada; senão a última
encerrada (status + resultados). Votação secreta: `nominalDetail: null` sempre.

### PATCH `/api/v1/tenants/:id`
Body (white-label): `{ name?, city?, uf?, primaryColor?, accentColor?, settings?: TenantSettings }`
→ `{ tenant: TenantView }`. Auditoria `tenant.updated`. Emite `display.command` profile? Não — apenas persistir.

### POST `/api/v1/display/command`
Body: `{ sessionId, action: 'freeze'|'unfreeze'|'clear'|'publish'|'profile', profile? }`
→ `{ ok: true }`. Emite `display.command` (público) para telões.

## Eventos outbox (eventType → payloads)

Envelope: `RealtimeEvent` (contracts.ts). Colunas `internalPayload`/`publicPayload`.

| eventType | internal payload | public payload |
|---|---|---|
| session.state_changed | `{sessionId, from, to, label}` | idem (sem dados internos) |
| session.quorum | `{sessionId, present, total, required, ok}` | idem |
| attendance.changed | `{sessionId, parliamentarianId, name, party, status, present, presentCount}` | idem (nome público ok) |
| agenda.updated | `{sessionId}` | `{sessionId}` |
| voting.created | `{votingId, sessionId, question, mode, status}` | idem |
| voting.state_changed | `{votingId, sessionId, status, question}` | idem |
| vote.recorded | `{votingId, sessionId, parliamentarianId, name, party, value?, registeredCount, hidePartial}` | sem `value`/`name` — `{votingId, sessionId, registeredCount, hidePartial}` |
| voting.result | `{votingId, sessionId, question, resultStatus, resultCounts, nominalDetail?}` | idem (nominalDetail só se mode!=secreto) |
| speech.state_changed | `{sessionId, speechId, speakerName, subject, status, elapsedSeconds, plannedSeconds}` | idem |
| display.command | `{sessionId, action, profile?}` | idem |
| transmission.state_changed | `{sessionId, from, to}` | nenhum |

`origin` sempre `'operator'` (ações da mesa) ou `'cloud'` (sistema), `schemaVersion: 1`.

## Fase 5 — Estrutura institucional & processo legislativo

Permissões novas (matriz RBAC): `structure.write` (tenant_admin, legislative_admin),
`protocol.write` (tenant_admin, legislative_admin), `task.write` (tenant_admin,
legislative_admin, session_operator). Máquina de estados da matéria (`domain.ts`):
`em_tramitacao → incluida_pauta | arquivado | retirado`; `incluida_pauta → aprovado |
rejeitado | retirado | em_tramitacao`; `arquivado → em_tramitacao` (desarquivamento);
`aprovado | rejeitado | retirado` são terminais (409 `MATTER_INVALID_TRANSITION`).
**Mudança de status de matéria EXCLUSIVAMENTE via `POST proceedings`** (append-only por `seq`).

### GET|POST `/api/v1/legislatures` · PATCH `/api/v1/legislatures/:id`
POST body `{number, startYear, endYear}`; PATCH `{current?: true, startYear?, endYear?}` —
marcar `current` desmarca as demais do tenant. Legislature nunca é excluída.

### GET|POST `/api/v1/parties` · PATCH `/api/v1/parties/:id`
POST `{acronym, name, number?}`; PATCH `{active?}` (soft delete) ou `{name?, number?}`.

### GET|POST `/api/v1/blocs` · PATCH `/api/v1/blocs/:id`
POST `{name, partyAcronyms: string[]}`.

### GET|POST `/api/v1/board` · PATCH `/api/v1/board/:id`
GET retorna posições (vigentes + históricas) com dados do parlamentar e da legislatura.
POST `{legislatureId, role, parliamentarianId, startDate?}`; PATCH `{action: 'end'}` encerra
vigência (endDate=now) ou `{action: 'transfer', parliamentarianId}` transfere o cargo
(encerra a anterior e abre nova). Auditoria `board.designated|ended|transferred`.

### GET|POST `/api/v1/committees` · PATCH `/api/v1/committees/:id`
POST `{name, acronym, kind: 'permanente'|'temporaria'|'especial', description?}`; PATCH
`{active?}`. Membros: `GET|POST /api/v1/committees/:id/members`
(POST `{parliamentarianId, role}`); reuniões: `GET|POST /api/v1/committees/:id/meetings`
(POST `{scheduledAt, subject}`) e `PATCH /api/v1/committee-meetings/:meetingId`
(`{status: 'realizada'|'cancelada'}`).

### GET|POST `/api/v1/mandates` · GET|POST `/api/v1/leaves` · PATCH `/api/v1/leaves/:id`
Mandato `{parliamentarianId, legislatureId, startDate, endDate?, votes?}` (único por
parlamentar+legislatura). Afastamento `{parliamentarianId, kind: 'licenca'|'afastamento'|
'suplencia', startDate, endDate?, reason, substituteId?}`; PATCH `{action: 'end'}` ou
`{endDate}` (estender). Auditoria em toda escrita.

### GET|POST `/api/v1/matter-types`
Configuração de tipos por tenant: `{code, name, defaultRegime?}` — código único por tenant.

### GET|POST `/api/v1/protocols` · PATCH `/api/v1/protocols/:id`
GET `?year=&status=&kind=` → `{protocols: ProtocolEntryView[], counts}`. POST `{kind:
'materia'|'documento'|'oficio'|'requerimento', senderName, subject, matterId?, notes?}` —
**auto-numerado por ano/tenant em transação** (sem buracos; 409 se concorrente vencer).
PATCH `{status: 'distribuido'|'arquivado'|'anulado', notes?}` — anular exige `notes`
(auditoria `protocol.annulled` com justificativa). Auditoria `protocol.registered` no POST.

### GET|POST `/api/v1/matters/:id/proceedings`
GET → timeline ordenada por `seq` (append-only). POST `{action: 'despacho'|'parecer'|
'emenda'|'inclusao_pauta'|'sessao'|'sanco'|'veto'|'arquivamento'|'desarquivamento'|'outro',
toStatus, notes?, documentRef?, dueAt?}` — valida `fromStatus` = situação atual, transição
permitida pela máquina, grava `seq = last+1`, atualiza a matéria, emite outbox
`matter.proceeding` (público) e auditoria `matter.proceeding`. Erros: 409
`MATTER_INVALID_TRANSITION`.

### GET|POST `/api/v1/matters/:id/versions` · GET|POST `/api/v1/matters/:id/attachments`
Versões: POST `{text, authorName?}` → `version = last+1`. Anexos: POST `{name, kind:
'texto_integral'|'anexo'|'parecer'|'emenda'|'outro', sizeBytes?, url?}` (metadados).

### GET|POST `/api/v1/tasks` · PATCH `/api/v1/tasks/:id`
GET `?status=&overdue=true` → `{tasks, counts: {pendente, concluida, cancelada, overdue}}`.
POST `{title, kind: 'prazo'|'parecer'|'distribuicao'|'outro', dueAt, matterId?,
assigneeName?}`; PATCH `{status: 'concluida'|'cancelada'}`. Auditoria `task.created|
completed|cancelled`.

### Eventos outbox novos (Fase 5)

| eventType | internal payload | public payload |
|---|---|---|
| structure.changed | `{entity, action, id?, name}` | — (não público) |
| matter.proceeding | `{matterId, seq, action, fromStatus, toStatus, notes?, actorName}` | `{matterId, seq, action, toStatus}` |
| matter.status_changed | `{matterId, from, to}` | idem |
| protocol.registered | `{protocolId, number, year, kind, senderName, subject}` | — (não público) |
| task.changed | `{taskId, title, status, dueAt?}` | — (não público) |

## Fase 6 — Portal público completo, notificações, webhooks e minuta de ata

Modelos novos: `WebhookEndpoint`, `WebhookDelivery` (retentativa com backoff e dead-letter),
`Notification` (destinatário por papel — demo ADR-005). Permissão nova: `webhook.manage`
(tenant_admin). Endpoints públicos resolvem tenant por `?tenant=slug` (default
`camara-vila-nova`) e expõem EXCLUSIVAMENTE dados publicáveis (votação secreta nunca expõe
detalhe nominal).

### Rotas públicas novas

- `GET /api/v1/public/matters?type=&year=&status=&author=&q=&limit=&cursor=` — pesquisa de
  matérias com paginação por cursor (`{matters: MatterPublicView[], nextCursor}`); `q` busca
  textual na ementa (contains), `author` busca em autores (JSON).
- `GET /api/v1/public/matters/:id` — detalhe público: matéria + timeline de tramitação
  (seq/action/toStatus/createdAt) + última votação com resultado (nominalDetail apenas se
  mode != secreto) + versões (metadados, sem texto integral).
- `GET /api/v1/public/sessions?year=&status=&limit=` — sessões públicas
  (number, year, type, scheduledAt, status, agendaPublished).
- `GET /api/v1/public/sessions/:id` — detalhe público: pauta publicada, presença consolidada
  final (se encerrada), votações com resultado, discursos encerrados.
- `GET /api/v1/public/open-data?dataset=matters|sessions|attendance|votes&format=json|csv&tenant=`
  — dados abertos; CSV com `;` + BOM e `Content-Disposition: attachment`; JSON inclui
  `generatedAt` e `tenant`.
- `GET /api/v1/public/sitemap.xml?tenant=` — sitemap XML de sessões e matérias publicadas.

### Notificações (internas)

- `GET /api/v1/notifications?unread=true&limit=50` → `{notifications: NotificationView[],
  unreadCount}` — escopo: `targetRole` igual ao papel do ator OU null (todos).
- `POST /api/v1/notifications/:id/read` · `POST /api/v1/notifications/read-all` — marcar
  lida(s) (readAt=now).
- `POST /api/v1/notifications` (tenant_admin) — broadcast manual
  `{title, body, kind, module?, targetRole?}`.
- Gatilhos server-side (helper `notify()` na mesma transação + outbox interno
  `notification.new`): sessão agendada (→ session_operator), sessão aberta/encerrada (todos),
  votação encerrada com resultado (todos), tarefa criada (→ legislative_admin), entrega de
  webhook em dead (→ tenant_admin). Topbar exibe sino com badge, popover (max-h-96 + scroll)
  e navegação para o módulo do evento.

### Webhooks (integração externa)

- `GET|POST /api/v1/webhooks` — POST `{url, events: string[], description?}`: gera `secret`
  (32 bytes hex), valida URL http(s) e eventTypes contra allowlist (`WEBHOOK_TRIGGER_EVENTS`:
  eventos públicos do outbox + `test.ping`); 400 `VALIDATION_ERROR` fora da allowlist.
  Auditoria `webhook.created`.
- `PATCH /api/v1/webhooks/:id` `{active?, events?, url?, description?}` · `DELETE /api/v1/webhooks/:id`
  (exclusão real auditada).
- `GET /api/v1/webhooks/:id/deliveries?status=&limit=` — histórico com attempts/lastError/
  responseStatus.
- `POST /api/v1/webhooks/:id/test` — entrega imediata `test.ping`. ·
  `POST /api/v1/webhooks/deliveries/:id/replay` — recria entrega (auditoria `webhook.replayed`).
- `POST /api/v1/webhooks/echo` — eco público (200 `{ok:true}`) para demonstração local.
- Gatilho: `enqueueMatchingWebhooks(tx, tenantId, eventType, publicPayload)` enfileira
  `WebhookDelivery` para endpoints ativos inscritos no evento (chamado nos fluxos de
  sessão/votação/tramitação que emitem eventos públicos).

### Mini-serviço `mini-services/webhooks` (porta 3004)

Poller de 1s sobre `WebhookDelivery` pending: assinatura HMAC-SHA256 do body com o secret do
endpoint — headers `x-legis-signature: sha256=<hex>`, `x-legis-timestamp: <epoch>`,
`x-legis-event: <eventType>`; POST com timeout 10s. 2xx → `success` (deliveredAt); falha →
attempts+1 e backoff [5s, 30s, 120s, 600s]; após 5 tentativas → `dead` (dead-letter,
notifica tenant_admin). Health check `GET /health` → 200. Verificação do receptor:

```js
const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex')
if (expected === req.headers['x-legis-signature']) { /* íntegro */ }
```

### Minuta de ata

- `GET /api/v1/reports/session/:id/ata` → `{ata}` estruturada (abertura, presença consolidada,
  expediente, votações com resultado e nominal quando não secreto, discursos, encerramento,
  código de verificação da cadeia de auditoria) — SOMENTE de dados persistidos. Renderização
  imprimível no módulo Relatórios (tab "Minuta de Ata").

## Fase 7 — IA assistiva e app do parlamentar (PWA)

Modelo novo: `AiArtifact` (kind: `ata_draft|ementa|proceedings_summary|transcript|ocr_text`;
status: `draft|approved|rejected`; model/provider/reviewedBy/reviewedAt para rastreabilidade).
Permissões novas: `ai.use` (tenant_admin, legislative_admin, session_operator,
presiding_officer), `ai.review` (tenant_admin, legislative_admin), `self.attendance` /
`self.vote` / `self.speech` (parliamentarian com `parliamentarianId` vinculado).

### Rotas de IA (z-ai-web-dev-sdk SOMENTE server-side — src/lib/server/ai.ts)

Regras invioláveis (prompt mestre 7.13): todo artefato persiste input (contexto), output,
modelo, provedor e horário; **nenhuma aprovação/publicação/votação é automática**; saída é
sempre rascunho sujeito a revisão humana; erros do provedor → 502 `AI_PROVIDER_ERROR`;
timeout 60s → 504 `AI_TIMEOUT`; base64 > 8MB → 400.

- `POST /api/v1/ai/ata-draft {sessionId}` — minuta de ata via LLM a partir de dados
  persistidos (presença, pauta, votações, discursos); placeholders `[CONFIRMAR]` onde faltar
  dado. → `{artifact, output: {titulo, secoes[], observacao}}`.
- `POST /api/v1/ai/ementa {matterId? | text}` — sugestão de ementa + temas via LLM →
  `{ementaSugerida, temas[], justificativa}`.
- `POST /api/v1/ai/proceedings-summary {matterId}` — resumo executivo da tramitação →
  `{resumo, proximosPassos[]}`.
- `POST /api/v1/ai/transcribe {audioBase64, sessionId?, note?}` — ASR → `{text}`.
- `POST /api/v1/ai/ocr {imageBase64, mimeType}` — VLM extrai texto de documento → `{text}`.
- `GET /api/v1/ai/artifacts?kind=&sessionId=&matterId=&limit=` — galeria (leitura: todos os
  atores do tenant).
- `POST /api/v1/ai/artifacts/:id/review {decision: 'approve'|'reject', justification?}` —
  revisão humana com auditoria `ai.artifact_reviewed` + outbox interno `ai.artifact`.
  Aprovar NÃO publica nada automaticamente.

### Rotas do parlamentar (`/api/v1/me/*`)

Ator DEVE ter papel `parliamentarian` com `parliamentarianId` (senão 403 com detalhe).
`TenantSettings.allowSelfCheckIn?: boolean` (default `true`).

- `GET /api/v1/me/context` → `{parliamentarian, session, attendance, activeVoting:
  {voting, myVote, eligible}, speechQueue: {mine, position, total}, tenantSettings}`.
- `POST /api/v1/me/check-in` — auto check-in `source: 'pwa'`; exige sessão em
  check_in|open|suspended|resumed E allowSelfCheckIn.
- `POST /api/v1/me/vote {votingId, value, commandId}` — voto próprio com AS MESMAS regras
  do operador (sessão open, votação open, parlamentar presente, idempotência por commandId,
  alteração conforme allowVoteChange); auditoria `vote.cast` com source pwa.
- `POST /api/v1/me/speech {kind, subject?, side?}` — entra na fila de oradores (sessão open).
- `GET /api/v1/me/history` — presenças e votos do próprio parlamentar (voto secreto: value
  null — participação revelada, valor jamais).

### Eventos outbox novos (Fase 7)

| eventType | internal payload | public payload |
|---|---|---|
| ai.artifact | `{artifactId, kind, status, sessionId?, matterId?, model}` | — (não público) |

## Fase 8 — Console da Plataforma (SaaS) e importador de migração

Modelos novos: `Plan` (limits JSON com maxParliamentarians/maxSessionsPerMonth/features),
`Subscription` (tenant 1:1, status trial|active|past_due|canceled), `MigrationRun`,
`MigrationMapping` (id legado → novo, nunca PK), `MigrationIssue` (info|warn|error).
Permissões novas: `platform.manage` (somente platform_owner), `migration.manage`
(tenant_admin, legislative_admin, platform_owner). Entitlements:
`tenantEntitled(tenantId, feature)` lê Subscription→Plan→limits.features; rotas `/ai/*`
exigem a feature `ai_assist` (402 `PLAN_LIMIT` fora do plano).

### Rotas do console (`platform_owner`)

- `GET /api/v1/platform/overview` → KPIs globais AGREGADOS (tenants ativos/total,
  sessões no mês, votos, eventos publicados, webhooks dead, planos) — nunca conteúdo
  legislativo de tenants.
- `GET /api/v1/platform/tenants` → todos os tenants com subscription (plano/status/trial),
  usage {parliamentarians, sessions, matters, votes} e healthScore (50 base + até 30 por
  atividade 30d + 20 sem dead-letter; saudável≥70, atenção 40–69, crítico<40).
- `POST /api/v1/platform/tenants` `{name, slug?, city, uf, planId}` → onboarding completo:
  tenant + legislatura atual + usuário tenant_admin + assinatura trial 14 dias.
- `PATCH /api/v1/platform/tenants/:id` `{active?, planId?}` → ativar/desativar, trocar plano.
- `GET|POST /api/v1/platform/plans` · `PATCH /api/v1/platform/plans/:id` — CRUD de planos.

### Importador de migração (pipeline auditável do prompt mestre §14)

Fonte: `upload/legacy/` — export sintético do PainelDeskLegis 8.1 (HSQLDB em CSVs:
parlamentares, proposicoes, sessoes, presencas, votacoes, votos + manifest.json), gerado por
`scripts/generate-legacy-export.ts` com sujeira realista (órfãos, duplicidade, voto NULL).

- `POST /api/v1/migration/run {stage, runId?}` — estágios:
  `inspect` (cria run, contagens por tabela) → `validate` (órfãos/duplicidades/domínio →
  issues) → `plan` (mapas legado→novo: situações, cargos, modos de votação) → `dry_run`
  (transformação em memória, detecta nomes coincidentes → warn) → `import` (grava em
  transação: parlamentares inativos + mandato legislatura anterior, sessões closed com
  presenças/votações/votos, matérias com ano legado; mappings para TUDO; retomável e
  idempotente entre runs) → `reconcile` (contagens por tabela + amostras + checksum →
  divergencias 0) → `report` (consolidação final com issues por severidade) → `rollback`
  (remove EXCLUSIVAMENTE dados do runId pela ordem inversa; 409 `MIGRATION_HOMOLOGATED`
  se homologado). Auditoria `migration.stage_completed` a cada estágio.
- `GET /api/v1/migration/runs` · `GET /api/v1/migration/runs/:id` (run + issues máx 500 +
  counts) · `POST /api/v1/migration/runs/:id/homologate` `{confirmation: 'HOMOLOGAR', note?}`
  — irreversível; exige estágio report concluído; auditoria `migration.homologated`.

Regras: voto/presença/resultado ausente NUNCA é deduzido (issue warn para homologação
humana); IDs legados preservados em MigrationMapping (nunca PK nova); import sempre no
tenant do ator.

## Fase 9 — Autenticação real (e-mail/senha) e gestão de usuários

Modelos novos: `User.passwordHash` (scrypt, opcional — atores demo seguem sem senha) e
`AuthSession` (tokenHash SHA-256 único, expiresAt, revokedAt). Resolução do ator:
**cookie `legis_session` → `x-actor-id` (demo) → 401**. Códigos novos:
`INVALID_CREDENTIALS` (401), `TENANT_INACTIVE` (403), `EMAIL_TAKEN` (409).

### Rotas de autenticação (sem ator)

- `POST /api/v1/auth/login {email, password}` → valida scrypt; cria sessão (cookie
  httpOnly `legis_session`, 7 dias); responde `{actor {id, name, email, role, jobTitle,
  tenantId, parliamentarianId, tenantName?}}`. Falha → 401 genérico (sem enumeração).
  Tenant inativo + papel não-platform → 403 `TENANT_INACTIVE`. Auditoria `auth.login`
  apenas em sucesso com tenant.
- `POST /api/v1/auth/logout` → revoga a sessão atual e limpa o cookie (best-effort).
- `GET /api/v1/auth/me` → ator da SESSÃO (não aceita x-actor-id); 401 sem sessão.

### Gestão de usuários (`user.manage`: tenant_admin, platform_owner)

- `GET /api/v1/users` (platform_owner: `?tenant=slug` ou `?all=1`) → usuários SEM
  passwordHash (name, email, role, jobTitle, vínculo parlamentar, status, tenant).
- `POST /api/v1/users` (platform DEVE informar `?tenant=slug`) `{name, email, password
  (min 8), role, jobTitle?, parliamentarianId?}` → 409 `EMAIL_TAKEN`; papel
  `parliamentarian` exige vínculo com parlamentar do MESMO tenant (422). Auditoria
  `user.created`.
- `PATCH /api/v1/users/:id` `{name?, jobTitle?, role?, parliamentarianId?, active?,
  password?}` → desativar/redefinir senha revoga TODAS as sessões do usuário; proibido
  desativar a si mesmo (422). Auditoria `user.updated` (before/after sem segredos).
  Exclusão NÃO existe (histórico imutável).

## Fase 10 — Faturamento do SaaS

Modelo novo: `Invoice` (único por tenant/período; number sequencial por tenant;
lines JSON; status `open|paid|canceled` — **vencida é computada na leitura**:
`isOverdue = open && dueAt < now`). Códigos novos: `INVOICE_INVALID_TRANSITION` (409),
`INVOICE_DUPLICATE_PERIOD` (409).

### Rotas (`platform.manage`: somente platform_owner)

- `GET /api/v1/platform/billing/invoices?tenant=&status=open|paid|canceled|overdue&year=&month=`
  → `{invoices, summary {openCount, openTotalCents, overdueCount, overdueTotalCents,
  paidThisYearCount, paidThisYearTotalCents, mrrCents}}`.
- `POST /api/v1/platform/billing/invoices {tenantId, year, month}` → gera fatura do
  período (mensalidade do plano + excedente parlamentares R$25/un + excedente sessões
  R$40/un); duplicada → 409.
- `POST /api/v1/platform/billing/cycle` → ciclo do mês para TODOS os tenants ativos com
  assinatura trial/active/past_due (idempotente) + **dunning**: fatura aberta vencida →
  assinatura `past_due` + notificação ao admin do tenant + webhook
  `billing.invoice_overdue`. Resposta `{generated, skipped, dunning}`.
- `POST /api/v1/platform/billing/invoices/:id/pay {method: pix|boleto|cartao|transferencia}`
  → `paid` + assinatura past_due→active + webhook `billing.invoice_paid`.
- `POST /api/v1/platform/billing/invoices/:id/cancel {justification (min 10)}` →
  cancelada com justificativa auditada (somente de `open`).
- `GET /api/v1/platform/tenants/:id/usage?year=&month=` → uso do período vs. limites do
  plano (sessões, parlamentares ativos, artefatos de IA, entregas de webhook, excedentes).

Eventos outbox novos: `billing.invoice_created`, `billing.invoice_paid`,
`billing.invoice_overdue` (todos com publicPayload → webhooks).

## Fase 11 — Publicações oficiais e participação popular

Modelos novos: `Publication` (number sequencial por tenant/ano; kind
ata_sessao|decreto|resolucao|portaria|edital|ata; status draft|published|revoked;
verificationCode 8 chars), `PublicHearing` (scheduled|open|closed|canceled;
questionsOpen), `HearingQuestion` (pending|approved|rejected|answered). Códigos novos:
`PUBLICATION_INVALID_TRANSITION`, `HEARING_INVALID_TRANSITION`,
`HEARING_QUESTIONS_CLOSED` (409). Permissões novas: `publication.write`,
`hearing.write` (tenant_admin, legislative_admin).

### Rotas internas

- `GET|POST /api/v1/publications` (filtros status/kind/year/q; POST cria DRAFT numerado
  com código de verificação) · `PATCH /api/v1/publications/:id {action:
  'publish'|'revoke' (reason min 10)|'edit' (só draft)}`.
- `GET|POST /api/v1/hearings` · `PATCH /api/v1/hearings/:id {action: 'open'|'close'|
  'cancel' (justification min 10)|'toggle_questions'}`.
- `GET /api/v1/hearings/:id/questions` → fila de moderação (TODOS os status, inclui
  authorEmail — uso interno).
- `PATCH /api/v1/hearing-questions/:id {action: 'approve'|'reject'|'answer'
  (answer min 5)}` → moderação com `moderatedBy`; answer registra `answeredAt`.

### Rotas públicas (`?tenant=slug`, sem autenticação — authorEmail JAMAIS serializado)

- `GET /api/v1/public/publications?year=&kind=&q=&page=&pageSize=` → somente
  published|revoked (revogada com selo e motivo) · `GET /:id` → detalhe com contentMd e
  código de verificação.
- `GET /api/v1/public/hearings` → não-canceladas com answeredCount · `GET /:id` →
  detalhe com perguntas approved|answered (answered inclui resposta e data).
- `POST /api/v1/public/hearings/:id/questions {authorName, authorEmail?, district?,
  question (10..1000)}` → cria `pending` SOMENTE se hearing em scheduled|open com
  questionsOpen (senão 409 `HEARING_QUESTIONS_CLOSED`); notifica tenant_admin e
  legislative_admin. **Rate limit desde a Fase 19: 5 requisições/10min/IP** (429
  `RATE_LIMITED` + `Retry-After`).

Eventos outbox novos: `publication.published`, `publication.revoked`,
`hearing.state_changed`, `hearing.question_approved` (payload sem dados do autor).
Auditoria: `publication.created|published|revoked`, `hearing.created|state_changed`,
`hearing.question_moderated|question_answered`.

## Fase 12 — Analytics/BI legislativo (somente leitura)

Sem modelos novos. Permissão nova: `analytics.read` (todos os papéis do tenant).

- `GET /api/v1/analytics/overview?year=` (default ano atual) → payload agregado do
  tenant: `kpis {sessionsHeld, avgAttendancePct, totalMatters, approvedMatters,
  votingApprovalPct, avgProceedingDays}`, `attendanceRanking [{parliamentarianId, name,
  party, present, total, pct}]` (presença = mesma regra do plenário: último
  AttendanceEvent por sessão, só ativos), `sessionsByMonth`, `mattersByStatus`,
  `mattersByType`, `topAuthors`, `votingResults {approved, rejected, draw, annulled,
  semQuorum, total}`, `partyDiscipline [{party, cohesionPct, votesAnalyzed,
  votingsCount}]` (APENAS votações nominais encerradas — secret excluída; maioria
  estrita por partido), `proceedingsFlow`.

Regra inviolável: rota NÃO escreve nada (sem transação, sem outbox, sem auditoria).

## Fases 13–16 — Agenda/pesquisa, modelos de documento, Central de Ajuda e operação SaaS

Permissão nova (matriz RBAC): `template.write` (tenant_admin, legislative_admin). Leitura
de `calendar`, `search`, `help` e `templates` para qualquer papel autenticado do tenant
(escopo derivado server-side); `platform/system-status`, `platform/tenants/:id/export` e
`/close` exigem `platform.manage` (somente platform_owner, escopo global).

**Nenhum código de erro Problem Details novo** (validações continuam em 422
`VALIDATION_ERROR`; encerramento duplicado → 409 `CONFLICT_VERSION`) e **nenhum evento
outbox/webhook novo** — o render de modelo tem consumidor interno (ADR-015).

| Rota | Métodos | RBAC | Descrição |
|---|---|---|---|
| `/api/v1/calendar?year=&month=` | GET | qualquer papel do tenant | Eventos do mês `{year, month, events: CalendarEventView[]}` com `kind ∈ session\|hearing\|committee_meeting\|task_deadline` (tarefas só pendentes; audiências/reuniões canceladas excluídas); `module` destino por evento; default = mês corrente; `year` 2020–2035, `month` 1–12 (inválido → 422) |
| `/api/v1/search?q=` | GET | qualquer papel do tenant | `SearchResponse {query, sections[]}` — top-5 por seção (matérias, sessões, parlamentares, publicações; 4 seções SEMPRE presentes); `q` mínimo 2 caracteres; case-insensitive contains; termo numérico casa número/ano |
| `/api/v1/templates` | GET, POST | leitura: todos · POST: `template.write` | GET lista com `lastVersion {authorName, changeNote, createdAt}` (ordem kind, name). POST `{name 3–120, kind, description?, bodyMd 1–50000, changeNote?}` cria template + versão v1 em transação + auditoria `template.created` (201) |
| `/api/v1/templates/:id` | GET, PATCH | leitura: todos · PATCH: `template.write` | GET detalhe com `bodyMd` da versão atual + histórico (desc). PATCH discriminatedUnion por `action`: `edit` (nome/descrição → `template.updated`), `new_version` (bodyMd+changeNote → v+1 → `template.version_added`), `restore` (nova versão com corpo da v informada, changeNote "Restaurado da versão N"), `activate`/`deactivate` (`template.updated`/`template.deactivated`). Histórico append-only; fora do escopo → 404 |
| `/api/v1/templates/:id/render` | POST | qualquer papel do tenant | Preview (NÃO audita). Body opcional `{sessionId?, matterId?}` (vínculo de outro tenant → 422 field error). Resolve 12 placeholders (`TEMPLATE_PLACEHOLDERS`); desconhecidos NÃO falham → `{rendered, unresolved[], templateId, version}` |
| `/api/v1/help` | GET | qualquer papel autenticado (inclui platform_owner sem tenant — NÃO usa resolveTenantScope) | `HelpContent {guides[7], glossary[26], faq[12], shortcuts[5], changelog[], about}` — fonte única em `src/lib/server/help-content.ts`, versionada com o código (ADR-016) |
| `/api/v1/platform/system-status` | GET | `platform.read` (owner e **platform_support** desde a Fase 20) | `SystemStatusView`: health de 3003/3004 com `AbortSignal.timeout(2000)` + `latencyMs` (parado degrada, nunca 500), `database {fileBytes, walBytes}`, `queues {outboxPending, outboxOldestPendingMinutes, webhookPending, webhookDead}`, `activity {tenantsActive, tenantsTotal, sessionsToday, lastAuditAt}`, `runtime {uptimeSeconds, heapUsedMb, heapTotalMb}`, `alerts[]` derivados na leitura (critical/warn/info, todos com `action`) e `platformAlerts[]` persistentes (abertos primeiro, máx 20 — a persistência deduplicada por kind aberto acontece nesta leitura; ver Onda 4) |
| `/api/v1/platform/tenants/:id/export` | POST, GET | `platform.manage` | **Fase 20: job assíncrono** — POST responde `202 {job: ExportJobView}` (guarda 1 job pending/running por tenant → 409; worker in-process com progresso 0–100); GET devolve `{job}` do último job (null quando nunca houve). O download está em `/platform/exports/:id/download` (ver Onda 4) |
| `/api/v1/platform/tenants/:id/close` | POST | `platform.manage` | Encerramento formal. Body `{justification 10–500, confirm: 'ENCERRAR'}` (422 field errors; 404 inexistente; já desativado → 409). Transação: `active=false` + revoga TODAS as `AuthSession` ativas do tenant + assinatura → `canceled` + auditoria `platform.tenant_closed` (justificativa e before/after). Dados NUNCA apagados; reversível apenas por reativação auditada |

### Alterações em rotas existentes

- `POST /api/v1/publications` aceita campo opcional `templateId`: modelo deve ser do
  tenant e ATIVO (senão 422 field error); grava auditoria extra `template.rendered` na
  MESMA transação da publicação (origem rastreável — ADR-015).

### Eventos de auditoria novos (sem eventos outbox/webhook)

`template.created`, `template.updated`, `template.version_added` (também no restore),
`template.deactivated`, `template.rendered` (aggregateType `document_template`);
`platform.tenant_exported`, `platform.tenant_closed` (aggregateType `tenant`, com
justification).

### Tipos compartilhados novos (contracts.ts)

`CalendarEventKind`/`CalendarEventView`/`CalendarResponse`,
`SearchSectionId`/`SearchItemView`/`SearchResponse`, `TEMPLATE_KIND_LABEL`/
`TEMPLATE_PLACEHOLDERS`/`TemplateVersionView`/`TemplateView`/`TemplateDetail`/
`TemplateRenderResponse`, `HelpGuide`/`GlossaryTerm`/`FaqItem`/`ShortcutItem`/
`ChangelogEntry`/`HelpAbout`/`HelpContent`, `ServiceHealth`/`SystemStatusView`.

## Fases 17–20 (Onda 4 — v0.11.0)

Modelos novos: `RelatedMatter`, `MatterOutcome` (Fase 17), `VotingOption`, `VoteReceipt`
(Fase 18), `CitizenSubscription` (Fase 19), `SupportImpersonation`, `PlatformAlert`,
`ExportJob` e `AuthSession.impersonationId` (Fase 20). `MatterStatus` ganha
`sancionado|vetado`; `Vote.value` aceita chaves customizadas validadas contra
`VotingOption`. Permissões novas (matriz acima): `subscription.manage` (tenant_admin,
legislative_admin), `platform.read` e `impersonation.manage` (platform_owner,
platform_support). ADR-018/019/020/021.

**Nenhum código em `ApiErrorCode` e nenhum evento outbox/webhook novo** — o 429 de rate
limit é Problem Details manual (`RATE_LIMITED`) e os eventos novos são todos de auditoria.

### Fase 17 — Ciclo de vida da matéria

| Rota | Métodos | RBAC | Corpo / resposta / erros |
|---|---|---|---|
| `/api/v1/matters/:id/related` | GET, POST, DELETE | GET: qualquer ator do tenant · POST/DELETE: `matter.write` | GET → `{related: RelatedMatterView[]}` nas DUAS direções (`direction from\|to`, `kind`, `notes`, `matter: MatterRef` da outra ponta). POST `{relatedMatterId, kind: altera\|revoga\|regula\|subsidiaria\|emenda\|substitutivo, notes?}` → 201 `{related}`; auto-referência/par duplicado em qualquer direção → 422 field errors; alvo inexistente → 404; alvo de outro tenant → 404 (sem vazar existência). DELETE `?relatedId=` → `{ok}` (404 quando o vínculo não pertence à matéria); desvinculação física com auditoria `matter.related_removed`. Auditoria POST: `matter.related` |
| `/api/v1/matters/:id/outcomes` | GET, POST | GET: qualquer ator do tenant · POST: `matter.write` | GET → `{outcomes: MatterOutcomeView[]}` (timeline). POST `{kind: sancao\|veto_total\|veto_parcial, actorName 2–120, notes? (OBRIGATÓRIA em veto), dueAt? (AAAA-MM-DD ou ISO)}` → 201 `{outcome, matter}`. Regras: sanção exige `aprovado` OU `vetado`+último `veto_parcial` (promulgação da parte não vetada); vetos exigem `aprovado` + notes; mesmo kind do último → 422; veto agenda `LegislativeTask` "Apreciar veto…" (dueAt ou **+15d às 19h**) + `Proceeding` (`sanco`/`veto`) e transiciona o status na MESMA transação (`aprovado → sancionado\|vetado` SOMENTE aqui) + auditoria `matter.outcome` com before/after |

Alterações: `GET /api/v1/matters/:id` passa a incluir `related[]` + `outcomes[]`;
`GET /api/v1/public/matters/:id` publica o desfecho mais recente (`outcome`) — `related`
permanece interno.

### Fase 18 — Votação avançada (opções regimentais + recibos)

| Rota | Métodos | RBAC | Corpo / resposta / erros |
|---|---|---|---|
| `/api/v1/sessions/:id/votings` | POST | `voting.write` | POST ganha `options?: [{key (slug 2–40), label (1–60)}]` (1–5, sem chaves duplicadas → 422). Quando presentes, SUBSTITUEM sim/nao/abstencao para voto e contagem (`VotingView.options` ordenadas). → `{voting: VotingView}` |
| `/api/v1/votings/:id/receipts` | GET | **OR** `audit.read` ∨ `voting.write` | Recomputa o HMAC-SHA256 determinístico de CADA voto (payload `votingId\|parl\|value\|closedAtISO`; segredo derivado por tenant) e compara com o `receiptCode` persistido → `ReceiptsVerificationView {ok, recomputedCount, mismatchCount, mode, receipts[]}` (mismatch inclui voto sem recibo/recibo órfão; JAMAIS expõe valores — voto secreto usa placeholder). Votação não fechada → 409 `VOTING_INVALID_TRANSITION` |
| `/api/v1/me/receipts` | GET | `self.vote` | Recibos do próprio parlamentar (PWA): `{receipts: MyVoteReceiptRow[]}` — últimos 60 com pergunta/modo/closedAt/receiptCode/issuedAt |

Alterações em rotas existentes:

- `POST /api/v1/votings/:id/votes` e `POST /api/v1/me/vote`: `value` validado contra as
  chaves das opções (chave inexistente → 422 com chaves válidas no field error); `/me/vote`
  responde `receiptPending: true` em votação nominal (recibo sai no ENCERRAMENTO).
- `POST /api/v1/votings/:id/transition` (close): emite recibos na MESMA transação
  (idempotente por par votação/parlamentar + auditoria `voting.receipts_issued`; secreto
  com `__SIGILO__`); apura multi-opção (`computeVotingResultAdvanced`: contagem por chave
  em `resultCounts.custom`, maioria simples/absoluta/unanimidade, `empate`, `sem_quor`);
  simbólica com opções EXIGE `customCounts` por chave no body (faltando/desconhecida → 422).
- Vistas estendidas: `VotingView.options?`, `VoteRow` por rótulo, `resultSummary` do item
  da pauta com frase multi-opção.

### Fase 19 — Participação e confiança pública

| Rota | Métodos | RBAC | Corpo / resposta / erros |
|---|---|---|---|
| `/api/v1/public/subscriptions?tenant=slug` | POST | público (rate limit **5/h/IP**) | `{email (Zod), targetKind: matter\|session\|hearing, targetId}` → 201 `{status: 'pending', message, subscription}` SEM token (dupla confirmação). Idempotente: pendente → 200 pending (token NÃO reemitido); confirmada → 200 confirmed; revogada que reassina → reativa com novo token. E-mail normalizado (trim+lowercase); alvo inexistente → 404; 429 com `Retry-After` |
| `/api/v1/public/subscriptions/confirm` | GET | público (`?token=` UUID) | Pendente → 200 `{status: 'confirmed', email (mascarado), targetLabel}`; repetido → 200 `already_confirmed`; token inválido → 404; assinatura revogada → 409 `CONFLICT_VERSION`. Sem rate limit dedicado (token UUID, rota idempotente) |
| `/api/v1/public/verify` | GET | público (rate limit **30/min/IP**) | `?code=` (trim+uppercase) → 200 SEMPRE: `{found, kind: 'publication'\|null, code, title, tenantName, publishedAt, revokedAt, status: valida\|revogada\|nao_encontrada}` (busca global por código de publicação; rascunho não verifica). Sem `code` → 422. **Atas** continuam verificáveis no módulo Relatórios pela cadeia de auditoria (ADR-004) — limitação documentada |
| `/api/v1/subscriptions` | GET, DELETE | `subscription.manage` | GET → `{subscriptions: CitizenSubscriptionView[] (com confirmToken APENAS em pendentes ativas — link copiável no sandbox sem SMTP), stats {total, confirmed, pending, byTarget}}`; ordenação pendentes → confirmadas → revogadas. DELETE `?id=` → revoga (grava `revokedAt`, NUNCA apaga) + auditoria `subscription.revoked`; idempotente (200 "já estava revogada"); de outro tenant → 404 |

Rate limit (janela deslizante em memória por (bucket, IP), `src/lib/server/rate-limit.ts`;
produção: Redis): `public:subscriptions` 5/1h · `public:verify` 30/1min ·
`public:hearing-questions` 5/10min (aplicado no POST de perguntas — ver Fase 11). Exceder →
429 Problem Details `RATE_LIMITED` + `retryAfterSeconds` + header `Retry-After`.

### Fase 20 — Suporte, alertas persistentes e exportação assíncrona

| Rota | Métodos | RBAC | Corpo / resposta / erros |
|---|---|---|---|
| `/api/v1/platform/impersonations` | GET, POST | GET: `platform.read` · POST: `impersonation.manage` (sobre o usuário REAL da sessão) | GET → `{history: SupportImpersonationView[] (ativas primeiro, máx 50), active, targets[]}` (alvos elegíveis: ativos, com tenant, papéis NÃO-platform). POST `{targetUserId, reason 10–500, minutes 5–60 (default 30)}` — **EXIGE cookie de sessão por senha** (sem sessão → 409 `CONFLICT_VERSION`: modo demo `x-actor-id` não impersona); alvo platform/inativo/sem tenant → 422 (escalada proibida); 1 ativa por suporte → 422 (vencida é encerrada lazy e prossegue) → 201 `{impersonation}`. Durante a impersonação TODAS as rotas enxergam o ator-alvo; `/auth/me` devolve `actor.impersonation {impersonationId, supportName, targetName, reason, expiresAt}` (banner) |
| `/api/v1/platform/impersonations/:id/end` | POST | `impersonation.manage` (usuário REAL) | Encerra (idempotente): `endedAt` + limpa `impersonationId` de TODAS as sessões + auditoria `support.impersonation_ended`. Expiração é LAZY (leitura com prazo vencido encerra e volta ao suporte); logout também encerra |
| `/api/v1/platform/alerts` | GET | `platform.read` | `{alerts: PlatformAlertView[]}` — abertos primeiro (mais recentes), depois reconhecidos (ack mais recente), máx 50. Deduplicação por `kind` aberto acontece na leitura do system-status |
| `/api/v1/platform/alerts/:id/ack` | POST | `platform.manage` (somente owner) | Reconhece: `ackAt/ackBy` + auditoria `platform.alert_acked` (tenant do `meta` do alerta ou âncora multi-tenant); idempotente (200 sem novo evento). platform_support → 403 |
| `/api/v1/platform/tenants/:id/export` | POST, GET | `platform.manage` | POST → **202 `{job: ExportJobView}`** (cria `ExportJob` pending + auditoria `platform.export_job_created`; worker in-process com etapas reais e progresso monotônico 0–100; falha → `failed` + `error`); job pending/running existente → 409. GET → `{job}` do último job do tenant (null quando nunca houve) |
| `/api/v1/platform/exports/:id` | GET | `platform.manage` | `{job: ExportJobView}` — status/progresso para polling (Console a cada 1s). Inexistente → 404 |
| `/api/v1/platform/exports/:id/download` | GET | `platform.manage` | Somente `done` (senão 409 com estado/progresso atuais). Payload REGENERADO deterministicamente (`buildTenantExport` — shape do export síncrono anterior, sem `passwordHash`/segredos/tokens; voto secreto `value: null`) + `counts`; headers `Content-Disposition: export-{slug}-{jobId}.json` e `X-Export-Snapshot: consistent-at-download-time` (snapshot consistente no momento do download). Auditoria `platform.tenant_exported` APÓS montar o payload |

Alteração: `/api/v1/auth/me` devolve `actor.impersonation` quando a sessão carrega uma
impersonação ativa (transparência do banner; precedência sessão > demo documentada).

### Eventos de auditoria novos (sem eventos outbox/webhook)

`matter.outcome`, `matter.related`, `matter.related_removed` (aggregateType `matter`);
`voting.receipts_issued` (aggregateType `voting`); `subscription.revoked` (aggregateType
`citizen_subscription`); `support.impersonation_started`, `support.impersonation_ended`
(aggregateType `support_impersonation`, na cadeia do TENANT-ALVO com actorName
"Nome (Suporte)"); `platform.alert_acked` (aggregateType `platform_alert`);
`platform.export_job_created` (aggregateType `export_job`); `platform.tenant_exported`
passa a ocorrer no DOWNLOAD do job (aggregateType `tenant`).

### Tipos compartilhados novos (contracts.ts)

`MatterRef`, `RelatedMatterView`, `MatterOutcomeView`, `MATTER_RELATED_KIND_LABEL`,
`MATTER_OUTCOME_KIND_LABEL`; `VotingOptionView`, `VoteReceiptRow`,
`ReceiptsVerificationView`, `MyVoteReceiptRow`; `CitizenSubscriptionView`,
`SubscriptionStats`, `PublicVerifyResult`, `SUBSCRIPTION_TARGET_LABEL`;
`SupportImpersonationView`, `ImpersonationBannerView`, `PlatformAlertView`,
`ExportJobView`, `EXPORT_JOB_STATUS_LABEL`.
