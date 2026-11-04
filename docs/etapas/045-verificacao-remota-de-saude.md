# Etapa 045 — Verificação de saúde feita de fora da instalação

**Data:** 21/10/2026 · **Estado:** ferramenta pronta e conferida; **execução contra host separado pendente** — não existe host.

Tarefa 8 da trilha B de [`PLANO-CONTINUIDADE-2026-10-20.md`](../PLANO-CONTINUIDADE-2026-10-20.md).
Entrega a ferramenta e o agendamento; o que falta é um host separado para
apontá-la, que é o bloqueio declarado da trilha inteira.

## Por que existe

A aba Sistema e os health checks do runbook §4 são sondagem **de dentro**: o app
consulta os serviços e a si mesmo. Uma falha que derrube app e sondagem ao mesmo
tempo — host desligado, rede cortada, disco cheio — passa sem ser vista
justamente por quem precisaria vê-la.

## O que a ferramenta confere

`scripts/staging-remote-check.py`:

| Confere | Como |
|---|---|
| App de pé e com Câmara | `GET /api/v1/bootstrap` 200 com `tenant.slug` |
| App pronto para usar o banco | `GET /api/v1/health?ready=1`; 503 quando o banco falha |
| Cada serviço esperado | `GET /health` com `ok: true`, por URL direta |
| Revisão implantada | `version` dos health checks, comparável com `--expected-version` |
| Serviço não exposto | `GET /api/v1/platform/system-status`, com credencial de plataforma |
| Acordo de relógio | cabeçalho `Date` de cada resposta contra o relógio local, limite 2 s |
| Latência | por serviço, em milissegundos |

Saídas: `0` tudo certo · `1` serviço doente ou relógio divergente · `2` alvo
inacessível ou serviço esperado **sem como ser verificado**.

Essa terceira saída é a decisão de desenho que importa: em host dedicado só a
porta do app fica exposta, então webhooks e scheduler não respondem de fora. O
roteiro **recusa** em vez de supor saúde de quem não conseguiu medir. O
scheduler, em particular, não aparece no `system-status` do app hoje — sem
`--service scheduler=<url>` ele é reportado como não verificável.

Com `--state-file` e `--events-file`, a sonda mantém o estado da última passagem
e acrescenta um evento JSONL somente ao entrar em degradação ou ao recuperar.
O mesmo `incidentId` liga os dois eventos e não muda em sondagens repetidas
durante a falha. A primeira passagem saudável estabelece a referência sem
inventar um incidente. O timer grava esses arquivos em `/var/lib/legis`.
Os eventos não contêm credenciais nem o corpo das respostas. A unidade systemd
continua saindo com erro enquanto a instalação estiver degradada; o registro
de transições é a evidência local para um monitor externo coletar.

## O que foi conferido

`python3 -I tests/test-staging-remote-check.py` levanta servidores HTTP falsos e
exige:

1. Host inexistente → saída 2, nomeando `app` e `realtime`.
2. App de pé e serviço esperado sem URL → saída 2, nomeando `webhooks`.
3. App e dois serviços sadios → saída 0, com latência por serviço, divergência
   abaixo do limite e a prova gravada em arquivo.
4. Serviço respondendo `ok: false` → saída 1, nomeando o serviço.
5. Serviço com relógio 30 s adiantado → saída 1, acusando o relógio.
6. Prontidão 503 → saída 1 com `database: unavailable`.
7. Saudável → degradado → degradado → recuperado gera somente dois eventos,
   correlacionados pelo mesmo `incidentId`.

O caso 5 só passou depois de corrigir o **teste**: o servidor falso emitia um
`Date` próprio e o desvio simulado entrava como segundo cabeçalho, ignorado.
Sem isso, o caso teria "passado" sem nunca exercitar a detecção.

## Agendamento

`deploy/systemd/legis-remote-check.{service,timer}.example`, a cada minuto com
atraso aleatório de até 15 s. O comentário do arquivo é explícito: **instale em
máquina diferente da observada**, porque verificador no mesmo host é sondagem de
dentro com outro nome. Documentado no runbook §4.1.

## Limites

- **Não houve execução remota.** O alvo disponível é a stack em contêiner desta
  máquina, em loopback. O próprio relatório marca `remoto: false` quando o alvo
  é `127.0.0.1`, `localhost` ou `::1`, e acrescenta esse limite à lista de
  limites do JSON. Nenhum número aqui prova operação fora do host.
- App e mini-serviços agora expõem `EDOCBR_BUILD_VERSION`. O valor padrão
  `local-unversioned` é útil no laboratório, mas não identifica a revisão de um
  deploy; o host de homologação precisa definir `STAGE_BUILD_VERSION`.
- A transição de incidente foi conferida com servidor falso local. Falta
  apontar o timer e o coletor de eventos de um host **diferente** para a
  instalação de homologação e provar detecção e recuperação reais.
- O [ensaio de corte app↔banco](045-corte-rede-app-banco.md) também confirmou
  localmente `degraded` → `recovered` com o mesmo `incidentId` enquanto a
  prontidão passou por 200 → 503 → 200.
- O cabeçalho `Date` tem resolução de 1 s: detecta desacordo grosseiro de
  relógio, não sincronia fina. Correlacionar log entre máquinas com precisão
  menor que o segundo exige NTP conferido, não este roteiro.
- Não substitui as tarefas 9 e 10 da trilha B (recuperação medida e matriz de
  falhas com observador externo).
