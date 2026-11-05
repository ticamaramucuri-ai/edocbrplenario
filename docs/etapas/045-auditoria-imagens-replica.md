# Etapa 045 — Auditoria de imagens antes da réplica PostgreSQL

**Data:** 05/11/2026. **Estado:** guarda e ensaio integral local concluídos; homologação fora do host pendente.

O ensaio `scripts/test-postgres-pilot-replica.sh` agora executa a auditoria de fotos e emblemas sobre o snapshot SQLite **antes** de iniciar PostgreSQL ou copiar dados. A raiz é `PARLIAMENTARIAN_IMAGES_ROOT` quando definida; caso contrário, usa `upload/parliamentarian-images` do projeto. A auditoria já existente exige raiz absoluta e falha se uma URL de imagem é inválida, aponta para outro tenant ou não tem arquivo correspondente. Isso evita declarar íntegra uma réplica cujo banco contém referências a fotos ausentes.

## Evidência local

- `python3 -m unittest tests/test_asset_audit.py -v`: 3 testes passaram, inclusive ausência de foto referenciada causando saída 1 e presença causando saída 0.
- `bash -n scripts/test-postgres-pilot-replica.sh`: passou.
- Auditoria da base local: 14 arquivos referenciados, zero referência ausente, hash agregado `4d871026f5a5e0146935bb643de79341430e7d592dffabda5fdbddc207ebad6e`.
- O servidor local respondeu 200 em `/`, `/api/v1/health?ready=1` e na imagem de teste da Câmara de Mucuri.

## Ensaio integral da réplica

Com o servidor de desenvolvimento parado, foi executado `EDOCBR_PRODUCTION_REPLICA_SMOKE=1 bash scripts/test-postgres-pilot-replica.sh db/custom.db`. Resultado: snapshot SQLite válido com 526 linhas; 14 imagens referenciadas e nenhuma ausente; 18 migrações aplicadas; 78 tabelas e 526 linhas conciliadas; restauração de 3 Câmaras, 5 sessões, 32 matérias, 5 votações e 29 votos. O build de produção executou 11 passos HTTP com cookie real, voto idempotente e isolamento entre duas Câmaras de ensaio. Após backup e nova restauração, sessão encerrada e votação responderam por HTTP; recuperação local observada em 3,283 s. Snapshot 118 ms, cópia/conciliação 7,816 s e restauração inicial 3,061 s. O cliente Prisma SQLite foi reposto pelo script.

O servidor de desenvolvimento foi reiniciado e respondeu HTTP 200 em `/` e `/api/v1/health?ready=1`. O pré-voo de Mucuri continuou `automaticReady: false`: responsável e política de votação sem aprovação, usuários institucionais ausentes, SQLite local, SMTP e destino público de transmissão não configurados.

Esses tempos são do laboratório descartável nesta máquina. Não medem RTO/RPO institucional, volume durável em host separado, interrupção real de serviço nem restauração de todas as imagens pelo aplicativo em outro host. Esses gates permanecem abertos.

## Pacote conjunto de banco e arquivos

Com o servidor parado, `scripts/backup-bundle.py create` gerou pacote SQLite + `images` + `public` em `/tmp/edocbr-mucuri-bundle-20261105`. `restore-files` recuperou o pacote em `/tmp/edocbr-mucuri-restored-20261105`; ambos conferiram 20 arquivos e o mesmo manifesto SHA-256 `4291a878f058fcac8a8dec2e456c03ef301d5205799d762eff5a722f41e1f25a`. Na cópia restaurada: `integrity_check=ok`, zero erros de chaves estrangeiras, 14 imagens referenciadas, nenhuma ausente, hash agregado idêntico ao da origem. Os três anexos existentes são apenas metadados sem URL, estado aceito pelo auditor atual; não comprovam bytes de anexos. O servidor local voltou com `/` e `/api/v1/health?ready=1` em HTTP 200.

Os diretórios `/tmp` são evidência temporária desta máquina e não são política de backup. Não houve prova de mídia gravada, pois o snapshot não possui `SessionRecording` nem raízes de gravação/replay configuradas.
