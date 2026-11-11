# 100 — Testes locais do grafo de vínculos entre matérias

**Estado:** L1 executada em SQLite descartável · **Data:** 10/11/2026 · **Meta:** [testes locais](../META-TESTES-LOCAIS.md)

## Objetivo

Acrescentar cobertura específica para a regra do grafo de relacionamentos legislativos: escopo por Câmara, autorização de escrita, autorreferência, tipos válidos, prevenção de ciclos, leitura recíproca, remoção e auditoria.

## Execução

Comando: `bun run test:matter:related-graph`. O wrapper cria SQLite temporário, aplica schema, executa a suíte Bun em modo demo e remove banco/WAL ao sair. A fixture cria duas Câmaras, papéis de `legislative_admin`, `session_operator` e `tenant_admin`, quatro matérias locais e uma matéria estrangeira.

## Resultado observado

1 teste passou com 20 assertions. Foram confirmados: 403 para escrita sem permissão; 403 para matéria de outra Câmara; 422 para autorreferência e tipo inválido; criação de vínculos legítimos em duas arestas; 422 `MATTER_CYCLE` para vínculo reverso duplicado e ciclo indireto com caminho de quatro rótulos; leitura recíproca com direção `to`; remoção pela extremidade oposta sem apagar o vínculo vizinho; três eventos de criação e um de remoção na auditoria.

## Limites

O ensaio verifica o contrato da API/domínio, não os diálogos de erro, confirmação e remoção por todos os papéis na interface. Não cobre limite de profundidade 50, concorrência de duas criações simultâneas, remoção de vínculo ausente/inacessível nem todas as seis classes funcionais. A etapa 099 cobre criação visual de uma emenda. O inventário agora classifica este arquivo em “Matérias e processo legislativo”; o inventário continua sendo uma lista de arquivos, não uma medida de cobertura.
