# Etapa 049 — Votação nominal e simbólica oficial

**Data:** 11/10/2026 · **Estado:** incremento técnico de conferência simbólica entregue; aceite regimental pendente.

Para sessão marcada como oficial, a votação simbólica agora recebe uma proposta de contagem por operador/secretaria e uma confirmação por **outro usuário** da Presidência ou administração da Câmara. Cada proposta tem revisão persistida; a contagem, nomes e horários dos responsáveis ficam no histórico e na auditoria. Antes da confirmação, uma nova proposta cria nova revisão. Após confirmar, o encerramento só usa a revisão confirmada; não aceita contagem avulsa no corpo do fechamento. A interface da Mesa mostra o estágio e oferece as duas ações. O evento de tempo real publica apenas estado e versão, mantendo a contagem parcial fora do payload público. O fechamento aplica controle de versão no banco para não aceitar uma proposta concorrente.

Votações simbólicas de demonstração mantêm o fluxo anterior. A votação nominal já possuía base e regra congeladas na abertura, voto idempotente, recibos verificáveis, anulação e relatórios da base; esta etapa não altera esses mecanismos. A modalidade secreta continua fora do uso oficial até a fase 050.

Um [incremento posterior](049-repeticao-voto-resposta-perdida.md) permite reenviar na mesma aba um voto cuja resposta se perdeu e confirmar um comando já gravado após o fechamento da votação. Ele não substitui a conferência institucional nem cria histórico imutável de cada tentativa de alteração.

**Verificação:** `bun run test:plenary:official-increments` cobre bloqueio de fechamento sem confirmação, isolamento de Câmara, papéis, proibição de auto confirmação, versão, contagem adulterada no fechamento e resultado apurado. A jornada anterior passa sem regressão. `bun run test:postgres:foundation` aplica a migração 0010 e prova a cópia conciliada de 75 tabelas. Lint, tipos e build verificam API e interface.

**Limites:** a conferência por duas contas não substitui identidade forte nem validação presencial. Uma contagem já confirmada é imutável; erro posterior exige procedimento formal de anulação/novo ato, ainda a especificar com a Câmara. Falta ensaio concorrente de múltiplas instâncias HTTP/WebSocket, revisão independente dos recibos e matriz assinada para desempate, impedimento e maiorias especiais. Por isso esta etapa **não aprova uma votação real**.

**Próxima etapa:** fechar os critérios institucionais de 048/049 e preparar a 051 (ata e transparência), mantendo 050 condicionada à necessidade de voto secreto/continuidade offline. A transmissão social da 052 requer canal e equipamento institucionais; Nextcloud/Alfresco ficam ao fim, nas 054–056.
