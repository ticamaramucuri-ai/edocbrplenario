# Etapa 045 — Auditoria de imagens antes da réplica PostgreSQL

**Data:** 05/11/2026. **Estado:** guarda local concluída; migração e homologação fora do host pendentes.

O ensaio `scripts/test-postgres-pilot-replica.sh` agora executa a auditoria de fotos e emblemas sobre o snapshot SQLite **antes** de iniciar PostgreSQL ou copiar dados. A raiz é `PARLIAMENTARIAN_IMAGES_ROOT` quando definida; caso contrário, usa `upload/parliamentarian-images` do projeto. A auditoria já existente exige raiz absoluta e falha se uma URL de imagem é inválida, aponta para outro tenant ou não tem arquivo correspondente. Isso evita declarar íntegra uma réplica cujo banco contém referências a fotos ausentes.

## Evidência local

- `python3 -m unittest tests/test_asset_audit.py -v`: 3 testes passaram, inclusive ausência de foto referenciada causando saída 1 e presença causando saída 0.
- `bash -n scripts/test-postgres-pilot-replica.sh`: passou.
- Auditoria da base local: 14 arquivos referenciados, zero referência ausente, hash agregado `4d871026f5a5e0146935bb643de79341430e7d592dffabda5fdbddc207ebad6e`.
- O servidor local respondeu 200 em `/`, `/api/v1/health?ready=1` e na imagem de teste da Câmara de Mucuri.

O ensaio completo de réplica não foi executado enquanto o servidor de desenvolvimento estava ativo: ele recria temporariamente o cliente Prisma e exige janela sem Next. A prova de host separado, volumes duráveis e restauração institucional continua aberta.
