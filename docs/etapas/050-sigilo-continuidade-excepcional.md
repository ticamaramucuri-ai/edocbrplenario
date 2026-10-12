# Etapa 050 — Sigilo e continuidade excepcional

**Data:** 11/10/2026 · **Estado:** proteção técnica entregue; modalidade secreta e operação offline indisponíveis para atos oficiais.

O esquema atual associa `Vote.value` à identidade do parlamentar. Ocultar esse valor na interface, no evento público ou no recibo não garante sigilo perante operadores do banco. Por isso sessões oficiais rejeitam a criação de votação secreta. Uma votação legada inserida antes da proteção também não pode ser aberta, retomada, encerrada nem receber votos pelas rotas da Mesa ou do App do Parlamentar. A interface omite a modalidade secreta ao preparar uma votação oficial e explica o bloqueio. Sessões demonstrativas continuam com o fluxo anterior para ensaio, claramente sem promessa de sigilo institucional.

**Verificação:** `bun run test:official:closure` cobre criação, abertura legada e lançamento de voto. O mesmo cenário passa em SQLite e no ensaio PostgreSQL da fundação. Lint, tipos e build validam a interface.

**Limites:** esta etapa é uma barreira de segurança, não implementação de voto secreto. O redesenho exigirá separar credencial de elegibilidade e escolha de modo que nem administrador do banco consiga correlacioná-las, além de prova de reconta, ameaça interna e revisão independente. Não há votação offline: durante perda de conectividade, a sessão deve suspender os atos digitais conforme procedimento da Câmara. Autoridade local exclusiva, sincronização e resolução de conflito precisam de projeto e ensaio próprios se a Câmara exigir essa capacidade. Nenhuma política regimental foi presumida.

**Próximo trabalho:** decisão institucional sobre necessidade de voto secreto e contingência offline. O piloto nominal/simbólico pode seguir sem essas funções, com a limitação registrada no aceite.
