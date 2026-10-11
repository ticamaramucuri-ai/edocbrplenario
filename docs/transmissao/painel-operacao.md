# Contrato inicial do Painel de Transmissão

**Estado:** especificação para implementação e homologação com a equipe audiovisual de uma Câmara piloto. A primeira fatia, de acompanhamento da fonte local, está implementada na [etapa 003](../etapas/003-painel-transmissao-local.md). A prova técnica está em [prova-local.md](prova-local.md). O painel não controla a abertura, votação ou encerramento legislativo da sessão.

## Papéis e estados

**Nesta primeira fatia**, `session_operator` e `tenant_admin` podem ler e comandar o acompanhamento local (`media.read`/`media.manage`). O papel audiovisual dedicado é requisito da próxima fatia. O sistema futuro deve verificar papel, Câmara e sessão em cada comando, registrar ator, correlationId, horário, destino e resultado. A prévia pública e as métricas não devem revelar chaves, URL com credencial ou identificadores internos de voto.

Uma transmissão da sessão percorre `draft → checking → ready → live → stopping → ended`, com `failed` explícito. Cada destino mantém estado independente (`disabled`, `connecting`, `live`, `reconnecting`, `failed`, `ended`), tentativas com limite e motivo da falha. A transmissão global só entra em `live` após confirmação de ao menos um destino e gravação local ativa; se todos os destinos caírem, o painel mostra **sem público ao vivo**, mantendo gravação e deliberação. Os comandos iniciar/parar exigem chave de idempotência e versão esperada; respostas repetidas não podem iniciar um segundo encoder.

O estado **já implementado** é mais restrito: `draft → ready → monitoring → ended`. `monitoring` só confirma que o MediaMTX local recebeu a fonte; se ela cair, a leitura mostra `signal_lost`. Ele nunca afirma que o público está recebendo vídeo. O fluxo global e os destinos descritos acima são alvo, ainda sem código de acionamento.

## Dados e integração

- `Transmission`: Câmara, sessão, estado, encoder de origem, início/fim, versão, responsável e política de gravação.
- `Destination`: plataforma, identificador público, estado, último sinal, taxa de bits, perdas, tentativas e erro sanitizado. Segredo de ingestão é referência a cofre, nunca coluna de banco ou payload de evento.
- `Recording`: caminho privado, checksum SHA-256, duração, codecs, tamanho, estado de integridade, retenção e vínculo à sessão. O original fica preservado; publicação ou corte gera derivado.
- `TransmissionIncident`: tipo, início/fim, impacto, ação do operador e evidência. A trilha deve permitir relacionar indisponibilidade de vídeo e continuidade da sessão sem confundir os dois estados.

A API deve expor leitura de status e prévia, checagem de áudio/vídeo/gravação/rede, `start`, `stop`, recuperação de destino e incidentes. O encoder/restream informa transições por evento autenticado; o servidor reconcilia estado real antes de confirmar um comando. Métricas brutas de mídia ficam em endpoint operacional protegido; a API entrega um resumo estável ao painel.

Sobreposições consomem apenas snapshots publicáveis da sessão (pauta, orador, quórum e resultado já liberado). Voto secreto individual e resultado parcial oculto nunca entram na camada de mídia. Uma ausência de mídia não bloqueia comandos deliberativos; uma falha de estado deliberativo suprime a sobreposição correspondente até reconciliação.

## Aceite antes do piloto

O operador deve conseguir preparar a sessão, validar áudio e vídeo, iniciar e encerrar um destino, detectar falha, recuperar ou desativar apenas o canal afetado e localizar a gravação íntegra. O ensaio precisa usar hardware, internet e conta institucional da Câmara; medir tempos de detecção/recuperação, taxa de quadros, áudio, upload, duração e checksum. As regras de retenção, autorização de publicação, legendagem e contingência são homologadas com a Casa antes do primeiro evento oficial.
