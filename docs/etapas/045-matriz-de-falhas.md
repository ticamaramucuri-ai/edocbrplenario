# Etapa 045 — Matriz de falhas induzidas

**Data:** 21/10/2026; ensaio local em 04/11/2026. **Estado:** cinco cenários executados em sequência na stack sintética; **execução com observador externo e reinício do host pendentes** — não existe host separado.

Passo 1 da tarefa 10 da trilha B de
[`PLANO-CONTINUIDADE-2026-10-20.md`](../PLANO-CONTINUIDADE-2026-10-20.md).

Cinco dos seis cenários obrigatórios têm ensaio local neste repositório; o sexto,
reinício do host, requer infraestrutura separada. A matriz define por cenário **o que
deve acontecer**, **o que invalida o ensaio** e **o que ainda não foi feito**.
Sem critério escrito antes, um ensaio que "rodou sem erro" não distingue sistema
resiliente de ensaio que não exercitou nada.

## Invariantes que valem para todo cenário

Qualquer um destes violado invalida o ensaio inteiro, não só o cenário:

1. **Fato não se perde.** Voto, presença e transição aceitos com HTTP 2xx
   continuam no banco depois da falha, com recibo e auditoria correspondentes.
2. **A outbox drena.** Nenhum evento fica `pending` depois da recuperação; a
   cadeia de hash da auditoria segue verificável.
3. **Nada de voto duplicado.** Mesma chave de comando devolve o voto existente;
   a contagem por votação bate com o número de votantes.
4. **O cliente recompõe.** Telão e portal voltam ao estado corrente por snapshot,
   sem recarga manual, e o quadro congelado conserva hash e versão.
5. **Falha é visível.** O estado degradado aparece — health em 503, selo de
   tempo real indisponível, alerta aberto — em vez de silêncio.
6. **A base é sintética.** Só `staging-example`. Qualquer dado de Câmara real na
   base invalida o ensaio por si.

## Os seis cenários

### 1. Queda do Redis (fanout entre nós)

| | |
|---|---|
| **Deve acontecer** | Health dos dois nós degrada; a outbox **não** publica e os eventos ficam `pending`; ao religar o Redis, os quatro assinantes (interno e público de cada nó) recebem o mesmo `eventId` e o evento vira `published` |
| **Invalida** | Evento entregue a um nó e não ao outro; evento marcado `published` sem entrega; payload interno aparecendo em cliente público |
| **Ensaio hoje** | `bun scripts/staging-realtime-fanout.ts` ([etapa](045-fanout-realtime-dois-nos.md)) |
| **Falta** | Rodar com carga de votação e leitura pública ativas, e com o observador fora do host |

### 2. Queda do PostgreSQL

| | |
|---|---|
| **Deve acontecer** | Escrita recusada com erro claro (nunca 200 falso); leitura pública falha fechada; ao voltar, a jornada retoma e nada aceito antes se perde |
| **Invalida** | Resposta 2xx para escrita que não persistiu; dado parcial (voto sem recibo, sessão sem auditoria); app servindo página com dado obsoleto como se fosse corrente |
| **Ensaio hoje** | `python3 scripts/staging-db-outage-drill.py` |
| **Falta** | Medir a janela de indisponibilidade com observador externo e correlacionar com o alerta aberto |

### 3. Morte do worker de tempo real

| | |
|---|---|
| **Deve acontecer** | A votação continua sendo aceita e gravada; os eventos acumulam `pending`; o selo do cliente vai a "Tempo real indisponível"; ao subir o worker, a outbox drena na ordem e os clientes recompõem |
| **Invalida** | Voto recusado por causa do tempo real (o caminho de escrita não depende dele); evento perdido ou fora de ordem; cliente preso em "Reconectando…" sem diagnóstico |
| **Ensaio hoje** | `python3 scripts/staging-realtime-write-fault.py` e `staging-worker-failure-drill.py` |
| **Falta** | Com dois nós simultâneos e carga de leitura pública |

### 4. Morte do worker de e-mail

| | |
|---|---|
| **Deve acontecer** | As confirmações ficam na fila com estado visível; o scheduler abre alerta por Câmara para pendência acima de 15 min; ao voltar, as entregas são retomadas sem duplicar mensagem |
| **Invalida** | Entrega marcada como enviada sem envio; mensagem duplicada ao retomar; fila esgotada em silêncio |
| **Ensaio hoje** | `python3 scripts/staging-mail-drill.py`: fila → SMTP → captura local → retentativa; para o worker, confirma fila pendente e uma única entrega após reinício |
| **Falta** | Com relay institucional e observador externo; o health atesta o processo, não a entrega |

### 5. Perda de rede entre app e banco

