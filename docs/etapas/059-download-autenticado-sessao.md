# P4 — download autenticado da sessão preparada

**Estado em 08/11/2026:** PR #24 integrada no SHA `6ae820a90a2b28274e66ba2ae0ed13c9f32af326`, CI da `main` 42436434076 aprovada e promoção à VPS de homologação sintética verificada. O endpoint não habilita operação offline nem voto.

`GET /api/v1/sessions/:id/transfer` exige `X-Edocbr-Tenant-Id` e os quatro cabeçalhos de pedido Ed25519 do desktop. O verificador aceita apenas o dispositivo registrado e designado para a Câmara ativa, consome nonce persistido e vincula assinatura a método, caminho e query. A sessão é procurada somente dentro da Câmara autenticada. O servidor prepara a última pauta publicada ainda agendada, confere bytes e hashes congelados, assina o manifesto com a chave privada daquela Câmara fora do repositório e revalida a designação antes da resposta. Ausência de chave devolve 503 estável. A resposta usa `no-store` e não contém a chave pública confiável.

O transporte `EDOCBR-STP1` contém magic, comprimento de cabeçalho de 4 bytes, JSON de manifesto e assinatura, seguido por comprimento de 8 bytes e bytes de cada artefato na ordem do manifesto. Limites: cabeçalho 2 MiB, 500 arquivos e 512 MiB de artefatos. O leitor rejeita pacote truncado, tamanho divergente e bytes extras; o importador confere Ed25519 com chave previamente confiada, hash por arquivo, Câmara, sessão e regressão de revisão antes de mover o ponteiro local.

## Provas

`bash scripts/test-session-transfer-export.sh` usa SQLite descartável e inclui requisição sem credencial, de outra Câmara, replay e dispositivo revogado; baixa pacote com PDF e anexo, importa e relê no armazenamento local. `bun test tests/session-transfer-wire.test.ts` exercita fragmentação de 1 byte, truncamento, sobra e tamanho incorreto. `bun run typecheck` e `bun run lint` passaram, assim como os jobs de aplicação, PostgreSQL e mídia na PR e na `main`. `scripts/staging-image-proof.py` na VPS confirmou `ok: true` com app, realtime, webhooks e scheduler saudáveis no SHA; a URL pública `/api/v1/health?ready=1` respondeu 200 com a versão, e `/api/v1/sessions/invalid/transfer` sem identidade respondeu 401.

## Próxima dependência

O `downloadAndPrepareSession` do cliente assina o pedido, baixa por HTTPS e entrega o pacote ao importador; usa chave privada e confiança fornecidas pelo chamador. As [etapas 061](061-descoberta-sincronizacao-preparacoes.md), [062](062-identidade-e-processo-local.md) e [063](063-confirmacao-transferencia-local.md) acrescentaram descoberta, identidade cifrada e ACK integral. Ainda faltam retomada parcial, instalação supervisionada e custódia institucional. A revogação é conferida antes da entrega; um download já iniciado não pode ser retirado do dispositivo. Validar rate limit, relógio, concorrência entre instâncias, limpeza de nonces e fluxo em rede real. Nenhuma chave institucional foi provisionada na staging sintética.
