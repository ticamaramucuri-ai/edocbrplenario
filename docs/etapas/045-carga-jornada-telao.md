# Etapa 045 — Carga concorrente de jornada, telão e portal

**Data:** 21/10/2026 · **Estado:** ensaio local sintético concluído; segue sem prova fora do host e sem observador externo.

Tarefa 12 da trilha C de [`PLANO-CONTINUIDADE-2026-10-20.md`](../PLANO-CONTINUIDADE-2026-10-20.md).
Põe votação, telão e portal sob carga **ao mesmo tempo**, com dois nós de tempo
real, e mede o que o plano pediu. Números em
[`045-prova-carga-jornada-telao.json`](045-prova-carga-jornada-telao.json).

## Perfil executado

| Elemento | Valor |
|---|---|
| Parlamentares votando | 13, em paralelo por rodada |
| Rodadas de votação | 5 (65 votos) |
| Telões conectados | 2, um por nó de tempo real (3103 e 3104), sala pública |
| Nós de tempo real | 2, com fanout por Redis Streams (`fanout: ready`) |
| Leitores do portal | 8, alternando bootstrap, sessões públicas e `public/live` |
| Comandos de telão por rodada | trocar perfil → **congelar durante a votação aberta** → liberar |

Base: tenant sintético `staging-example`, na stack `deploy/staging/compose.yaml`.
Nenhum dado de Mucuri foi usado.

## Números observados (21/10/2026)

| Medida | Valor |
|---|---|
| `atrasoEventoP50` | 419 ms |
| `atrasoEventoP95` | 671 ms |
| `atrasoQuadroCongelado` | 71,62 ms (pior das 5 rodadas; melhor 55,49 ms) |
| `errosHttp` | 0 |
| `eventosPerdidos` | 0 |
| Eventos públicos da sessão | 134, **todos** recebidos pelos dois nós |
| Votos | 65 de 65 esperados |
| Atraso de voto | p50 143,92 ms · p95 222,69 ms |
| Leituras do portal | 545, zero erro |
| Duração da jornada | 8,44 s |

**São números observados nesta máquina, não meta institucional.** O atraso de
evento é dominado pelo intervalo de varredura da outbox (1 s): o evento é
gravado na transação e só sai no próximo ciclo do publicador. É o desenho do
sistema, não contenção — por isso o p50 fica perto de meio segundo enquanto o
registro do voto responde em 144 ms.

## Quadro congelado sob concorrência

Em cada uma das 5 rodadas: 6 votos entram, a Mesa congela o telão, os outros 7
votos entram, e então o quadro público é lido de novo.

Nas 5 rodadas o **SHA-256 e a versão do quadro público não mudaram** enquanto o
estado interno avançava de 6 para 13 votos registrados. É a prova que a tarefa
pedia: congelar durante votação ativa não é uma pausa no sistema, é um corte no
que o público vê.

## O detector foi provado antes de medir

Antes de registrar número, o roteiro foi executado com falha induzida: um dos
telões sai da sala pública por 30 s durante a jornada (`--queda-no 1
--queda-por 30`). Resultado: `eventosPerdidos = 31`, o nó atingido recebeu 23
dos 54 eventos, `ok: false` e saída 1.

Sem isso, um roteiro que nunca acusa perda é indistinguível de um roteiro que
não sabe medir perda. Uma janela curta (10 s) **não** produziu perda: a jornada
dura poucos segundos e a publicação acontece em lotes no início — foi preciso
cobrir a jornada inteira para o evento deixar de chegar.

## Como reproduzir

```bash
python3 scripts/staging-postgres.py stack-up           # stack + seed sintético
docker compose --profile fanout-lab --env-file deploy/staging/.env \
  -f deploy/staging/compose.yaml up -d --no-build realtime_peer   # segundo nó
bun run test:staging:plenary-load -- --rodadas 5 --leitores 8 \
  --output docs/etapas/045-prova-carga-jornada-telao.json
```

O roteiro recusa rodar fora da base com o tenant sintético exclusivo, recusa se
houver sessão em andamento e recusa se qualquer nó de tempo real não estiver
saudável. Falha com saída 1 em evento perdido, erro HTTP, voto divergente ou
quadro congelado que mudou de hash.

**Não entra no CI.** Depende da stack em contêiner com dois nós e Redis, que o
job `application` não levanta; o mesmo vale para `test:staging:display-browser`.
O gate automatizado do CI continua sendo a auditoria de acessibilidade
(`test:a11y:plenario`), que roda em instância descartável.

## Limites

- **A stack roda na própria máquina de desenvolvimento.** Cliente, servidor,
  banco, Redis e os dois nós dividem CPU, memória e rede local. Os atrasos aqui
  não dizem nada sobre rede institucional, latência entre host e plenário, ou
  concorrência com outras cargas reais. A prova fora do host é a **trilha B**,
  bloqueada por falta de host separado — este ensaio não a substitui.
- **Não há observador externo.** O medidor roda ao lado do medido, no mesmo
  host: uma degradação que afete os dois ao mesmo tempo passa sem ser vista.
- Os telões são clientes socket.io, não navegadores em TV: nada aqui mede
  renderização, legibilidade a distância ou comportamento de hardware de vídeo.
- 8 leitores do portal não representam audiência pública real.
- A votação é nominal e o tenant é fictício. Votação simbólica oficial e voto
  secreto (bloqueado) ficam fora.
- O atraso de evento foi medido com relógio único (mesma máquina). Entre hosts,
  a medição exige acordo de relógio — é o que a tarefa 8 da trilha B prevê.
