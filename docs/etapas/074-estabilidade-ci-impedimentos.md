# P0 — prazo do teste de impedimentos no runner próprio

**Estado em 09/11/2026:** correção de teste em revisão. A [CI do `main` no SHA `9984fd5`](https://github.com/e-docBR/edocBRplenario/actions/runs/42723531480) passou em PostgreSQL e mídia, mas o caso de impedimentos que cria uma sessão e percorre registro, bloqueio de quórum, revogação, pausa e retomada excedeu o prazo padrão de cinco segundos. O timeout encerrou o processo enquanto o Prisma ainda criava a fixture; a mensagem posterior `Response from the Engine was empty` é consequência do encerramento, não evidência de falha do domínio.

O caso mantém todas as mesmas asserções e ganha limite explícito de vinte segundos no runner. Validar com a execução isolada e com os três jobs no PR e em `main`. Se o caso continuar acima desse limite, investigar carga/IO do runner e duração de cada operação; não aumentar o prazo novamente sem medida.
