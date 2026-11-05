# Etapa 045 — Referências de arquivos no pré-voo

**Data:** 05/11/2026. **Estado:** verificação local concluída; homologação externa pendente.

`inspectPilotPreflight` ganhou a checagem `asset_references`, restrita ao tenant consultado. Ela lê fotos de parlamentares, emblemas de partidos e URLs de anexos de matérias. Para arquivos locais, valida que o caminho pertence à raiz configurada, que não há `..` nem symlink nos componentes, que o arquivo existe e que o tamanho do anexo corresponde ao registrado quando há `sizeBytes`. URLs remotas são contadas como **sem verificação local**, sem alegar disponibilidade externa. Anexos apenas com metadados, sem URL, continuam fora dessa checagem; sua existência documental deve ser validada na jornada da sessão.

**Prova:** `bun run test:pilot:preflight` passou com duas Câmaras, foto e anexo ausentes, restauração dos arquivos e tamanho divergente. Typecheck e ESLint passaram. O pré-voo de Mucuri retornou `automaticReady: false`, mas `asset_references: ok` com 13 imagens, zero ausências/inválidos e zero anexos com URL. Nenhum dado de Mucuri foi modificado.

**Limites:** existência e tamanho não provam o conteúdo do arquivo; a integridade do pacote restaurado é conferida pelo manifesto SHA-256. O pré-voo não acessa URLs remotas nem arquivos armazenados em outro serviço. A prova HTTP da foto restaurada está na [etapa de portabilidade](045-restauracao-imagem-http.md). Antes de uso oficial, anexos e documentos exigidos precisam ser conferidos pela Câmara.
