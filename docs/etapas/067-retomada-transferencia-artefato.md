# P4 — retomada da transferência por artefato

**Estado em 09/11/2026:** implementado e ensaiado localmente com dados fictícios. PR, CI e promoção à staging serão registrados após a revisão. P4 e P5 continuam abertos.

## Entrega

O servidor local designado obtém um manifesto assinado por `GET /api/v1/sessions/:id/transfer-manifest`. A resposta contém a emissão persistida, a revisão, os hashes e a assinatura Ed25519. O cliente valida a assinatura, a Câmara e a sessão **antes** de pedir qualquer arquivo. Para cada artefato ausente, usa `GET /api/v1/sessions/:id/transfer-artifacts/:artifactId?issueId=...` com autenticação assinada do dispositivo. A API confere designação, emissão, revisão corrente, manifesto e recibos; uma emissão obsoleta não fornece bytes. A rota antiga de pacote integral permanece disponível para compatibilidade.

O cliente guarda cada artefato somente após conferir tamanho e SHA-256, em cache parcial separado por Câmara, sessão e hash do manifesto. Arquivo parcial, adulterado ou de outra revisão não dá prontidão. Em nova tentativa, bytes íntegros são reutilizados. Apenas depois de reunir e verificar todos os bytes o importador troca atomicamente a revisão preparada, relê o pacote e envia o ACK integral existente. A recuperação do ACK perdido continua sem novo download.

## Prova e limite

`bash scripts/test-session-transfer-export.sh` passou com 4 testes/74 expectativas: autenticação, isolamento da emissão, interrupção por resposta truncada, bytes adulterados, reutilização do primeiro artefato e ACK após importação. Os testes de contrato, wire, importador e cache parcial passaram com 12 testes/51 expectativas. `bun run typecheck`, `bun run lint` e `bun run build` passaram. O teste de cache prova separação entre Câmaras/revisões, recusa de hash inválido, arquivo adulterado e link simbólico.

Este incremento não instala nem supervisiona o serviço Windows/Linux; não abre API LAN ou voto offline. A rota de cada artefato ainda recompõe o candidato completo da revisão, o que exige otimização e medição para sessões grandes. Emissões antigas e caches de transferências que nunca terminam precisam de retenção/limpeza operacional. Também faltam quotas por Câmara, custódia institucional das chaves, cancelamento e ensaio em dois computadores com interrupção real de rede/energia. Nenhum desses pontos é homologação institucional.

## Próxima prova

Limitar e limpar emissões/caches obsoletos; medir transferência de documentos representativos e concorrência de Câmaras; depois estruturar o serviço local instalável em Windows/Linux e sua API LAN protegida, conforme P5/P10. A autoridade única e o retorno de eventos ao SaaS pertencem a P6.
