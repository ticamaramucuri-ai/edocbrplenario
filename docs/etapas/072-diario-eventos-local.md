# P4/P6 — diário local sequenciado e assinado

**Estado em 09/11/2026:** [PR #44](https://github.com/e-docBR/edocBRplenario/pull/44) integrada ao `main` como `77bfe5ba38d42c43535038f825eba5d7989d33e1`; a [CI do `main`](https://github.com/e-docBR/edocBRplenario/actions/runs/42716358446) passou nos três jobs do runner próprio isolado. O PR #43 foi fechado automaticamente quando sua antiga branch base foi removida. Nenhuma votação offline foi liberada.

## Entrega

`src/lib/local-event-journal.ts` grava eventos por sessão em SQLite WAL `FULL`, com transação imediata, sequência esperada, `commandId` idempotente, hash encadeado e assinatura Ed25519. O banco aceita uma Câmara, um dispositivo e uma chave pública específica. Ao abrir, verifica integridade, cursores, hashes e assinaturas. A CLI `journal-verify <raiz>` confere o diário sem rede; `sync`, `run` e `run-credential` verificam o diário antes de iniciar. O [ADR-029](../adr/ADR-029-diario-local-de-eventos.md) registra a decisão e os limites.

## Prova

`tests/local-event-journal.test.ts` ensaiou gravação, repetição entre duas conexões, sequência obsoleta, colisão de `commandId`, persistência após reabrir, Câmara/chave alheia, adulteração direta do payload e bloqueio de nova escrita quando o último evento muda durante o processo. `tests/local-server-cli.test.ts` exercitou `journal-verify` no código e no executável Linux compilado. Os testes passaram com banco descartável; `bun run typecheck`, `bun run lint` e `bun run build` passaram. A compilação cruzada gerou `.exe` Windows x64 com SHA-256 conferido, sem ensaio de execução nesse SO.

O ensaio da aplicação foi **3 testes e 33 asserções** para diário/CLI. A verificação de duas conexões não simula dois processos em hosts distintos nem concede autoridade única; isso permanece como prova posterior de P6.

## Próximo gate

O diário ainda não recebe comandos de presença ou voto e não possui autoridade oficial. Próximos passos: protocolo de concessão/fencing com o SaaS, motor de comandos determinísticos, outbox/ACK, replay e reconciliação, teste de dois processos e falha de energia; instalação e backup Windows/Linux. Este incremento aguarda CI verde no runner próprio antes de merge e promoção à VPS.
