# Integração do edocBR Plenário com Nextcloud e Alfresco

> Este contrato permanece planejado para depois do piloto. A ordem atual e os gates estão no [plano de 05/11/2026](../PLANO-DESENVOLVIMENTO-ATUAL-2026-11-05.md). O inventário institucional deve ser reconfirmado na fase 054.

**Estado em 11/10/2026:** arquitetura proposta e inventário inicial, reservados para a **fase final do projeto**, após o piloto funcional do Plenário. Nenhuma conexão com os serviços reais foi ativada. Este documento é um contrato de trabalho para a Câmara de Mucuri, sujeito à validação dos fluxos, permissões e ambiente disponíveis.

## Papel de cada sistema

| Dado ou ação | Autoridade proposta | Entrada no Plenário | Saída do Plenário |
|---|---|---|---|
| Identidade e vínculo de usuário | Diretório/SSO edocBR, após validação do responsável | Identificador imutável, papel e vínculo com a Câmara | Auditoria de acesso; nenhum cadastro sobrescreve diretório |
| Minuta e versão de documento em trabalho | Nextcloud | Referência WebDAV `fileid`/`etag`, versão, hash e permissão; edição permanece no Nextcloud | Link contextual para minuta ou gravação quando aprovado |
| Protocolo, processo, metadados e arquivo institucional | Alfresco/GED | ID do nó/processo, situação e metadados aprovados | Ata, deliberação e mídia final, com recibo de ingestão |
| Pauta, presença, fala, votação, resultado e sessão | edocBR Plenário | Referências externas e pauta homologada | Fatos imutáveis após confirmação; eventos versionados |
| Transmissão pública | MediaMTX/encoder + contas institucionais | Sinal e estado observado por destino | URL pública e gravação conferida; confirmação de publicação exige evidência da plataforma |

As atribuições são hipóteses de arquitetura, não constatação de que os sistemas atuais já expõem todos os campos. Em particular, o Plenário deve manter a votação e a ata como fatos próprios, enquanto o GED preserva a cópia institucional aprovada. Evitar duas edições concorrentes da mesma matéria: sincronizar referências e estados por contrato, nunca fazer escrita bilateral irrestrita.

## Contrato mínimo de integração

1. **Identidade de origem.** Cada entidade importada recebe `(tenantId, sistema, tipo, externalId)` único, mais versão/etag, hash quando houver arquivo e data da última conferência. Guardar `externalId` como string opaca; não inferir identidade pelo nome do arquivo.
2. **Evento de saída.** Envelope com `eventId`, `schemaVersion`, `tenantId`, `aggregateType`, `aggregateId`, `aggregateVersion`, `occurredAt`, `correlationId` e dados mínimos. Chave idempotente do consumidor: `eventId`. Não incluir segredos, voto secreto individual nem URL RTMPS.
3. **Entrega.** Persistir intenção na mesma transação do fato deliberativo; worker separado entrega com retentativa, backoff, limite e fila de falhas. Marcar ACK só depois de confirmação externa persistida. Assinatura/HMAC ou OAuth de serviço e trilha de auditoria por destino.
4. **Entrada.** Buscar alterações por cursor/versão quando a API permitir. Salvar snapshot de origem; prévia mostra inclusões, atualizações e conflitos. Só aplicar após validação da Câmara. Nunca converter movimento de pasta em comando silencioso para abrir votação ou publicar ata.
5. **Reconciliação.** Consulta periódica compara IDs, versões, hashes e recibos entre os três sistemas. Conflitos ficam visíveis para operador com decisão registrada; não se faz “última gravação vence” em atos oficiais.

## Adaptadores e sequência de implementação

| Ordem | Fase verificável | Saída exigida |
|---|---|---|
| 1 | Inventário em Mucuri: fluxos de protocolo, tipo documental, metadados Alfresco, pasta/Group Folder Nextcloud, responsáveis, LDAP/SSO, regimento e mapa de mandatos | Matriz de fonte de verdade assinada pela área legislativa; dados de teste anonimizados |
| 2 | Modelo de referências externas e contratos versionados, sem conexão de produção | Migração aditiva; índices de unicidade por Câmara; testes de isolamento, idempotência e reprocessamento |
| 3 | Leitura somente do Nextcloud por WebDAV/OCS | Importação de referência e metadados com `fileid`/`etag`, sem mover ou modificar arquivo |
| 4 | Leitura somente do Alfresco por API de conteúdo/CMIS, conforme instância | Associação de nó/processo e prévia de divergências; classificação e ACL verificadas |
| 5 | Saída de deliberação/ata aprovada por outbox para GED e link para Nextcloud | ACK com ID do nó, versão e hash; retry/replay sem duplicata; trilha por sessão |
| 6 | Execução paralela e migração assistida | Reconciliação 100% das entidades piloto, ensaio de reversão, controle de acesso, aceite técnico e legislativo |

## Segurança, operação e critérios

- Cada integração usa conta de serviço com escopo mínimo por Câmara. Tokens em cofre de segredos, nunca no banco de fatos, logs ou payloads de evento.
- Conexões TLS, limites de taxa, timeouts, tamanho máximo, validação MIME/hash de arquivos e proteção contra URL arbitrária são obrigatórios antes de ingestão.
- Assinaturas/atestados do GED não são substituídos por hash do Plenário; o sistema guarda identificador, prova e versão retornados pelo processo institucional.
- Alteração ou indisponibilidade do GED/Nextcloud não altera resultado de votação já encerrada. A pendência de exportação fica explícita e reprocessável.
- A integração real só é habilitada após teste em homologação com permissões e dados representativos, ensaio de falha/retomada e plano de reversão aprovado. O estado operacional dos serviços em 07/10 não pôde ser reconfirmado no relatório interno `/home/suporte/Work/integracao-edocbr/documentacao/RELATORIO-TECNICO-INTEGRACAO-EDOCBR-2026-10-07-ATUALIZACAO.md`; verificar novamente antes de qualquer conexão.

## Referências técnicas

- [Nextcloud WebDAV](https://docs.nextcloud.com/server/stable/developer_manual/client_apis/WebDAV/basic.html) e [OCS API](https://docs.nextcloud.com/server/stable/developer_manual/client_apis/OCS/ocs-api-overview.html).
- [Alfresco Content Services](https://docs.alfresco.com/content-services/7.2/) e [eventos para extensões externas](https://docs.alfresco.com/content-services/7.2/develop/oop-ext-points/).
- Documentos locais: [plano diretor](../PLANO-DESENVOLVIMENTO-PLENARIO.md) §8 e [ADR-003](../adr/ADR-003-tempo-real-outbox.md).
