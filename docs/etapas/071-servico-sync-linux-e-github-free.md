# P5 — processo de sincronização Linux e orçamento de CI

**Estado em 09/11/2026:** incremento local ensaiado; ainda não há instalador, serviço ativo em máquina piloto, API LAN ou voto offline.

## Entrega

O comando `run-credential <raiz> <arquivo-absoluto> [intervalo]` lê a frase do desktop de arquivo Linux privado entregue pelo gestor de credenciais, sem passá-la em argumentos ou variável de ambiente. Confere dono, modo, tipo, tamanho e redirecionamento; o serviço de exemplo usa `LoadCredentialEncrypted` do systemd, usuário sem privilégio e restrições de filesystem/capacidades. A credencial fonte cifrada e sua chave ainda precisam de provisionamento institucional. Uma reinicialização do processo pode voltar a sincronizar sem terminal, desde que a credencial protegida já esteja provisionada.

O comando `status <raiz>` lê o acervo **sem rede**, verifica assinatura e todos os bytes da revisão importada antes de marcar cada sessão como `ready`. Arquivo alterado resulta em `corrupt`; trava de importação, estágio temporário ou revisão nova órfã resulta em `incomplete`, mesmo quando uma revisão anterior continua íntegra. Ambos retornam código de saída 2. O inventário só lê a Câmara vinculada ao dispositivo. Este status de preparação não concede autoridade para abrir sessão nem executar votação offline.

A CI ficou restrita a PR e `main`, com cancelamento de execuções substituídas, e a sonda pública passou a cada hora. A razão, os limites e a alternativa de runner próprio estão em [Operação GitHub Free](../OPERACAO-GITHUB-FREE.md). O PR #41 permanece sem merge por bloqueio de cobrança/limite no GitHub; esse impedimento não autoriza promover código sem CI.

## Verificação e próximo gate

`DATABASE_URL=file:/tmp/edocbr-local-credential-test.db bun test tests/local-service-credential.test.ts tests/local-server-cli.test.ts` passou (2 testes, 15 asserções): arquivo privado, symlink, modo aberto e frase curta, além de execução real do comando sem terminal. `bun run typecheck`, `bun run lint` e `bun run build` passaram. `systemd-analyze verify` reclamou que `/usr/local/bin/bun` não existe no computador de desenvolvimento: o instalador precisará colocar o binário nesse caminho e validar a unidade no host alvo. Próximo gate: processo instalado e supervisionado em Linux e Windows, reinício e atualização fora de sessão, backup/segredos, depois API LAN protegida e autoridade única.

O inventário offline passou em `tests/local-session-package-store.test.ts`: Câmara alheia retorna vazia; artefato alterado muda `ready` para `corrupt`; trava persistente e revisão superior órfã mudam `ready` para `incomplete` sem apagar a revisão anterior. O CLI foi exercitado sem conexão SaaS com acervo vazio. A leitura de todos os bytes pode ser custosa para sessões grandes; a interface futura deverá mostrar progresso e não tratar este comando como sonda de alta frequência.

**Recuperação de `incomplete`:** interromper o serviço, confirmar que nenhum importador usa a pasta, copiar o acervo local para investigação e identificar a revisão corrente íntegra. A trava `.import-lock` só pode ser removida após essa conferência; em seguida, executar nova sincronização para revalidar e refazer a revisão pendente. Não abrir a sessão com `incomplete` nem apagar automaticamente diretórios órfãos. A recuperação com queda real de energia e backup restaurado ainda é gate P5/P10.
