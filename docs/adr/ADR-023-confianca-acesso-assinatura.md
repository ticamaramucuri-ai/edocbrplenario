# ADR-023 — Confiança de acesso (MFA TOTP + sessões) e assinatura eletrônica de atas

**Status:** Aceito · **Data:** 2026-10-08 (Onda 5 / Fase 22) · **Contexto:** sandbox

## Contexto

O ROADMAP (§7 "OIDC/MFA reais" e §12.2) aponta duas lacunas de confiança:

1. **Autenticação de fator único.** O login por senha (ADR-010) protege a conta apenas com
   algo que o usuário SABE — um vazamento de senha entrega a Casa Legislativa inteira a um
   atacante. Não há segundo fator, o usuário não enxerga QUais dispositivos têm sessão
   ativa (cookie de 7 dias) e não pode revogá-los individualmente.
2. **Documentos sem prova individual de presença.** A integridade agregada existe (cadeia de
   auditoria ADR-004, recibos de voto ADR-019), mas a ATA da sessão — documento oficial que
   registra quem esteve presente — é publicada sem assinatura eletrônica dos parlamentares,
   sem cadeia verificável e sem consulta pública de autenticidade.

## Decisão

1. **TOTP nativo RFC 6238 com `node:crypto`** (`src/lib/server/totp.ts`, sem dependências):
   base32 RFC 4648, HMAC-SHA1, 6 dígitos, janela de 30s; verificação com **drift ±1**
   (aceita o código atual, o anterior ou o próximo — tolera relógio de celular sem abrir
   janela maior). Segredo de 20 bytes aleatórios por usuário (`User.mfaSecret`), exibido
   UMA vez no setup junto da URL `otpauth://` (Google Authenticator e compatíveis). O
   segredo NUNCA é retornado por API depois de habilitado; ao desabilitar, ele é APAGADO
   (`mfaSecret=null`).
2. **Login em dois passos com `401 MFA_REQUIRED` e SEM sessão**: senha correta com MFA
   ativo responde `401` code `MFA_REQUIRED` sem criar AuthSession nem cookie — o
   formulário lê o `code` do problem details, avança para o `InputOTP` de 6 dígitos e
   completa em `POST /auth/login/mfa` (mesma política anti-enumeração: falhas sempre
   `INVALID_CREDENTIALS` genérico). Habilitar exige código válido; DESABILITAR exige
   senha + código (dois fatores para remover o segundo fator) — ambos auditados
   (`user.mfa_enabled`/`user.mfa_disabled`, summary sem o segredo).
3. **Sessões ativas com revogação individual**: `GET /auth/sessions` lista as sessões do
   próprio usuário (revogadas/experiradas fora), marcando `current` pela comparação do
   sha256 do token do cookie; `DELETE /auth/sessions/:id` revoga se — e somente se — a
   sessão pertence ao próprio usuário (de outro → 404), idempotente, encerrando
   impersonação ativa carregada (mesma semântica do logout, ADR-021). `lastUsedAt` é
   atualizado best-effort na resolução da sessão com throttle de 5 min (evita um UPDATE
   por request).
4. **Assinatura eletrônica de atas com cadeia de hash** (análoga ao ADR-019, compartilhando
   `src/lib/server/document-signatures.ts`): `docHash = sha256(contentMd publicado)`;
   `tenantKey = HMAC-SHA256(segredo da plataforma, "tenant:{tenantId}")`;
   `hash = HMAC-SHA256(tenantKey, docHash|parl|signedAt)`; `code = hash[:16]` — e o
   `prevHash` de cada linha guarda o hash COMPLETO da anterior (primeira → null), formando
   a cadeia por documento. **Idempotência** por `(documentId, signatoryParliamentarianId)`
   (unique no banco + verificação prévia em transação serializada): assinar de novo
   devolve a assinatura existente (200, sem nova linha).
5. **A assinatura atesta PRESENÇA, nunca o voto.** Elegibilidade = presença consolidada
   na sessão (último AttendanceEvent por parlamentar); o `docHash` cobre a ata publicada,
   não os votos. A nota aparece no painel de Relatórios, no PWA e no Portal — coerente com
   ADR-002/ADR-013 (sigilo do voto secreto).
6. **Verificação por RECOMPUTE, pública**: `GET /reports/session/:id/ata/signatures`
   (painel autenticado), `GET /public/documents/ata/:sessionId?tenant=` (portal público) e
   `GET /public/documents/verify-signature?code=` (30 req/min/IP — bucket `public:verify`
   compartilhado com a Fase 19) recalculam docHash e o HMAC de CADA linha e conferem os
   elos `prevHash` + código persistido — ata adulterada após a assinatura → `valid=false`.
   Código inexistente não é erro (200 com `valid=false`).

## Alternativas consideradas

- **Biblioteca TOTP externa (otplib, speakeasy)**: dependência desnecessária — o RFC 6238
  cabe em ~80 linhas com `node:crypto`, testável contra os vetores do próprio RFC.
- **Sessão emitida "meio autenticada" enquanto o TOTP falta**: manteria um cookie válido
  para um usuário não totalmente autenticado — qualquer request concorrente viraria sessão
  completa. O 401 MFA_REQUIRED sem cookie é mais simples e seguro.
- **Drift ±N com N grande**: cada janela extra multiplica a superfície de força bruta;
  ±1 cobre dessincronização comum de relógio (delta < 60s) com custo mínimo.
- **Assinatura com ICP-Brasil por parlamentar**: fora do sandbox (certificado A1/A3 por
  usuário); o HMAC determinístico dá a mesma detecção de adulteração com chave
  custodiada pela plataforma (mesma troca do ADR-019).
- **Registrar assinaturas na cadeia de auditoria (ADR-004)**: prova agregada do tenant,
  não um artefato individual consultável publicamente por código.
- **JSON Web Signature (JWS) por assinatura**: mais criptografia assimétrica do que o
  problema pede sem ganho verificável no sandbox; a cadeia HMAC já liga quem/ quando/o quê.

## Consequências

- (+) Login resistente a senha vazada; usuário enxerga e corta dispositivos (cookie de 7
  dias deixa de ser uma porta aberta indefinidamente); revogação da sessão corrente
  equivale a sair.
- (+) Ata com prova individual e RECONTÁVEL: seed e rotas compartilham as MESMAS funções
  criptográficas — 4 assinaturas da ata da 1ª Sessão verificam 4/4 (docHash + elos +
  códigos) e a consulta pública por código confirma signatário, horário e integridade.
- (+) Idempotência real: re-executar `/me/ata/sign` (duplo clique, retry de rede) NÃO cria
  linha nem quebra a cadeia; a auditoria registra `ata.signed`.
- (+) Presença atestada sem violar o sigilo: painel/portal explicitam que a assinatura
  NUNCA revela o voto (ADR-023 nota de rodapé nas três telas).
- (−) Quem detém o segredo da plataforma E acesso de leitura ao banco poderia forjar
  assinaturas/segundos fatores — aceitável no sandbox (segredo fixo documentado);
  produção exige custódia dedicada.
- (−) O rate limit público é por processo em memória (sem efeito atrás de réplicas) e o
  TOTP não tem lockout por tentativas — ambos herdados do modelo sandbox (ADR-020 §11.3).
- (→) **Caminho de produção**: federação OIDC/SAML com IdP da Casa (TOTP como fallback
  offline), assinatura ICP-Brasil QUALIFICADA para atas (certificado A1/A3 ou nuvem),
  custódia de segredos em HSM/KMS POR TENANT com rotação registrada por vigência (a
  recompute usa a chave vigente), lockout progressivo de TOTP e rate limit em Redis.
