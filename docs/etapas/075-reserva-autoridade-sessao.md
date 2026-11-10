# P6 — reserva transacional de autoridade da sessão

**Estado em 09/11/2026:** implementação interna em ensaio local; não há endpoint de concessão nem operação offline oficial.

## Entrega

`LocalSessionAuthorityLease` guarda uma linha por sessão, época crescente, desktop, revisão, hash do manifesto, prazo e concessão assinada. A reserva usa transação serializável e retry de conflitos de escrita. Exige Câmara ativa, sessão agendada com pauta publicada, desktop registrado e designado, revisão mais recente e ACK integral do pacote exato. Pedido repetido do mesmo desktop devolve a concessão armazenada; renovação nos cinco minutos finais incrementa a época. Outro desktop só recebe após o vencimento da concessão anterior. A auditoria encadeada registra cada emissão/renovação/troca. A FK impede apagar o desktop atualmente referenciado; a linha da sessão preserva a época após a troca.

O teste `tests/session-authority-lease.test.ts` cobre ACK ausente, outra Câmara, revisão obsoleta, reenvio idempotente, renovação, troca antes/depois do vencimento, assinatura, auditoria e três pedidos simultâneos. Três casos e 17 asserções passaram em SQLite descartável. A migração PostgreSQL `0026_local_session_authority_lease.sql` foi aplicada duas vezes (segunda idempotente) no banco descartável da suíte de fundação. Os três casos passaram também em PostgreSQL; um quarto caso disparou três processos independentes e confirmou uma só época, uma linha de concessão e uma linha de auditoria (20 asserções no total). Conflitos transacionais `P2034` esperados ocorreram e foram recuperados pelo retry. A CI inclui ambos os caminhos.

## Limite e próximo gate

A função recebe a chave privada por injeção e não é exposta à rede. Não há custódia de chave, cerca dos escritores web, persistência local da maior época, API LAN, comandos de domínio, sincronização ou reconciliação. Uma concessão curta não garante revogação instantânea de um desktop sem WAN. Próxima prova: política institucional de troca/reserva e cercamento do SaaS antes de expor o endpoint; depois gate local e eventos. Voto offline continua bloqueado.
