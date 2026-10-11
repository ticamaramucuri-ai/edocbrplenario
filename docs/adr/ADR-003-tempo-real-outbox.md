# ADR-003 — Tempo real via outbox transacional + serviço socket.io

## Status
Aceito

## Contexto
O prompt exige WebSocket autenticado com envelope `RealtimeEvent`, salas por tenant/sessão,
eventos públicos sanitizados e outbox transacional. O sandbox não possui Redis.

## Decisão
1. Toda mutação de domínio grava, **na mesma transação Prisma**, um registro em
   `OutboxEvent` com `internalPayload` (completo) e, quando aplicável, `publicPayload`
   (sanitado para portal/telão).
2. O mini-serviço `mini-services/realtime` (Bun + socket.io, porta **3003**, path `/`)
   faz polling do outbox a cada 500ms, publica os eventos e marca como `published`.
   Deduplicação no cliente por `eventId`.
3. Salas: `tenant:{tenantId}` (escopo interno, handshake com `auth.tenantId`) e
   `public:{tenantId}` (escopo público — portal e telão). Envelope exatamente conforme o
   prompt (`eventId`, `eventType`, `schemaVersion`, `tenantId`, `sessionId`,
   `aggregateId`, `aggregateVersion`, `occurredAt`, `origin`, `correlationId`, `payload`).
4. Eventos públicos nunca expõem: valores de voto secreto, dados pessoais além do nome
   público do parlamentar e status internos administrativos.
5. Cliente conecta em `io("/?XTransformPort=3003")` (regra do gateway Caddy), com
   reconexão exponencial e indicador de status sempre visível (requisito UX do prompt).

## Consequências
- Sem acoplamento HTTP entre API e serviço de tempo real; garantia de entrega ≥ uma vez.
- Latência de propagação ≤ ~1,2s no pior caso — aceitável para o piloto (a ação do
  operador tem resposta otimista imediata da própria requisição).

## Emenda (pós-integração) — contenção de escrita no SQLite

**Problema real encontrado nos testes de plenário**: operações simultâneas (13 check-ins
ou 8+ votos em paralelo) geravam transações concorrentes que colidiam no `BEGIN IMMEDIATE`
do SQLite, estourando o timeout do driver Prisma (P1008 "Socket timeout") — votos eram
perdidos com 500.

**Decisões definitivas**:
1. **Serviço de tempo real SOMENTE-LEITURA** no banco principal: o avanço do outbox é
   feito por *checkpoint* (último `rowid` lido) persistido em arquivo próprio do serviço
   (`mini-services/realtime/checkpoint.json`). O status `published` na tabela tornou-se
   informativo. Motivo: qualquer escrita concorrente do serviço agravava a contenção.
   Na primeira execução sem checkpoint, começa do fim da fila (histórico é reconstruído
   pelos clientes via snapshot `public/live`).
2. **Mutex de escrita in-process** (`src/lib/server/tx.ts`): todas as transações de
   escrita da API são serializadas por uma cadeia de promessas. Cada transação leva
   ~100ms; 13 check-ins paralelos completam em <1s, 13 votos em ~2s, zero perdas.
3. Pool Prisma com `connection_limit=1` + `socket_timeout=30` (URL do banco) como
   barreira adicional.
4. Bulk check-in do frontend é sequencial (o operador não percebe; ~100ms/parlamentar).

**Resultado medido**: 13/13 check-ins paralelos HTTP 200 em 973ms; 13/13 votos paralelos
HTTP 200 em 2.078ms; resultado apurado determinístico e correto; eventos publicados no
telão em ≤3s (outbox + poller 500ms + socket).
