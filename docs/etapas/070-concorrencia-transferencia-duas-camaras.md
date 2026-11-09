# P4 — transferência concorrente de duas Câmaras

**Estado em 09/11/2026:** ensaio local em PostgreSQL descartável aprovado; três jobs de CI aprovados em runner próprio isolado no GitHub Free; promoção à VPS pendente.

## Objetivo e mudança

Medir uma emissão e quatro downloads concorrentes com duas Câmaras fictícias, documentos em bytes no PostgreSQL, assinatura do manifesto, conferência de tamanho/hash e tentativa de acesso cruzado. O ensaio inicial revelou `P2034` na transação serializável que consome o nonce de autenticação do servidor local: um GET retornou 500. A autenticação agora repete até quatro vezes **somente** o conflito transitório `P2034`, com intervalo curto; em cada tentativa reconfere designação, revogação e nonce. Duplicação de nonce continua resultando em `LOCAL_DEVICE_REPLAY` (409).

Arquivos: `src/lib/server/local-device-identity.ts`, `scripts/measure-transfer-capacity.ts` e `scripts/test-postgres-foundation.sh`.

## Evidência

`bun run typecheck`, `bun run lint` e `bun run build` passaram. `bash scripts/test-postgres-foundation.sh` passou, incluindo as 25 migrações PostgreSQL, testes existentes, backup/restauração e o novo ensaio. O resultado em execução direta dos handlers foi: **2 Câmaras, 4 PDFs sintéticos, 50.331.648 bytes (48 MiB)**; emissão concorrente em **333 ms**, quatro GETs em **320 ms**, GET mais lento em **319 ms**; RSS antes da emissão **552 MiB** e pico amostrado **727 MiB**. Todos os hashes e tamanhos coincidiram com os manifestos assinados. O pedido de um tenant para o artefato do outro foi recusado com 401.

As medições são de uma execução em máquina local, com PostgreSQL descartável e chamadas diretas aos handlers. Incluem o runtime de testes e os dados em memória; **não** representam SLO, capacidade de VPS, throughput HTTP/TLS nem PDFs reais. A falha `P2034` apareceu no log antes da repetição bem-sucedida e permanece observável. Não houve dados institucionais.

Uma segunda execução passou após acrescentar duas requisições simultâneas com **o mesmo nonce**: uma retornou 200 com hash correto e a outra 409. Nessa execução, emissão: **519 ms**; quatro GETs: **399 ms**; RSS inicial **812 MiB**, pico amostrado **1.085 MiB**. A diferença de memória entre execuções mostra que estes números não servem como limite de dimensionamento; medir o processo HTTP isolado e o banco sob carga representativa antes de definir capacidade por VPS.

Os primeiros runs hospedados do PR #41 foram recusados antes de executar jobs; a anotação do GitHub apontou cobrança ou limite da conta. O [run 42691450324](https://github.com/e-docBR/edocBRplenario/actions/runs/42691450324) executou no runner próprio `edocbr-ci-vm` dentro de VM Ubuntu 24.04 na estação de desenvolvimento. `media-smoke` e `postgres-foundation` passaram; `application` passou na terceira tentativa, após instalar `unzip` e Docker Compose v2 no convidado. Os três checks ficaram `SUCCESS` no mesmo SHA de código `1399c22`. O job `application` incluiu lint, tipos, testes, build, recuperação HTTP e acessibilidade com Chromium.

O runner é registrado como efêmero por job e o diretório de trabalho é limpo antes do próximo. A VM usa Docker próprio, sem socket ou volumes do host e sem credenciais de produção. O computador precisa estar ligado para executar a CI; ainda falta automatizar o ciclo de vida da VM e provar uma imagem limpa reproduzível. Uma execução posterior da CI nessa VM mostrou que o limite padrão de 5 segundos do teste de 21 votos e 40 leituras pode expirar sob carga, embora não seja um SLO. O teste recebeu prazo explícito de 30 segundos e preserva todas as verificações funcionais. Consultar os checks do SHA atual antes do merge.

## Limites e próxima etapa

P4 continua aberto. Falta medir HTTP real na VPS com volumes e concorrência definidos, quota agregada por Câmara, armazenamento e alertas; testar falha/reinício durante importação; preparar o serviço local supervisionado Windows/Linux (P5). A implantação de produção depende de backup durável, metas RTO/RPO e aceites institucionais; este ensaio não libera o piloto.