| | |
|---|---|
| **Deve acontecer** | Mesmo desfecho do cenário 2 pela ótica do cliente, com uma diferença: o banco continua de pé, então ao restabelecer a rede **nenhuma** transação aceita pode faltar |
| **Invalida** | Transação aceita e perdida; pool de conexões preso sem recuperar depois do retorno da rede; erro genérico que não distingue banco fora de rede fora |
| **Ensaio hoje** | `python3 scripts/staging-db-network-drill.py` corrigido e executado localmente em 04/11: banco vivo, porta HTTP aberta, sessões aceitas persistidas com auditoria, sete votos concorrentes sem 2xx no corte, sete recibos e repetição idempotente após retorno. [Prova e limites](045-corte-rede-app-banco.md). |
| **Falta** | Múltiplos nós e observador fora do host; prontidão 200→503→200 e eventos locais de incidente já repetidos na stack sintética |

### 6. Reinício do host inteiro

| | |
|---|---|
| **Deve acontecer** | Todos os serviços voltam sozinhos; os volumes duráveis preservam banco, fotos, gravações e replay; a primeira requisição depois do boot responde 200; a outbox retoma do ponto em que parou |
| **Invalida** | Serviço que não volta sem intervenção manual; volume vazio; evento publicado duas vezes depois do boot; replay com hash diferente |
| **Ensaio hoje** | `python3 scripts/staging-postgres.py restart-proof` cobre a persistência do banco após reinício do contêiner |
| **Falta** | Reinício do **host**, não do contêiner — exige host dedicado que se possa reiniciar |

## Execução conjunta local

`python3 scripts/staging-fault-matrix.py --output docs/etapas/045-prova-matriz-falhas-local.json`
executa os cinco cenários na ordem realtime → Redis → correio → PostgreSQL →
rede app↔banco. Exige banco com **somente** `staging-example`, app pronto e
serviços sintéticos ativos. O laboratório de correio é iniciado quando
necessário e parado ao fim; contêineres antigos com rede Docker obsoleta são
recriados sem apagar o volume. Cada roteiro restaura o serviço que interrompe
em `finally`; o executor confere a prontidão entre os cenários. Um leitor
público consulta a listagem de sessões a cada 250 ms durante cada cenário,
conta os status e rejeita HTTP 200 sem lista JSON válida. Nas falhas de banco,
exige que o leitor veja pelo menos uma resposta degradada e uma saudável; nas
demais, exige apenas respostas 200. Se um roteiro falhar, sua prova não contiver
os invariantes essenciais ou a leitura pública divergir, o conjunto falha.

A [prova de 04/11/2026](045-prova-matriz-falhas-local.json) registrou cinco
cenários aprovados: 220 votos e recibos durante a queda do realtime; Redis
retendo a outbox e entregando aos quatro assinantes após retorno; correio local
com STARTTLS, duas retentativas de dois tipos e fila preservada durante a
parada do worker, com uma única mensagem após retorno; 60 leituras antes e depois da
queda do PostgreSQL sem erro; e sete votos HTTP 503 durante o corte de rede,
com recibos, auditoria e incidente correlacionado após retorno. O relatório
marca `remoteObserver: false` e `hostRestartExecuted: false`.

Na repetição com leitura pública contínua, foram **30, 17 e 190 respostas
HTTP 200** durante os cenários de tempo real, Redis e correio. Na queda do
PostgreSQL, o leitor viu 3 respostas 503 e 7 respostas 200; no corte de rede,
28 respostas 503, 9 conexões sem resposta HTTP e 5 respostas 200. Nenhuma
resposta 200 trouxe lista inválida. Esses totais são amostras locais de
intervalos diferentes, não medição de disponibilidade institucional.

## O que bloqueia a execução fora do host

1. **Host separado.** Os cinco cenários já rodam em sequência com leitura pública nesta máquina, mas o plano pede também carga ativa de votação **durante cada falha**, com o observador **fora** do host. Os roteiros locais exercitam cargas diferentes; a matriz local não comprova a carga completa em todos eles. Observador no mesmo host não enxerga a falha que derruba os dois juntos — é a mesma razão da [verificação remota de saúde](045-verificacao-remota-de-saude.md).
2. **Cenário 5 tem prova local parcial.** Corte, escrita de sessão, auditoria, voto, recibo e transição de incidente foram observados na stack sintética, mas ainda faltam carga contínua e observador externo.
3. **Reinício de host** não é reinício de contêiner, e hoje só o segundo é possível.

Enquanto isso não existir, os ensaios individuais valem como incremento técnico
local e nada aqui pode ser apresentado como resiliência institucional.

## Quando houver host

A ordem sugerida, reaproveitando o que existe: subir a carga
(`staging-plenary-load.py`, que já põe votação, dois telões e leitores juntos),
pôr o observador externo (`staging-remote-check.py` por timer, em outra
máquina), e então disparar os cenários na ordem 3 → 1 → 4 → 2 → 5 → 6 — do
menos ao mais destrutivo, para que uma falha precoce não impeça observar as
demais. Cada cenário grava sua prova, e qualquer invariante violado derruba o
conjunto.
