# ADR-012 — Publicações oficiais (diário eletrônico) e participação popular

**Status:** Aceito · **Data:** Fase 11 · **Contexto:** sandbox

## Contexto

O portal público (Fase 6) publicava sessões e matérias, mas a Casa não tinha canal oficial
de atos normativos (atas, decretos, portarias) nem mecanismo de participação popular —
requisito de transparência do prompt mestre (itens 7.10/7.11). Audiências públicas com
perguntas do cidadão exigem escrita de anônimo no banco, o que desafia o modelo de
autenticação por ator.

## Decisão

1. **Publicações numeradas por ano/tenant** (`Publication`, `@@unique([tenantId, year,
   number])`) com **código de verificação** aleatório de 8 caracteres por publicação.
   Máquina de estado `draft → published → revoked`: **revogação nunca apaga** — o portal
   mantém o registro com selo "Revogada" e o motivo (transparência histórica). Rascunho é
   invisível ao público.
2. **Audiências públicas** (`PublicHearing`): máquina `scheduled → open → closed` com
   cancelamento justificado; `questionsOpen` controla a janela de recebimento.
3. **Pergunta do cidadão SEM autenticação** (`POST /public/hearings/:id/questions`):
   rota pública (`?tenant=slug`) valida nome/bairro/e-mail opcional/pergunta por Zod e cria
   a pergunta em `pending`. **A moderação é o filtro**: nada aparece no portal antes de
   aprovação (`approved`) ou resposta (`answered` — resposta oficial com data). Rejeitada
   é interna e terminal.
4. **LGPD por construção:** `authorEmail` é opcional, gravado para contato interno e
   **jamais serializado em nenhuma rota pública** (serializers públicos separados dos
   internos). Moderação vê o e-mail (legítimo interesse administrativo), o público não.
5. Eventos outbox: `publication.published|revoked`, `hearing.state_changed`,
   `hearing.question_approved` (payload SEM dados do autor). Pergunta nova gera notificação
   interna a tenant_admin e legislative_admin (gatilho de moderação).
6. Auditoria em toda escrita autenticada: `publication.published`, `publication.revoked`,
   `hearing.state_changed`, `hearing.question_moderated`, `hearing.question_answered`.
   O POST público não audita (não há ator) — rastro fica na pergunta + notificação.

## Consequências

- (+) Ciclo completo: cidadão envia → modera → publica/responde → portal exibe; diário
  eletrônico com verificação de autenticidade; história normativa preservada.
- (−) Sem rate-limit por IP nem captcha na submissão pública (sandbox) — produção exige
  proteção anti-spam; a resposta do poder legislativo é textual (sem anexo).
- (→) Produção: rate-limit + hCaptcha no endpoint público; assinatura digital (ITI) no
  documento publicado em vez de código alfanumérico.
