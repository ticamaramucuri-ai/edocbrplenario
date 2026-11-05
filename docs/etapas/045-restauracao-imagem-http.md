# Etapa 045 — Imagem restaurada servida por HTTP

**Data:** 05/11/2026. **Estado:** prova local descartável concluída; acervo de documentos e host separado pendentes.

`bun run test:recovery:image-http` cria uma Câmara e um parlamentar fictícios em SQLite temporário, com foto WebP sob diretório privado do tenant. Faz backup conjunto do banco, imagens e `public`, restaura em outro diretório, audita as referências e inicia o build de produção apontando para os caminhos restaurados. O teste lê a imagem pela rota pública, compara todos os bytes com o arquivo restaurado, exige 404 para outro tenant e verifica que adulteração do pacote e remoção da imagem fazem os validadores falharem. A porta de teste é exclusiva e configurável por `RESTORED_IMAGE_PORT`.

**Resultado em 05/11:** `bun run test:recovery:image-http` passou. A mesma verificação foi adicionada à CI depois do build. O ensaio não acessa `db/custom.db` nem fotos reais. O código e o banco temporários são removidos ao terminar.

**Limites:** a prova é de uma imagem WebP sintética e uma instância local. Documentos anexos, gravação/replay, volume distribuído, backup externo, retenção e RTO/RPO institucional permanecem para ensaios próprios e homologação em host separado. O auditor de imagens identifica referências ausentes; o manifesto do pacote identifica adulteração de bytes.
