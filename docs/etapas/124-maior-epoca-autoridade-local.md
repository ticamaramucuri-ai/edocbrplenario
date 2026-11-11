# 124 — Maior época de autoridade no diário local

**Estado em 11/11/2026:** incremento P6 ensaiado em SQLite descartável; nenhuma concessão é exposta ao desktop pela rede e nenhum ato oficial local está habilitado.

## Objetivo e mudança

O diário do desktop passa a aceitar uma concessão SaaS assinada somente quando ela corresponde à Câmara, sessão, dispositivo, revisão e manifesto preparados. Guarda a maior época por sessão no mesmo banco durável do diário. Após reiniciar o processo, recusa uma concessão de época menor e também uma concessão diferente que reutilize a mesma época. A linha de época recebe assinatura do dispositivo e é verificada ao abrir o diário e antes de aceitar outra concessão.

Arquivos: `src/lib/local-event-journal.ts` e `tests/local-event-journal.test.ts`. O contrato de assinatura e validade continua em `src/lib/session-authority-contract.ts`; esta etapa não muda o formato da concessão nem a reserva no SaaS.

## Prova e limites

O teste com diretório e SQLite temporários verifica aceitação da época 7, reabertura, repetição idempotente, rejeição da época 6, rejeição de conteúdo distinto na época 7, avanço à época 8, rejeição de assinatura adulterada e detecção de alteração direta no hash persistido. Na estação de desenvolvimento, `DATABASE_URL=file:/tmp/edocbr-unit.db bun test tests/local-event-journal.test.ts` passou com 3 testes e 22 asserções; `bun run test:unit` passou com 23 testes e 36 asserções; `bun run test:security` passou com 4 testes e 17 asserções; `bun run typecheck`, `bun run lint`, `bun run build` e `git diff --check` passaram. O SHA deste incremento e a CI serão vinculados pelo PR.

Esta persistência impede reuso acidental de época antiga no mesmo armazenamento íntegro; não detecta restauração integral de um snapshot anterior do disco. O processo local ainda não obtém a concessão por API, não ancora a época em hardware, não usa a concessão para habilitar comandos e não envia eventos ao SaaS. A função `append` do diário continua sendo uma primitiva de ensaio, sem autorização para voto, presença ou fala. P6 segue aberto. Próxima prova: provisionar chave de autoridade, cercar os escritores web e ligar o gate local aos comandos, com falhas de WAN e ACK perdido.
