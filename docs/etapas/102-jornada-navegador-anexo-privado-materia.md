# 102 — Jornada de navegador do anexo privado de matéria

**Estado:** L1 parcial executada em build e SQLite descartáveis · **Data:** 10/11/2026 · **Meta:** [testes locais](../META-TESTES-LOCAIS.md)

## Objetivo

Percorrer pelo módulo legislativo a inclusão de um PDF privado, listagem de metadados e download autorizado, conferindo que os bytes baixados correspondem ao arquivo enviado.

## Execução e evidência

Comando: `bun run test:workflow:browser` (requer build standalone e Chromium local). O runner usa servidor e banco SQLite efêmeros. No drawer da matéria criada durante a jornada, Playwright seleciona a espécie “Parecer”, envia arquivo PDF sintético, espera sua listagem, inicia o download pelo botão da interface e compara os bytes com o buffer enviado. A API é consultada para conferir nome e espécie persistidos.

Resultado observado: `ok: true`, `synthetic: true`; anexo `Parecer de ensaio <id>.pdf`, espécie `parecer`, `downloadedBytesMatch: true`. A mesma jornada confirma versões, relacionamento de emenda, protocolo, tramitação e tarefa. Cobertura complementar de API em [matter-attachment-private.test.ts](../../tests/matter-attachment-private.test.ts) verifica hash SHA-256, isolamento de tenant, listagem sem conteúdo, snapshot congelado e rejeição de bytes adulterados.

## Limites

O arquivo é uma fixture sintética mínima aceita pelo validador da aplicação. Este ensaio não avalia qualidade de renderização, assinatura digital, antivírus, PDF de produção, limite de 50 MB, upload interrompido nem acessibilidade completa do seletor. O download foi exercitado com `tenant_admin`; outras permissões e erros visuais precisam de casos.
