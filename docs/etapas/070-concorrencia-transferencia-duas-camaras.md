# P4 — transferência concorrente de duas Câmaras

**Estado em 09/11/2026:** ensaio local em PostgreSQL descartável aprovado; CI remota impedida antes de iniciar jobs; promoção à VPS pendente.

## Objetivo e mudança

Medir uma emissão e quatro downloads concorrentes com duas Câmaras fictícias, documentos em bytes no PostgreSQL, assinatura do manifesto, conferência de tamanho/hash e tentativa de acesso cruzado. O ensaio inicial revelou `P2034` na transação serializável que consome o nonce de autenticação do servidor local: um GET retornou 500. A autenticação agora repete até quatro vezes **somente** o conflito transitório `P2034`, com intervalo curto; em cada tentativa reconfere designação, revogação e nonce. Duplicação de nonce continua resultando em `LOCAL_DEVICE_REPLAY` (409).

Arquivos: `src/lib/server/local-device-identity.ts`, `scripts/measure-transfer-capacity.ts` e `scripts/test-postgres-foundation.sh`.

## Evidência

`bun run typecheck`, `bun run lint` e `bun run build` passaram. `bash scripts/test-postgres-foundation.sh` passou, incluindo as 25 migrações PostgreSQL, testes existentes, backup/restauração e o novo ensaio. O resultado em execução direta dos handlers foi: **2 Câmaras, 4 PDFs sintéticos, 50.331.648 bytes (48 MiB)**; emissão concorrente em **333 ms**, quatro GETs em **320 ms**, GET mais lento em **319 ms**; RSS antes da emissão **552 MiB** e pico amostrado **727 MiB**. Todos os hashes e tamanhos coincidiram com os manifestos assinados. O pedido de um tenant para o artefato do outro foi recusado com 401.

As medições são de uma execução em máquina local, com PostgreSQL descartável e chamadas diretas aos handlers. Incluem o runtime de testes e os dados em memória; **não** representam SLO, capacidade de VPS, throughput HTTP/TLS nem PDFs reais. A falha `P2034` apareceu no log antes da repetição bem-sucedida e permanece observável. Não houve dados institucionais.

Uma segunda execução passou após acrescentar duas requisições simultâneas com **o mesmo nonce**: uma retornou 200 com hash correto e a outra 409. Nessa execução, emissão: **519 ms**; quatro GETs: **399 ms**; RSS inicial **812 MiB**, pico amostrado **1.085 MiB**. A diferença de memória entre execuções mostra que estes números não servem como limite de dimensionamento; medir o processo HTTP isolado e o banco sob carga representativa antes de definir capacidade por VPS.

O [run de PR #41](https://github.com/e-docBR/edocBRplenario/actions/runs/42671383557) terminou em falha duas vezes, ambas **antes de criar qualquer job** (`jobs.total_count = 0`). O workflow `ci.yml` está ativo, sem diferença em relação à `main`, e as Actions estão habilitadas no repositório. A API não expôs motivo mais específico. Não há resultado de CI para este commit; não mesclar nem promover com base apenas no ensaio local.

O [run posterior do mesmo PR](https://github.com/e-docBR/edocBRplenario/actions/runs/42672974129) finalmente exibiu a anotação do GitHub: *“The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings.”* A causa está na cobrança/limite da conta GitHub, fora do código; a anotação não informa qual das duas condições ocorreu. Regularizar Billing & plans e repetir a CI antes do merge e da promoção.

## Limites e próxima etapa

P4 continua aberto. Falta medir HTTP real na VPS com volumes e concorrência definidos, quota agregada por Câmara, armazenamento e alertas; testar falha/reinício durante importação; preparar o serviço local supervisionado Windows/Linux (P5). A implantação de produção depende de backup durável, metas RTO/RPO e aceites institucionais; este ensaio não libera o piloto.
