# P4/P5 — confirmação assinada da transferência ao desktop

**Estado em 08/11/2026:** implementado em laboratório com banco SQLite e migração PostgreSQL 0021; CI e promoção desta PR ainda pendentes. A confirmação não concede autoridade de sessão nem prova presença física de operador.

## Entrega

Ao servir `GET /api/v1/sessions/:id/transfer`, o SaaS registra `LocalSessionTransferIssue` com Câmara, desktop designado, sessão, revisão, hash canônico do manifesto e lista ordenada de IDs, tamanhos e hashes dos artefatos. Repetir o mesmo pacote para o mesmo equipamento reutiliza a emissão. A resposta inclui `X-Edocbr-Transfer-Issue-Id` sem segredo.

Depois de importar e reler a revisão no disco, o cliente envia `POST /api/v1/sessions/:id/transfer-ack`. A assinatura Ed25519 v2 cobre Câmara, dispositivo, método, caminho, timestamp, nonce e SHA-256 dos bytes exatos do JSON; o servidor confere o digest, consome nonce persistido e compara integralmente a confirmação com a emissão. `acknowledgedAt` é escrito condicionalmente e permanece estável em repetição válida. O corpo é limitado a 256 KiB. Emissão de outra Câmara ou dispositivo não é visível. Hash/revisão/artefato divergente retorna 409; corpo alterado após assinatura retorna 401.

Se a resposta do ACK se perder, a revisão já importada continua íntegra. O ciclo seguinte baixa o mesmo pacote, verifica idempotentemente e repete a confirmação com novo nonce. O teste de ponta a ponta cobre essa perda, releitura, ACK posterior, emissão única e ataques de alteração. A migração 0021 é aditiva e não modifica Câmaras existentes.

## Limite e próximo passo

O ACK confirma a declaração assinada do equipamento sobre **todos** os artefatos, após verificação local. Não existe confirmação parcial, transferência em blocos ou retomada por arquivo; uma falha de download exige baixar o pacote inteiro. A confirmação não equivale a autorização para abrir sessão, presença ou voto. A fase seguinte deve tratar retomada durável de artefatos, limpeza/retenção de emissões e nonces, ensaios em rede instável e supervisão do serviço local em Windows/Linux.
