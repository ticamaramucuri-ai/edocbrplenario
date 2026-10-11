# ADR-008 — Importador de migração com pipeline auditável de 8 estágios

**Status:** Aceito · **Data:** Fase 8 · **Contexto:** prompt mestre §14 (migração integral)

## Decisão

A migração do PainelDeskLegis 8.1 é um pipeline **auditável e retomável** de 8 estágios —
`inspect → validate → plan → dry_run → import → reconcile → report → rollback` — executado
por `POST /api/v1/migration/run {stage, runId}` dentro do tenant do ator. Toda linha legada
importada ganha `MigrationMapping` (sourceTable, sourceId → targetModel, targetId):
o ID legado é preservado como referência e **jamais** usado como chave primária nova.
Divergências viram `MigrationIssue` (info/warn/error) — nada é resolvido silenciosamente.

Regras duras:
- **import idempotente**: re-executar pula mappings existentes (inclusive entre runs);
- **reconcile** compara contagens por tabela + amostras + checksum agregado;
- **rollback** remove EXCLUSIVAMENTE os dados apontados pelos mappings do run (ordem
  inversa de dependência) e é **bloqueado para sempre** após a homologação;
- **homologação** exige o estágio `report` concluído e digitação literal "HOMOLOGAR"
  (irreversível, auditada);
- voto/presença/resultado ausente **nunca** é deduzido — vira issue warn para homologação.

## Fonte de demonstração

O sandbox não possui banco HSQLDB real. `scripts/generate-legacy-export.ts` gera
`upload/legacy/` (manifest.json + 6 CSVs) simulando o export do legado com dados fictícios
2021–2024 e sujeira realista: 3 órfãos de presença/voto, 1 votação órfã, duplicidade e voto
NULL — exercitando o estágio `validate`. Quando uma base real for fornecida, o mesmo
pipeline aplica-se trocando apenas o leitor de fonte (`legacy-source.ts`).

## Alternativas consideradas

1. **Importação direta em um único passo** — rejeitada: impossibilita dry-run, reconcile e
   rollback por execução.
2. **Deletar tudo e reimportar para corrigir** — rejeitada: dado legislativo consumido é
   histórico; correção é nova tramitação, não rewrite.

## Consequências

- Parlamentares reincidentes entre legislaturas são importados como cadastro INATIVO com
  mandato da legislatura anterior (warn "nome coincidente") — decisão de domínio marcada
  para homologação funcional.
- O import cria os registros diretamente via Prisma (com snapshots coerentes de quórum/
  resultado), sem passar pelas rotas de API de sessão — as pré-condições operacionais
  (sessão ao vivo, transições) não se aplicam a fatos históricos consolidados.
