# L1/L2 — configuração, matéria, votação e mídia em testes locais

**Plano mestre:** L1/L2 · **Estado:** suítes locais isoladas aprovadas · **Data:** 10/11/2026 · **SHA base:** `1422b5f` mais alterações locais desta entrega · **Ambiente:** Linux, SQLite temporário em `/tmp`, dados fictícios; nenhuma staging ou conta externa acessada.

## Objetivo e escopo

Ampliar a verificação local para configuração oficial, composição deliberativa, capacidade, matéria/anexo, integridade da votação, mídia, publicação de link e replay. Confirmar que cada script cria seu próprio banco descartável e limpar os arquivos auxiliares ao sair.

## Verificação

| Comando | Resultado observado |
|---|---|
| `bash scripts/test-session-capacity.sh` | 1 teste passou; 21 vereadores votaram e 40 leituras públicas simultâneas observaram o resultado. Números são evidência de ensaio local, não SLA. |
| `bash scripts/test-official-configuration.sh` | 1 teste passou; configuração aprovada/versionada por Câmara e bloqueio após alteração. |
| `bash scripts/test-deliberative-roster.sh` | 1 teste passou; suplência, presença externa e snapshot de elegíveis. |
| `bash scripts/test-voting-flow-guards.sh` | 3 testes passaram; cancelamento, sessão/votação inconsistente e recibo após fechamento. |
| `bash scripts/test-voting-annulment-integrity.sh` | 2 testes passaram; anulação, histórico processual, ata, portal, dados públicos e telão. |
| `bash scripts/test-matter-attachment-private.sh` | 1 teste passou; PDF privado por tenant, snapshot e detecção de adulteração. |
| `bash scripts/test-media-reconciliation.sh` | 3 testes passaram; reconciliação após reinício/falha e lease de caminho entre processos. |
| `bash scripts/test-media-public-link.sh` | 2 testes passaram; validação de HTTPS/host, conferência e publicação do link. |
| `bash scripts/test-recording-archive.sh` | 1 teste passou; manifesto, publicação, range, isolamento e adulteração do replay. |

**Resumo:** 15 testes passaram, 216 assertions, 0 falhas. A capacidade registrada no teste é sintética. Esses testes chamam rotas ou domínio e não cobrem a interface visual, o servidor de plenário local ou a aprovação institucional.

## Resultado e lacunas

Os testes confirmam regras e persistência locais para as funções listadas. Não cobrem o ciclo completo de matérias/tramitação, tela de publicação, controle audiovisual por operador, hardware, Windows/Linux desktop, Postgres multi-instância ou canal social real. Os módulos Nextcloud/Alfresco continuam sem adaptador local confirmado.

## Próximo gate

Auditar casos e dependências dos testes restantes (usuários/MFA, migração, tarefas/tramitação, pesquisa/analytics, PWA, e-mail/webhooks e saúde/backup). Depois construir jornadas de navegador locais e, conforme a meta P4–P7, API e executor de sessão no desktop.
