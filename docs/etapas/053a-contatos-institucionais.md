# Etapa 053a — Contatos institucionais por Câmara

**Data:** 05/11/2026. **Escopo:** cadastro SaaS de contato institucional e preenchimento local de Mucuri. **Estado:** implementado e testado; ainda sem homologação institucional.

## Entregue

- Onze campos opcionais no tenant: endereço, CEP, dois telefones gerais, telefone da Ouvidoria, três e-mails, site HTTPS, atendimento e horário habitual das sessões. A API valida formato e limita tamanho; a tela Configurações permite editar e consultar por Câmara.
- O horário habitual é apenas informação institucional. Não gera sessões nem substitui o calendário legislativo aprovado.
- A alteração de contatos entra no snapshot da configuração institucional: uma aprovação anterior deve ser revista após mudança.
- Migração PostgreSQL `0018_tenant_institutional_contact.sql`; baseline histórico preservado.
- Importador `scripts/import-mucuri-contact.ts` com prévia, aplicação idempotente e recusa de sobrescrever valor diferente.
- A [página inicial da Câmara](https://camaramucuri.ba.gov.br/) foi consultada em 05/11/2026 e confirma os valores usados. Os 11 campos foram aplicados após backup `db/custom.db.backup.mucuri-contact-20261105T221112Z`.

## Verificação

- `bun run typecheck`, ESLint dos arquivos alterados, `bash scripts/test-tenant-contact.sh` e `bun run test:official-configuration`: passaram.
- `bun run test:postgres:foundation`: migração 0018, cópia/restauração e suítes PostgreSQL passaram.
- Importação em cópia isolada e base local: 11 campos na primeira execução, 0 na segunda. Nenhuma outra Câmara recebeu endereço de Mucuri.

## Próxima etapa

Conferir os contatos com a Câmara na homologação. Obter responsáveis nominais, versão consolidada do regimento, regras de votação e canais oficiais para avançar o piloto. A integração Nextcloud/Alfresco permanece na fase final prevista no plano.
