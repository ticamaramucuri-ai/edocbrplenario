# ADR-019 — Recibos de voto verificáveis e opções regimentais de votação

**Status:** Aceito · **Data:** 2026-08-31 (Onda 4 / Fase 18) · **Contexto:** sandbox

## Contexto

O prompt mestre exige, para votações (§7.7): **opções customizadas aprovadas** além de
Sim/Não/Abstenção ("Subscrição e declaração de voto" com chaves regimentais, ex. "Constar em
ata") e um **recibo verificável** para cada voto nominal — prova individual de que o voto
registrado não foi adulterado. Até a v0.10.0 a integridade era garantida apenas de forma
agregada (cadeia de auditoria ADR-004) e o parlamentar não tinha como conferir o PRÓPRIO voto
depois do fechamento; a contagem só conhecia `sim|nao|abstencao`.

## Decisão

1. **Recibo determinístico HMAC-SHA256 por tenant** (`src/lib/server/receipts.ts`,
   compartilhado entre seed e rotas): payload `votingId|parliamentarianId|value|closedAtISO`;
   `tenantKey = HMAC-SHA256(segredo da plataforma, "tenant:{tenantId}")`;
   `hash = HMAC-SHA256(tenantKey, payload)`; `code = hash[:12].toUpperCase()` (o código que
   o parlamentar confere). O segredo da plataforma é fixo e documentado no sandbox
   (`LEGIS_RECEIPT_SECRET`, default `legis-saas-demo-receipt-secret-v1`); em produção sai de
   um **secret manager com rotação por tenant** (a recomputação usa a chave vigente e as
   rotações registram vigência).
2. **Emissão idempotente na MESMA transação do fechamento** (`issueVoteReceipts` em
   `voting-service.ts`): um recibo por voto registrado (nominal/secreto; simbólico apenas
   com votos individuais), `upsert` pelo par único `(votingId, parliamentarianId)` —
   re-execuções do comando de fechamento preservam o recibo original — + auditoria
   `voting.receipts_issued` na mesma transação. O recibo é emitido no ENCERRAMENTO (nunca
   durante a votação, pois o voto pode mudar); `/me/vote` responde `receiptPending: true`
   enquanto nominal aberto.
3. **Voto secreto com placeholder `__SIGILO__`**: o recibo de votação secreta substitui o
   valor pela constante — prova **participação** sem permitir correlação com o resultado.
   A resposta de verificação jamais contém valores de voto.
4. **Verificação por reconta determinística**: `GET /api/v1/votings/:id/receipts` (RBAC OR
   `audit.read` ∨ `voting.write`) recomputa o HMAC de CADA voto armazenado e compara com o
   `receiptCode` persistido — `{ok, recomputedCount, mismatchCount, receipts[]}`; contam
   como divergência recibo divergente, voto sem recibo e recibo órfão. Votação não fechada
   → 409 (recibos existem apenas após o fechamento). O painel "Recibos verificáveis" da
   Mesa do Plenário exibe o selo verde/vermelho e o botão "Reverificar" (mismatch visível,
   não silencioso).
5. **Recibo do próprio parlamentar** (`GET /api/v1/me/receipts`, RBAC `self.vote`): últimos
   60 recibos com pergunta/modo/encerramento — aba "Recibos" no histórico do App do
   Parlamentar, código em fonte mono para conferência manual.
6. **Opções regimentais customizadas** (`VotingOption`: `key` slug 2–40, `label` 1–60,
   `order`; únicas por votação; 1–5): quando presentes **substituem** `sim|nao|abstencao`
   para efeitos de voto e contagem. `POST /api/v1/sessions/:id/votings` aceita
   `options?: [{key,label}]` (Zod: slug/label/tamanho/duplicidade); o valor do voto
   (`POST votes` e `/me/vote`) é validado contra as chaves — chave inexistente → 422
   Problem Details com as chaves válidas no field error. Votação simbólica com opções
   exige `customCounts` no fechamento (contagem por chave informada pela mesa).
7. **Apuração generalizada** (`computeVotingResultAdvanced`): sem opções delega à lógica
   histórica (inalterada); com opções conta por chave em `resultCounts.custom` (sim/nao/
   abstencoes zerados; naoRegistraram/presentes mantidos), ordenação determinística
   (contagem desc → ordem da opção) e a regra regimental sobre a mais votada —
   `maioria_simples` (empate entre as duas maiores → `empate`), `maioria_absoluta`
   (> metade dos presentes), `unanimidade`; `sem_quorum` segue antes de qualquer regra.
   Frase-resumo e notificação listam os rótulos votados.

## Alternativas consideradas

- **Assinatura digital do parlamentar (ICP-Brasil)**: fora do sandbox (certificado por
  usuário); o HMAC determinístico dá a mesma propriedade de deteccão de adulteração com
  chave custodiada pela plataforma.
- **Recibo aleatório persistido no fechamento (sem determinismo)**: impossível recontar —
  a verificação seria "confiar no que está gravado"; o HMAC permite RECOMPUTAR e comparar.
- **Provar apenas pela cadeia de auditoria (ADR-004)**: prova agregada da sessão, não um
  artefato individual consultável pelo parlamentar e pela mesa.
- **Blockchain externa**: dependência de infraestrutura ausente no sandbox.
- **Opções como votações separadas**: quebraria quórum/resultado único e a leitura
  regimental (uma questão, N respostas mutuamente exclusivas).

## Consequências

- (+) Prova individual e recontável: a determinização seed↔serviço confere 11/11 recibos e o
  tamper-test de um `receiptCode` detecta exatamente 1 divergência (`mismatchCount=1`).
- (+) Votações regimentais reais ("Aprovar e encaminhar/Arquivar/Adiar") com apuração
  determinística e rótulos em Mesa/Telão/Portal/PWA (nunca só cor).
- (+) Sigilo preservado: o recibo da votação secreta comprova participação sem valor —
  coerente com ADR-002/ADR-013.
- (−) O HMAC usa o valor do voto nominal como material: quem detém o segredo da plataforma
  E acesso de leitura ao banco poderia forjar recibos — aceitável no sandbox; produção exige
  custódia/rotação (registrada por vigência) e revisão criptográfica.
- (−) `resultSummary` persistido no fechamento mantém a frase-resumo do momento (frases
  antigas não são reescritas pós-polish); `payloadHash` é referência interna (a verificação
  recomputa pelo código).
- (→) Produção: rotação de segredo com vigência por tenant, recibo impresso/QR na ata,
  endpoint público de conferência por código (sem expor valor) e contagem assinada.
