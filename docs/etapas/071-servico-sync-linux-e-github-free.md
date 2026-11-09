# P5 — processo de sincronização Linux e orçamento de CI

**Estado em 09/11/2026:** incremento local ensaiado; ainda não há instalador, serviço ativo em máquina piloto, API LAN ou voto offline.

## Entrega

O comando `run-credential <raiz> <arquivo-absoluto> [intervalo]` lê a frase do desktop de arquivo Linux privado entregue pelo gestor de credenciais, sem passá-la em argumentos ou variável de ambiente. Confere dono, modo, tipo, tamanho e redirecionamento; o serviço de exemplo usa `LoadCredentialEncrypted` do systemd, usuário sem privilégio e restrições de filesystem/capacidades. A credencial fonte cifrada e sua chave ainda precisam de provisionamento institucional. Uma reinicialização do processo pode voltar a sincronizar sem terminal, desde que a credencial protegida já esteja provisionada.

A CI ficou restrita a PR e `main`, com cancelamento de execuções substituídas, e a sonda pública passou a cada hora. A razão, os limites e a alternativa de runner próprio estão em [Operação GitHub Free](../OPERACAO-GITHUB-FREE.md). O PR #41 permanece sem merge por bloqueio de cobrança/limite no GitHub; esse impedimento não autoriza promover código sem CI.

## Verificação e próximo gate

`DATABASE_URL=file:/tmp/edocbr-local-credential-test.db bun test tests/local-service-credential.test.ts tests/local-server-cli.test.ts` passou (2 testes, 15 asserções): arquivo privado, symlink, modo aberto e frase curta, além de execução real do comando sem terminal. `bun run typecheck`, `bun run lint` e `bun run build` passaram. `systemd-analyze verify` reclamou que `/usr/local/bin/bun` não existe no computador de desenvolvimento: o instalador precisará colocar o binário nesse caminho e validar a unidade no host alvo. Próximo gate: processo instalado e supervisionado em Linux e Windows, reinício e atualização fora de sessão, backup/segredos, depois API LAN protegida e autoridade única.
