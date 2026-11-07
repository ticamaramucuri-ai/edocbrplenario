# Etapa 045 — Verificação de saúde feita de fora da instalação

**Data inicial:** 21/10/2026 · **Atualização em 07/11/2026:** ferramenta executada de fora da VPS sintética e agendada no GitHub Actions para quatro serviços base; alerta a responsável e `mail` ainda pendentes.

Tarefa 8 da trilha B de [`PLANO-CONTINUIDADE-2026-10-20.md`](../PLANO-CONTINUIDADE-2026-10-20.md).
A VPS dedicada e o runner hospedado pelo GitHub passaram a fornecer o host
separado para este ensaio sintético. A [prova atual](045-observador-publico-externo.md)
substitui o estado anterior de ausência de host.

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

Essa terceira saída é a decisão de desenho que importa: em host dedicado só o
proxy TLS do gateway fica exposto, então os workers não respondem de fora. O
roteiro **recusa** em vez de supor saúde de quem não conseguiu medir. O app
agora relata também o scheduler no `system-status`, junto com realtime,
webhooks e worker de correio quando configurado. A leitura exige credencial
de plataforma; o endpoint não torna a porta do scheduler pública.
Na unidade systemd, as credenciais são lidas de `EDOCBR_PLATFORM_EMAIL` e
`EDOCBR_PLATFORM_PASSWORD` no arquivo de ambiente privado; o teste também
exerce esse caminho.

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
8. Scheduler relatado pelo app passa; `ok: false` reprova com saída 1 e
   ausência do serviço reprova com saída 2.

O caso 5 só passou depois de corrigir o **teste**: o servidor falso emitia um
`Date` próprio e o desvio simulado entrava como segundo cabeçalho, ignorado.
Sem isso, o caso teria "passado" sem nunca exercitar a detecção.

Em 05/11/2026, executei a sonda pelo gateway local contra os cinco serviços
`app,realtime,webhooks,scheduler,mail`, depois de acrescentar ao seed a conta
fictícia de `platform_monitor` e parametrizar o transporte SMTP opcional no
app da stack. Com `STAGE_SMTP_HOST=mailpit`, remetente e URL pública local no
`.env` privado, a sonda retornou **0**: os cinco serviços saudáveis, versão
esperada conferida e `remoto: false`. O controle negativo com a conta
`tenant_admin` retornou **2** e registrou 403 no `system-status`, sem expor
os workers por porta pública. Depois separei `system.status.read` de
`platform.read`: o papel de suporte existente também podia gerir impersonação,
o que era excessivo para uma sonda. No ensaio HTTP, o monitor autenticou e leu
`system-status` (200), mas recebeu **403** em tenants, impersonações e sessões.
O seed agora gera `STAGE_MONITOR_PASSWORD` separado de `STAGE_ADMIN_PASSWORD`;
usar a senha do administrador no login do monitor retornou **401**. A sonda
com a credencial própria voltou a retornar **0** para os cinco serviços. O
resolvedor de ator também restringe `platform_monitor` ao caminho
`/api/v1/platform/system-status`, para não herdar outras leituras autenticadas;
`GET /api/v1/auth/sessions` retornou **403** no ensaio HTTP. Logout continua
disponível por sua rota pública de revogação da própria sessão.
`bun run test:security`, `bun run typecheck`, `bun run lint` e
`python3 -I tests/test-staging-remote-check.py` passaram. A versão usada naquele
ensaio inicial era `local-unversioned`. Em 06/11, uma imagem local identificada
por SHA passou pela sonda dos cinco serviços, mas um observador em outra máquina
continua obrigatório no host de homologação.

## Agendamento

`deploy/systemd/legis-remote-check.{service,timer}.example`, a cada minuto com
atraso aleatório de até 15 s. O comentário do arquivo é explícito: **instale em
máquina diferente da observada**, porque verificador no mesmo host é sondagem de
dentro com outro nome. Documentado no runbook §4.1.

## Limites

- A execução remota atual cobre `app,realtime,webhooks,scheduler` na VPS
  sintética. `mail` depende de transporte e conta homologados; o relatório
  continua marcando `remoto: false` para alvos de loopback.
- App e mini-serviços agora expõem `EDOCBR_BUILD_VERSION`. O valor padrão
  `local-unversioned` é útil no laboratório, mas não identifica a revisão de um
  deploy; o host de homologação precisa definir `STAGE_BUILD_VERSION`.
- A detecção e recuperação do worker de webhooks foram provadas externamente
  na VPS sintética. Falta destinar eventos a um responsável e medir o aviso;
  histórico do GitHub Actions sozinho não é canal operacional pactuado.
- O [ensaio de corte app↔banco](045-corte-rede-app-banco.md) também confirmou
  localmente `degraded` → `recovered` com o mesmo `incidentId` enquanto a
  prontidão passou por 200 → 503 → 200.
- O cabeçalho `Date` tem resolução de 1 s: detecta desacordo grosseiro de
  relógio, não sincronia fina. Correlacionar log entre máquinas com precisão
  menor que o segundo exige NTP conferido, não este roteiro.
- Não substitui as tarefas 9 e 10 da trilha B (recuperação medida e matriz de
  falhas com observador externo).
