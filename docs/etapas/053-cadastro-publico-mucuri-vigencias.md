# Etapa 053 — Cadastro público e vigências de Mucuri

**Data:** 05/11/2026. **Escopo:** base local de Mucuri. **Resultado:** estrutura institucional populada para revisão, sem aprovação do piloto.

## Entregue

- Legislatura com período 2025–2028 e número ordinal opcional no modelo, API e interface. Nenhum número foi presumido.
- Mandatos dos 13 vereadores com início em 01/01/2025, data de posse informada pelo [portal oficial da Prefeitura](https://mucuri.ba.gov.br/posse-historica-robertinho-e-empossado-na-prefeitura-de-mucuri-pela-4a-vez/).
- Mesa atual com quatro posições confirmadas no biênio 2025–2026. Mesa [eleita para 2027–2028](https://camaramucuri.ba.gov.br/por-unanimidade-pamela-seixas-e-escolhida-para-presidir-a-camara-de-mucuri-no-bienio-2027-2028/) com quatro posições `elected`; sem posse confirmada e sem ativação automática.
- API de confirmação de posse com referência ao ato, validação da data e rejeição de vigências sobrepostas. A confirmação atualiza os cargos exibidos nos parlamentares e registra auditoria.
- Migrações PostgreSQL 0016 e 0017. Baseline 0001 permanece imutável.
- Importador idempotente `scripts/import-mucuri-terms.ts`, backup SQLite antes da aplicação e [levantamento completo](../LEVANTAMENTO-PUBLICO-MUCURI-2026-11-05.md).

## Provas

- `bun run typecheck`, ESLint dos arquivos tocados e `bash scripts/test-legislature-optional-number.sh`: passaram.
- `bun run test:official-configuration` e `bun run test:pilot:preflight`: passaram.
- `bun run test:postgres:foundation`: migrações 0016/0017, cópia, restauração e suítes de serviços PostgreSQL passaram.
- Cópia isolada da base: importação repetida sem duplicatas. Base local: 1 legislatura, 13 mandatos, 4 posições `confirmed` e 4 `elected`; 0 usuários de Mucuri.
- Pré-voo local permanece `automaticReady: false`: responsável, política de votação, revisão aprovada, papéis de operação, PostgreSQL, SMTP e destino público de mídia pendentes.

## Próxima etapa

Conferir a composição e os atos com a secretaria legislativa; obter o ordinal da legislatura e as regras regimentais atuais; cadastrar usuários nominais e política de votação com aprovação. Os contatos institucionais precisam de campos próprios no tenant. A Mesa de 2027 só deve ter posse confirmada após o ato efetivo e sua referência. O piloto continua sem homologação externa ou integração Nextcloud/Alfresco.
