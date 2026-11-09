# P4/P5 — retomada do ACK sem baixar novamente a sessão

**Estado em 09/11/2026:** implementação em ensaio; CI e promoção desta PR ainda pendentes. Complementa a [emissão e o ACK integral](063-confirmacao-transferencia-local.md).

`GET /api/v1/sessions/:id/transfer-status?revisionId=...&manifestSha256=...` aceita somente pedido Ed25519 do desktop designado e retorna a emissão exata daquele equipamento, com lista de IDs, tamanhos e hashes dos artefatos e estado do ACK. A rota não entrega bytes de documentos nem dados de outro dispositivo ou Câmara.

Em cada ciclo, o cliente relê o pacote local e verifica assinatura, Câmara, sessão e hashes de todos os arquivos. Se a revisão local é a publicada e o SaaS reconhece a emissão, compara a lista integral de artefatos. Se o ACK está ausente, envia uma nova confirmação assinada com nonce novo; se já foi recebido, mantém a revisão sem repetir o download. Uma revisão nova continua sendo baixada e validada. Falha na verificação local bloqueia a confirmação.

**Prova:** o teste de ponta a ponta perde a primeira resposta de ACK, confirma que o pacote permaneceu íntegro, usa a consulta de estado para repetir só o ACK e mede que o número de downloads permanece um mesmo após ciclos adicionais. A consulta de emissão desconhecida retorna 404. `typecheck`, `lint` e CI são gates.

**Limite:** a recuperação evita redownload apenas depois de uma importação completa. Se a transferência caiu antes da importação, ainda baixa o pacote inteiro. Retomada por artefato, limpeza de emissões/nonces e ensaio com rede instável real continuam pendentes. O estado de ACK não concede autoridade de sessão ou voto.
