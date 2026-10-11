# ADR-024 — Ecossistema: chaves de API legk_ e acesso externo escopado

**Status:** Aceito · **Data:** Fase 23 (Onda 5) · **Contexto:** ROADMAP §12.3 — acesso
programático para integradores (painéis de transparência, TV Câmara, portais municipais)

## Decisão

Quem consome dados do Legis SaaS sem ser notificação passiva (webhooks, ADR-007) recebe
**acesso programático autenticado, escopado e limitado** por chaves de API de leitura:

1. **Chaves `legk_` com só-hash persistido e exibição única.** O `tenant_admin` emite chaves
   (`legk_` + 24 chars aleatórios de `crypto.randomInt`, alfabeto sem ambíguos) com nome
   descritivo e um subconjunto dos 4 escopos de leitura (`matters.read`, `sessions.read`,
   `publications.read`, `calendar.read` — permissão `apikey.manage`). O banco persiste apenas
   `prefix` (legk_+8 exibíveis em listas), `hash` sha256 da chave completa, escopos em JSON,
   `lastUsedAt` e `revokedAt`. A chave completa sai do servidor **uma única vez**, no corpo do
   POST de criação — nunca é persistida, logada ou reconstruída (só o hash existe). A auditoria
   (`apikey.created` / `apikey.revoked`) registra nome+escopos, nunca a chave.

2. **Escopos mínimos de leitura derivando o tenant da própria chave.** As rotas externas
   `/api/v1/external/{matters,sessions,publications,calendar}` autenticam por
   `Authorization: Bearer legk_…` → sha256 → lookup de chave **ativa** (inexistente/revogada →
   401 genérico, sem vazar qual). O endpoint exige o seu escopo (ausente → 403
   `FORBIDDEN_SCOPE` com o nome do escopo) e serve SOMENTE dados do tenant da chave — o mesmo
   isolamento server-side do `x-actor-id` (ADR-005), sem depender de nenhum dado do cliente.
   As views são as dos serializadores públicos (mesmo sigilo do portal: votação secreta jamais
   expõe valor; publicações somente `published`; sessões com pauta publicada).

3. **Rate limit 60 req/min por chave em memória.** Janela deslizante por `keyId` via
   `hitRateLimit('external:key', keyId, 60, RATE_WINDOW.MINUTE)` (ADR-020/rate-limit.ts);
   excesso → 429 `RATE_LIMITED` + `Retry-After`. `lastUsedAt` é best-effort (catch silencioso)
   e **não há log de IP** nas chamadas externas — minimização LGPD.

4. **Playground com delegação assinada HMAC de 30s.** Para executar consultas reais in-app
   sem expor/reconstruir a chave, o servidor minta
   `deleg_<base64url({keyId, tenantId, scopes, exp:agora+30s})>.<hmac-sha256(LEGIS_DELEGATION_SECRET, payload)>`
   e faz o `fetch` server-side na porta interna. As rotas externas aceitam o `deleg_` validando
   HMAC + exp e usando o tenant/escopos/keyId do payload (o rate limit conta no mesmo balde via
   keyId). O token morre em 30s e a chave real nunca vai ao navegador.

5. **Revogação append-only imediata.** DELETE marca `revokedAt=agora` (idempotente — repetir
   devolve 200) e nunca apaga a linha: o histórico permanece para auditoria, igual às demais
   trilhas do sistema (ADR-004).

## Justificativa

O ROADMAP §12.3 fecha a lacuna de ecossistema com o mínimo privilégio possível: leitura
somente, por escopo, por tenant. Persistir apenas o hash segue o padrão da indústria (a chave é
um segredo que só existe no cliente); a revogação append-only preserva a trilha LGPD/auditoria.
A delegação HMAC do playground resolve o dilema "testar com a chave real sem entregá-la ao
browser": o servidor é o único detentor do segredo e o token de 30s não é reutilizável depois
da janela. O rate limit em memória reaproveita a infraestrutura já entregue na Fase 19
(ADR-020) com bucket por chave — suficiente e demonstrável no sandbox.

## Alternativas consideradas

1. **API keys persistidas em claro (recuperáveis)** — rejeitada: qualquer vazamento do banco
   vaza todas as integrações; exibição única + hash é o padrão seguro e não prejudica a
   revogação (o hash continua autenticando até revogar).
2. **OAuth2/OIDC completo para integradores** — rejeitado para este estágio: exige emissão de
   tokens, refresh e escopos dinâmicos — peso desproporcional para leitura de dados públicos
   por Câmara; as chaves legk_ cobrem o caso com um modelo auditável.
3. **Playground executando a consulta no browser com a chave real** — rejeitada: exporia o
   segredo ao cliente e o tornaria copiável; a delegação assinada mantém o servidor como único
   detentor.
4. **Basic auth ou chave no query string** — rejeitada: query string vaza em logs/proxies;
   Bearer header é o padrão REST.

## Consequências

- Quem perder a chave não recupera: revoga e reemite (documentado na UI e no FAQ).
- O limite de 60/min é por processo (reinicia com o deploy) — aceitável no sandbox, explícito
  no caminho de produção.
- Cada execução do playground consome 1 hit do limite da chave (mesmo balde, via keyId do
  payload) — coerente: é um uso real.
- O `legk_` é aceito APENAS nas rotas `/external/*`; as rotas internas seguem exigindo ator
  (cookie de sessão ou x-actor-id) — nenhum bypass de RBAC.
- A delegação `deleg_` é aceita apenas com HMAC válido e dentro de 30s; `exp` em epoch ms.

## Caminho de produção

- **Rate limit distribuído**: mover o bucket `external:key` para Redis (INCR+EXPIRE ou
  sorted-set ZREMRANGEBYSCORE) — o contrato `hitRateLimit` não muda (mesma troca prevista no
  ADR-020 para os endpoints públicos).
- **Rotação de chaves**: janela de sobreposição (chave antiga + nova válidas por N dias) com
  `expiresAt` na linha e aviso de troca para o integrador.
- **GraphQL opcional** sobre o mesmo contrato de autorização (chave → escopos → tenant),
  reaproveitando os mesmos serializadores públicos.
- **Marketplace de integrações**: catálogo de receitas prontas (painel da transparência, TV
  Câmara, portal municipal) com emissão guiada de chave por receita.
- **Observabilidade de consumo**: métricas por chave (qps, latência, erros) alimentadas pelo
  `lastUsedAt`/contadores — sem IP (LGPD).
