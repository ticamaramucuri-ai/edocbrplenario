# P3/P4 — PDF privado da matéria

**Estado em 09/11/2026:** [PR #33](https://github.com/e-docBR/edocBRplenario/pull/33) incorporada, CI de `main` [42629354089](https://github.com/e-docBR/edocBRplenario/actions/runs/42629354089) verde e VPS sintética promovida ao SHA `75fe2836ea295b5379c1c2fd6e084b2fe3ddc3b3`.

## Objetivo e mudança

O cadastro de anexo de matéria aceitava somente metadados e URL. A publicação da pauta precisava ler essa URL sob a raiz pública para congelar bytes; referências externas ficavam indisponíveis ao servidor local. Agora a secretaria pode enviar um PDF de até 50 MB para o acervo privado da Câmara pela tela da matéria ou por `POST /api/v1/matters/:id/attachments` multipart.

Os bytes, tipo MIME, tamanho e SHA-256 ficam em `MatterAttachment` no PostgreSQL, sem URL pública. `GET /api/v1/matters/:id/attachments/:attachmentId/file` exige ator autenticado no escopo da matéria, verifica tamanho e hash antes de entregar, e responde sem cache. As listas e o detalhe devolvem só metadados. A tela oferece download autenticado; o registro por URL legada continua disponível e fica sinalizado como referência, sem fingir que seus bytes já foram guardados.

Na publicação ou emenda de pauta, `captureMatterSnapshot` usa os bytes privados verificados e os copia para `SessionMatterArtifact` da revisão. Uma adulteração do conteúdo marca o anexo como indisponível e bloqueia a preparação local da revisão. O pré-voo do piloto também verifica o PDF privado. A migração PostgreSQL `0023_private_matter_attachments.sql` é aditiva; registros legados permanecem com os novos campos nulos.

## Prova

`bash scripts/test-matter-attachment-private.sh` passou com envio válido/inválido, acesso sem identidade, acesso de outra Câmara, lista sem bytes, download íntegro, snapshot sem raiz pública e bloqueio após adulteração. `bash scripts/test-session-transfer-export.sh`, `bun run test:pilot:preflight`, `bun run typecheck`, `bun run lint` e `bash scripts/test-postgres-foundation.sh` passaram. O ensaio PostgreSQL aplicou 23 migrações, conciliou 83 tabelas e restaurou banco e arquivos em ambiente descartável.

Na VPS, a migração 0023 foi aplicada e app, realtime, webhooks e scheduler ficaram saudáveis. O health público `GET /api/v1/health?ready=1` respondeu 200 com `database: ready` e o SHA promovido. A nova rota de arquivo privado sem autenticação respondeu 401. A staging continua com tenant fictício; esta prova não substitui upload institucional ou teste de carga com PDFs de 50 MB.

## Limites e próxima etapa

O PDF privado fica no banco e entra no backup do banco; ainda faltam política de quota por Câmara, teste de volume representativo e controle de tamanho no proxy para pedidos sem `Content-Length`. A rota autenticada não é um mecanismo de publicação ao cidadão: P8 precisa definir autorização, versão e cópia pública aprovada. Anexos legados com URL remota não são importados automaticamente. O pacote web → desktop ainda é monolítico; a próxima entrega P4 deve permitir retomada por artefato verificado, limpeza de emissões e cancelamento seguro.
