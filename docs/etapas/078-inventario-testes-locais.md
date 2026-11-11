# L0 — inventário de arquivos de teste local

**Plano mestre:** L0 · **Estado:** inventário inicial implementado e executado · **Data:** 10/11/2026 · **SHA:** `1422b5f` · **Ambiente:** Linux, checkout local, somente leitura

## Objetivo e escopo

Criar um comando reproduzível para inventariar os testes e scripts de teste do diretório `tests/`, agrupando-os por área funcional sem acessar rede, banco de dados ou dados da Câmara. O inventário inicia o mapeamento previsto na [meta de testes locais](../META-TESTES-LOCAIS.md); não avalia conteúdo, cobertura, aprovação nem segurança dos testes.

## Implementação

- `scripts/local-test-inventory.ts`: lista arquivos `.test.ts`, `.test.tsx`, `.sh` e `.py`; agrupa por prefixo; apresenta grupos sem classificação manual; oferece saída Markdown/JSON e opção `--check`.
- `package.json`: comando `bun run test:local:inventory`.
- Não instala dependência, não inicia servidor, não acessa rede e não abre banco.

## Verificação

| Caso | Comando/ambiente | Resultado esperado | Resultado observado |
|---|---|---|---|
| Inventário estruturado | `bun run test:local:inventory -- --json` | JSON com SHA, quantidade, grupos e não classificados | Executado; 83 arquivos enumerados no checkout `1422b5f`; cinco sem classificação na primeira execução. Regex ajustada para classificação explícita de runtime/builds e scripts de staging. |
| Cobertura da classificação | `bun run test:local:inventory -- --check` | Exit 0 e nenhum arquivo sem grupo | Passou após ajustar os padrões de nomes; 83 arquivos em 10 grupos, incluindo quatro arquivos de staging isolados para revisão antes de qualquer suíte local. |
| Escopo | Inspeção do script | Nenhuma chamada a rede ou banco | Confirmado por leitura do código; é leitura do filesystem e de `git rev-parse` somente. |

## Resultado e limites

Este passo deixa um catálogo inicial dos arquivos existentes. Um nome agrupado não demonstra que o teste cobre uma função; alguns itens do grupo de staging não podem entrar na futura suíte local sem revisão do que executam. O inventário não relaciona ainda cada fluxo de usuário às rotas, regras e fixtures, e não executou a suíte funcional.

## Próximo gate

Revisar o conteúdo dos quatro arquivos de staging; cruzar áreas e módulos em `src/modules/`, rotas em `src/app/api/`, testes e scripts; registrar cobertura e lacunas por função na meta local. Depois definir grupos de execução seguros e isolados, antes de rodar a regressão completa.

## Continuação do L0

O primeiro [mapa de cobertura](../MAPA-COBERTURA-TESTES-LOCAIS.md) relaciona os principais módulos, famílias de rotas e arquivos candidatos de teste. Ele marca fala, busca/analytics, migração, integração e comandos locais como lacunas prováveis. As associações ainda não foram auditadas lendo os testes; por isso não contam como cobertura verificada.
