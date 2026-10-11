# Etapa 044 — Identidade partidária e arquivos

**Data:** 11/10/2026 · **Estado:** implementação local concluída; persistência institucional e retenção dependem da fase 045.

`Party.emblemUrl` é a referência canônica por `(tenantId, acronym)`. O cadastro de parlamentar herda a imagem do partido; alterar o emblema em um membro ou no cadastro do partido atualiza os demais membros daquela Câmara. O campo legado `Parliamentarian.partyEmblemUrl` permanece como snapshot para leitores existentes de presença, telão e portal. A migração PostgreSQL 0004 e `scripts/backfill-party-emblems.py` reconciliam dados anteriores. Conflitos entre imagens legadas distintas abortam o backfill SQLite para decisão humana.

`PARLIAMENTARIAN_IMAGES_ROOT` permite volume absoluto persistente/compartilhado. O inventário `scripts/audit-parliamentarian-images.py` verifica referências de parlamentar e partido, bytes, ausência, entradas inseguras e órfãos. A exclusão é opt-in (`--delete-orphans`) e limitada a arquivos sem referência com mais de 24 horas; executar depois de backup e apenas com a aplicação em janela controlada. A URL pública continua por tenant, e a escrita exige permissão e converte para WebP.

## Operação e restauração

1. Suspender escritas e trabalhos de mídia; fazer snapshot consistente do banco e de `PARLIAMENTARIAN_IMAGES_ROOT`, `public/` quando houver anexos locais, `MEDIA_RECORDINGS_ROOT` e `MEDIA_REPLAY_ROOT`. Preservar permissões, hashes e cópia imutável fora da máquina.
2. Em destino descartável, restaurar o banco e os quatro diretórios nos mesmos caminhos configurados. Conferir `PRAGMA quick_check` (SQLite) ou verificação PostgreSQL; rodar `python3 scripts/audit-parliamentarian-images.py --source SNAPSHOT.db --root RAIZ_ABSOLUTA --strict` e `python3 scripts/audit-external-assets.py --source SNAPSHOT.db --public-root PUBLIC --recordings-root GRAVACOES --replay-root REPLAY --strict` quando há referências catalogadas. Comparar hashes agregados antes/depois.
3. Abrir uma foto e um replay pela API pública no destino restaurado; a restauração só é aceita se o banco, os arquivos, a leitura e os hashes coincidirem. Política de retenção e mídia institucional exigem definição por Câmara.

**Validação local:** typecheck, lint, build, teste de isolamento de URL e teste em banco descartável que prova propagação da logo, herança por novo membro e negação de acesso cruzado. A prova PostgreSQL aplicou 0001–0004, copiou 70 tabelas e passou nos testes de serviços e jornada. O inventário local encontrou 1 arquivo referenciado, sem ausências; uma cópia restaurada em diretório temporário retornou o mesmo hash agregado. A auditoria de anexos encontrou 3 registros apenas de metadados e nenhuma gravação. O restore de acervo oficial de uma Câmara ainda não foi realizado; esse ensaio fictício não substitui o aceite da fase 045.

**Próxima etapa:** 045 — PostgreSQL, workers e armazenamento persistente no ambiente de homologação, com backup/restore conjunto medido. Nextcloud e Alfresco permanecem ao fim do projeto.
