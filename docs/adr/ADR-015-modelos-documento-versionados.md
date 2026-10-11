# ADR-015 — Modelos de documento versionados por tenant

**Status:** Aceito · **Data:** Fase 14 · **Contexto:** sandbox

## Contexto

O prompt mestre pede "templates versionados por tenant" (§7.10): padronizar a redação de
atas, decretos, resoluções, portarias, editais e ofícios com placeholders e histórico de
versões, alimentando o módulo Publicações. Até a v0.9.0 cada publicação nascia de texto
digitado do zero — sem padrão, sem reuso e sem rastro de qual minuta gerou qual ato
oficial.

## Decisão

1. **Dois modelos Prisma**: `DocumentTemplate` (cabeçalho por tenant: `name`, `kind` ∈
   `ata_sessao|decreto|resolucao|portaria|edital|oficio`, `description?`, `active`,
   `currentVersion`) e `DocumentTemplateVersion` (corpo append-only: `version` único por
   template, `bodyMd`, `changeNote?`, `authorName`, `createdAt`). O ponteiro
   `currentVersion` anda para frente; as versões são imutáveis.
2. **Histórico append-only**: versões NUNCA são editadas nem apagadas. `restore` cria uma
   versão NOVA copiando o corpo da versão de origem (changeNote "Restaurado da versão N") —
   voltar no tempo também é um evento auditable. Desativação não exclui: modelos
   desativados continuam lastreando publicações já emitidas.
3. **Render no servidor com placeholders não-bloqueantes**: `POST
   /api/v1/templates/:id/render` resolve 12 tokens (`{{camara}}`, `{{cidade}}`, `{{uf}}`,
   `{{data}}`, `{{hora}}`, `{{ano}}`, `{{sessao.numero|data|tipo}}`,
   `{{materia.titulo|ementa|autores}}`) com contexto opcional `{sessionId?, matterId?}`.
   Token desconhecido ou vínculo ausente NÃO falha o render — permanece no texto e volta
   em `unresolved[]` para revisão humana.
4. **Markdown puro, nunca HTML**: o corpo é Markdown sem interpolação de HTML; o frontend
   renderiza com `react-markdown` (sanitizado por construção). Nenhuma superfície de XSS
   entra no pipeline de publicação.
5. **Sem eventos outbox/webhooks**: o único consumidor do render é interno (a própria
   criação de publicação). Toda a escrita é auditada — `template.created`,
   `template.updated`, `template.version_added`, `template.deactivated` e
   `template.rendered`; este último é gravado na MESMA transação do `POST
   /api/v1/publications` quando o campo opcional `templateId` é informado, tornando a
   origem de cada publicação rastreável até o modelo e sua versão.
6. **RBAC**: escrita exige `template.write` (tenant_admin, legislative_admin); leitura
   (lista, detalhe, render/preview) para qualquer papel do tenant. Template fora do escopo
   do ator → 404 sem vazar existência.

## Consequências

- (+) Padronização auditável com custo mínimo; origem da publicação rastreável na cadeia
  de auditoria; preview barato (sem auditoria) para iterar antes de publicar.
- (−) Sem diff visual entre versões (histórico é textual em timeline); modelo é privado do
  tenant — cada Câmara mantém os seus, sem compartilhamento.
- (→) Produção: "biblioteca global" de modelos compartilháveis entre tenants (com
  curadoria da plataforma), diff lado a lado entre versões e certificação ICP-Brasil no
  pipeline de assinatura das publicações geradas.
