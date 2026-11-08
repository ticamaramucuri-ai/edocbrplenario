# P4/P5 — descoberta e ciclo de sincronização das sessões

**Estado em 08/11/2026:** implementado em biblioteca e ensaiado com banco SQLite descartável; não é ainda um serviço instalado ou agendado no desktop.

`GET /api/v1/local-preparations` exige o mesmo pedido Ed25519 assinado e nonce persistido do download. A consulta aplica `tenantId`, `status=scheduled` e pauta publicada no banco, ordena por atualização e pagina 100 sessões por pedido. Um cursor de outra Câmara é recusado. A resposta contém apenas identidade da sessão, horário, revisão mais recente e um indicador preliminar de existência do snapshot de matérias. Não devolve documentos, dados de outros tenants nem concessão de autoridade. O indicador não substitui a validação integral da transferência: uma sessão ainda pode retornar 409 se algum byte ou regra faltar.

`discoverPreparedSessions` assina cada página com nonce novo, rejeita formato inesperado, elimina duplicatas e limita a 100 páginas. `synchronizePreparedSessions` baixa as sessões elegíveis uma a uma; registra falhas por sessão e prossegue. O importador mantém idempotência e recusa conteúdo não confiável.

**Prova:** `bash scripts/test-session-transfer-export.sh` inclui 102 sessões sintéticas em duas páginas, verifica que apenas a sessão com revisão integral é preparada e que 101 incompletas são puladas; cobre pedido anônimo e importação repetida. `bun run typecheck` e `bun run lint` compõem o gate da PR. O ensaio com PostgreSQL e CI deve preceder promoção.

**Próxima dependência:** configuração persistente e custódia da identidade do equipamento, ciclo agendado sob supervisão Windows/Linux, recuperação de falhas de rede, ACK por revisão/artefato e limpeza periódica de nonces. A descoberta não autoriza sessão, presença, voto ou telão offline.
