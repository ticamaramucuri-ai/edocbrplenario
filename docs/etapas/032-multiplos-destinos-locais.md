# Etapa 032 — Dois destinos RTMPS locais

**Data:** 11/10/2026 · **Estado:** prova técnica local concluída; homologação social e banda dedicada pendentes.

O ensaio `bun run test:media:smoke` publica FFmpeg H.264/AAC em um MediaMTX e encaminha para dois receptores RTMPS locais independentes, ambos com certificado temporário e fingerprint conferido. A origem e os dois receptores gravam fMP4. Após reiniciar o encoder, os destinos voltaram a receber; durante a parada do receptor A, o receptor B continuou em `forwarding` e `ready`. A voltou após reinício. Os arquivos da origem e dos dois receptores passaram na inspeção H.264/AAC antes e depois da falha.

Na execução local desta etapa, a observação da reconexão da origem e dos destinos foi de 1.786 ms; A voltou 3.940 ms após seu reinício. Foram 11 segmentos na origem, 6 em A e 7 em B. O armazenamento dos MP4s foi de 5.105.508 bytes na origem, 2.209.722 em A e 3.220.648 em B. Uma amostra das métricas de encaminhamento registrou 4.106 e 4.110 bytes por posição; é apenas um ponto no tempo, não estimativa de banda sustentada. O comando de ativar um destino repetido foi idempotente, e desligar A preservou B no teste de controlador; a resposta não continha os fragmentos de segredo. O ensaio usa `tenantId` fictício e nenhum evento ou chave institucional.

Para repetir: `bun run media:prepare-smoke` e `MEDIAMTX_BIN=/tmp/edocbr-mediamtx-v1.21.2/mediamtx KEEP_MEDIA_SMOKE=1 bun run test:media:smoke`. O segundo comando salva métricas, logs, gravações e `evidence.json` em diretório temporário. A CI também executa esse ensaio. A jornada legislativa da etapa 029 comprova separadamente que a perda simulada de mídia não bloqueia a votação.

**Limites:** ainda faltam ingestão e replay nas redes sociais reais, medição de áudio/vídeo na página pública, falhas simultâneas de rede/energia, banda sustentada de sessão longa, dimensionamento de armazenamento e validação do equipamento da Câmara. Chaves e contas institucionais serão tratadas somente na homologação externa. Nextcloud e Alfresco seguem reservados para a etapa final do projeto.
