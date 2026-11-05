# 045 — PDF e replay restaurados por HTTP

**Data:** 05/11/2026. **Estado:** prova local descartável concluída; volumes e host externos pendentes.

`bun run test:recovery:acervo-http` cria duas Câmaras fictícias em SQLite temporário, dois usuários com senha sintética, uma sessão com PDF versionado no banco, um segmento H.264/AAC e um replay MP4 fora do banco. O utilitário `backup-bundle.py` empacota banco, imagens, `public`, gravações e replay e restaura tudo em outra árvore. Um build de produção é iniciado contra essa restauração, em porta exclusiva.

O ensaio autentica o administrador da Câmara dona do PDF, baixa o documento e compara os bytes com a fonte. Uma conta de outra Câmara recebe 403/404. O replay público retorna bytes idênticos, suporta `Range` com HTTP 206 e retorna 404 para outro tenant. Após alteração dos bytes do PDF no banco restaurado, a verificação do pacote falha e a rota autenticada devolve **409 `DOCUMENT_INTEGRITY_FAILED`**; o conteúdo não é entregue. Replay adulterado ou ausente também devolve 409. A rota do PDF passou a comparar tamanho e SHA-256 com os metadados persistidos antes de servir o arquivo.

**Verificação:** `bun run typecheck`, `bun run build`, `bun run test:recovery:acervo-http` e `bun run lint` passaram. O novo ensaio entrou na CI após o build. A [prova anterior da foto](045-restauracao-imagem-http.md) continua cobrindo imagem e remoção. O PDF da sessão é armazenado no banco; anexos de matéria por URL remota não entram nesta prova. Não houve corte de volume real, rede externa, carga de arquivos institucionais nem medição de RTO/RPO em host separado. O próximo gate de recuperação é repetir o pacote e leituras HTTP em infraestrutura independente, com metas acordadas.
