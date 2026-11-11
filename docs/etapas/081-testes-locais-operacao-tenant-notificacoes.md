# L1/L2 — testes locais de tenant, acesso e notificações

**Plano mestre:** L1/L2 · **Estado:** suítes locais isoladas aprovadas · **Data:** 10/11/2026 · **SHA base:** `1422b5f` mais alterações locais desta entrega · **Ambiente:** Linux, SQLite temporário em `/tmp`, fixtures fictícias e serviços loopback; sem rede externa.

## Objetivo e escopo

Verificar funções de tenant/bootstrap, limpeza de fixtures, contas de demonstração, saúde/contatos, emblemas, fila de e-mail, worker e scheduler SQLite. Os wrappers foram lidos antes da execução: cada um prepara base descartável; os testes de processo escutam apenas em loopback; e-mail usa função de envio simulada.

## Verificação

| Comando | Resultado observado |
|---|---|
| `bash scripts/test-mail-delivery.sh` | 4 testes passaram, 42 assertions: inscrição, fila, repetição, cancelamento, isolamento, worker de saúde e scheduler local. O transporte foi simulado; nenhum e-mail real enviado. |
| `bash scripts/test-clean-test-tenants.sh` | 5 testes passaram, 33 assertions: base SQLite explícita, backup, confirmação, simulação e remoção apenas do tenant fictício. O diretório de imagens usado foi temporário. |
| `bash scripts/test-bootstrap-empty-tenant.sh` | 4 testes passaram, 10 assertions: estado vazio, papel de acesso e motivo de bootstrap. |
| `bash scripts/test-seed-demo-logins.sh` | 3 testes passaram, 3 assertions: perfis de demonstração, senha presente e senha inválida recusada. |
| `bash scripts/test-tenant-health-portability.sh` | 1 teste passou, 7 assertions: recorte temporal e isolamento de contadores. |
| `bash scripts/test-party-emblems.sh` | 1 teste passou, 10 assertions: emblema por partido propagado sem atravessar Câmara. |
| `bash scripts/test-tenant-contact.sh` | 1 teste passou, 7 assertions: contatos institucionais validados e isolados por Câmara. |

**Resumo:** 19 testes passaram, 112 assertions, 0 falhas. O resultado é de SQLite local. Não cobre login/MFA completo, aplicação em PostgreSQL, webhooks de saída nem migração de dados legados.

## Resultado e próximo gate

Ficaram exercitados os contratos locais indicados. Próximos grupos a auditar: MFA/API keys, migração, e-mail via API de navegador/capturador, webhooks/scheduler PostgreSQL com banco e serviço local, mídia UI, busca/analytics e acessibilidade. Depois, executar jornadas no navegador com ambiente limpo e atualizar a matriz função por função.
