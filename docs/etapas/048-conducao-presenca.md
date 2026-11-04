# Etapa 048 — Condução e presença

**Data:** 11/10/2026 · **Estado:** incremento técnico entregue; operação institucional pendente.

O registro de presença do operador e o auto check-in passaram a aceitar `commandId` UUID. Sessões oficiais exigem a chave; uma repetição idêntica devolve o evento original sem novo lançamento, auditoria ou evento de tempo real. Reutilizar a chave com outro parlamentar, ação, origem, autor ou observação retorna 409. O par `(sessão, commandId)` é único no banco. A interface envia UUID nos comandos. A rota do operador só aceita origem `operador`: QR e biometria exigirão dispositivos e protocolos de autenticação próprios antes de serem anunciados como verificados. Também foi fechado o caso em que um operador global poderia apontar parlamentar de outra Câmara na sessão.

O quórum continua calculado a partir da base deliberativa e do livro append-only; a elegibilidade é reavaliada antes do registro. A fase 020 já cobre mandato, licença e suplência; a 021 cobre impedimento no voto; a fila de fala e telão já operam na jornada local. A mudança desta etapa fortalece a escrita de presença, sem alterar o regimento ou presumir um dispositivo institucional cadastrado.

**Verificação:** `bun run test:plenary:official-increments` exercita chave obrigatória, repetição, conflito, origem sem prova, Câmara divergente e auto check-in. `bun run test:session:journey`, lint, tipos e build preservam a jornada anterior. `bun run test:postgres:foundation` aplica a migração 0009 e concilia a cópia SQLite→PostgreSQL.

**Limites:** a autenticação do parlamentar continua baseada no usuário/sessão web; pareamento de dispositivo, posse física, QR assinado e biometria não estão implementados. A [recuperação da mesma chave após recarregar a aba](048-repeticao-checkin-navegador.md) foi acrescentada quando o armazenamento local está disponível. Reconstituição do telão após falha e ensaio com leitor de tela/equipamentos reais continuam pendentes de homologação. Regras de quórum e substituição de Mucuri dependem da matriz regimental aprovada da etapa 046.

**Próxima etapa (049):** conferir por duas identidades a contagem simbólica oficial, provar concorrência e fechar a matriz de votação nominal/simbólica com a Câmara. A trilha técnica inicial consta em [049](049-votacao-oficial.md).
