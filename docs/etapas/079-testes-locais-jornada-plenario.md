# L1 — execução local dos fluxos de preparação e plenário

**Plano mestre:** L1 · **Estado:** execução local parcial aprovada; uma fixture corrigida · **Data:** 10/11/2026 · **SHA base:** `1422b5f` mais alterações locais desta entrega · **Ambiente:** Linux, SQLite temporário em `/tmp`, fixtures fictícias; sem staging e sem chamadas a serviços institucionais.

## Objetivo e escopo

Executar testes locais existentes para preparação/publicação da sessão, convocação, presença, votação nominal/simbólica, apuração, telão, prontidão e fechamento/ata. Avaliar também se os comandos dos scripts usam banco descartável e se os testes observam regras de negócio pelas rotas.

## Implementação e correção

O primeiro ensaio encontrou que `session-policy.test.ts` usava `scheduledAt` em `2026-11-10`, já passado no relógio de execução. A política exige data futura mesmo quando a antecedência mínima é zero; o 409 era correto. `agenda-amendments.test.ts` tinha a mesma fixture vencida. Os dois testes agora calculam uma data 30 dias à frente para não depender do dia em que a suíte roda.

## Verificação

Todos os scripts abaixo criam arquivo SQLite temporário exclusivo em `/tmp`, aplicam o schema nesse arquivo e removem banco e arquivos auxiliares ao terminar.

| Grupo/command | Resultado observado |
|---|---|
| `bash scripts/test-session-journey.sh` | 1 teste passou, 40 assertions: jornada de duas Câmaras, presença, fala, votação, perda de mídia e correção auditável. |
| `bash scripts/test-plenary-official-increments.sh` | 3 testes passaram, 33 assertions: comandos de presença e votação simbólica com confirmação independente. |
| `bash scripts/test-display-state.sh` | 4 testes passaram, 40 assertions: estado do telão, versões, snapshots e isolamento. |
| `bash scripts/test-session-readiness.sh` | 1 teste passou, 13 assertions: pré-voo deliberativo/mídia e isolamento. |
| `bash scripts/test-session-preparation.sh` | 10 testes passaram, 153 assertions: sessão/política da pauta, emendas, convocação, ciência, prazos, calendário, avisos e destinatários. |
| `bash scripts/test-session-formal-preparation.sh` | 1 teste passou, 26 assertions: documentos PDF versionados, escopo de tenant e declaração idempotente de entrega. |
| `bash scripts/test-voting-policy.sh` | 2 testes passaram, 14 assertions: política, quórum, empate, abstenção e opções. |
| `bash scripts/test-voting-impediments.sh` | 5 testes passaram, 49 assertions: impedimentos e base de votação. |
| `bash scripts/test-official-closure.sh` | 2 testes passaram, 34 assertions: bloqueio de voto secreto e fluxo de ata/publicação/verificação. |
| `bash scripts/test-deliberation-independent.sh` | 3 testes passaram, 65 assertions: livro de papel, impedimentos, anulação, empate e isolamento. |

**Resumo final após a correção:** 32 casos passaram, 467 assertions e 0 falhas na última execução de cada script. Na primeira execução, `session-policy` e depois `agenda-amendments` falharam pelo mesmo motivo de fixture vencida; ambos passaram após a correção e a repetição integral de `test-session-preparation.sh`. Os casos foram chamados diretamente às rotas/API e funções de domínio; isso não equivale a teste visual da aplicação.

## Limites e próximo gate

- A prova cobre fluxos locais web/API/domínio com SQLite fictício. Não cobre telas do navegador, Android/tablets, telões físicos, Windows, Postgres multi-instância ou o futuro servidor LAN.
- A queda de mídia é simulada nas jornadas; nenhum serviço social ou conta externa foi acessado.
- Busca, analytics, migração, integrações Nextcloud/Alfresco, suporte, administração da plataforma, PWA e fluxos UI continuam sem auditoria completa.
- Próximo: mapear assertions de cada arquivo candidato, completar funções ausentes e criar/selecionar jornadas de navegador com instalação local limpa. Implementar o executor local antes de alegar presença/voto offline testados.
