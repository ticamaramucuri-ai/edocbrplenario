# Desenvolvimento no GitHub Free

**Estado em 09/11/2026.** O repositório `e-docBR/edocBRplenario` é privado. Jobs hospedados foram recusados com aviso de cobrança ou limite; a causa exata ainda exige conferência por administrador em **Settings → Billing & licensing**. O [PR #41](https://github.com/e-docBR/edocBRplenario/pull/41) foi integrado após [CI verde nos três jobs](https://github.com/e-docBR/edocBRplenario/actions/runs/42696676863) no runner próprio `edocbr-ci-vm`, sem minutos hospedados. Esse runner é efêmero: o registro desaparece ao terminar cada job. A CI de `main` e de cada novo PR continua sendo um gate independente.

## Operação sem minutos pagos

1. Manter o repositório privado. Torná-lo público para obter Actions ilimitadas exporia o código e exige decisão separada de licença, segredos, histórico e propriedade intelectual.
2. Executar a CI no runner próprio **uma vez por PR** e uma vez após merge em `main`. A regra `push` não dispara CI em toda branch; `concurrency` cancela execuções substituídas do mesmo ref. O workflow usa o rótulo exclusivo `edocbr-ci-vm` e impede agendamento de PRs de fork nessa máquina. Se a estação estiver desligada, os jobs ficam na fila; esse runner não é serviço contínuo.
3. O observador externo hospedado está **sem agendamento** desde 20/11/2026 (ver adiante). Quando ativo, era horário e não a cada 15 minutos: até 720 execuções mensais, contra até 2.880; cada job pode ser arredondado para um minuto faturável. Com a recusa de jobs hospedados, **não contar esse agendamento como monitoramento ativo**. Implantar observador externo independente, com alerta a responsável, antes de produção; nunca usar a mesma VPS como única sonda de sua disponibilidade.
4. Rodar testes locais descartáveis antes de publicar PR. Registrar comando, resultado e SHA no arquivo de etapa. Teste local **não substitui** a CI remota quando o gate de promoção a exige.
5. A VM de CI atual roda Ubuntu 24.04 com KVM na estação de desenvolvimento, 4 CPUs, 7 GiB de RAM e Docker próprio. Tem `unzip`, Docker Compose v2, FFmpeg e Chromium instalado pelo workflow; a rede Docker do convidado usa `172.30.0.0/16` para não colidir com a do host. Não monta socket Docker, código ou credenciais de produção do host. Cada registro do runner atende um job e o diretório de trabalho é limpo antes do seguinte. Hardware e administração continuam tendo custo próprio. Ainda faltam imagem/rotina de bootstrap versionadas, atualização e restauração testadas e um host de CI sempre disponível.
6. Exigir três checks verdes no **SHA atual** antes do merge e repetir em `main` antes da promoção. **Não** apontar CI de PR para a VPS de aplicação; código de PR executado ali poderia alcançar dados e chaves. A prova do #41 demonstra o caminho Free, não aprova automaticamente os PRs seguintes nem substitui homologação funcional.

Fontes: [cobrança do GitHub Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions), [runners padrão para repositórios públicos e privados](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job), [segurança de runner próprio](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners).

## Atualização de 20/11/2026

**O bloqueio é da conta, não deste repositório.** Em 20/11, runs de
`edocBRplenario`, `colaboraEduNovo` e `i-educar-colaboraedu` falharam com zero
passos executados e a mesma anotação: *"The job was not started because recent
account payments have failed or your spending limit needs to be increased."* A
cota gratuita de 2.000 minutos/mês vale para a conta inteira e é dividida entre
todos os repositórios privados, então mover ou excluir um repositório não
resolve o bloqueio — apenas desloca o consumo.

Consumo observado na conta entre 20/10 e 20/11 (tempo de máquina, piso — cada
job paralelo é faturado separado): `edocbrNextcloud` ~447 min em 312 runs,
`colaboraEduNovo` ~452 min, `colaboraedu2` ~239 min, `colaboraEDU` ~107 min e
`horario` ~36 min. Este repositório contribuiu com pouco: o job `application`,
`postgres-foundation` e `media-smoke` do `ci.yml` são self-hosted e não são
faturados; só o observador horário usava runner hospedado.

Medidas aplicadas:

- Actions **desativado** em `edocbrNextcloud` (cópia de workflows do Nextcloud,
  ~10 crons diários, último push em 07/2026) e em `colaboraEDU` (apenas
  `Security Scan` diário, repositório parado desde 12/2025). Reversível em
  Settings → Actions → General.
- `schedule` do `staging-observer.yml` **removido**; resta `workflow_dispatch`.
  O job hospedado era recusado por cota antes de iniciar e, quando executava,
  esperava `200` com `X-Robots-Tag: noindex` em `/`, mas o domínio público
  `https://edocbrplenario.com.br` responde `302` para `/login`, e
  `/api/v1/health?ready=1` responde `401`. O observador precisa ser reescrito
  para o contrato real antes de voltar ao agendamento.
- Nenhum runner `edocbr-ci-vm` aparece registrado no repositório: coerente com o
  runner efêmero descrito acima, mas significa que **a CI só roda com a estação
  de desenvolvimento ligada e o runner registrado**.

Pendente: conferir em **Settings → Billing and plans** a data de virada do ciclo
e se há cobrança em aberto; reativar o observador com contrato e agendamento
diário; decidir formalmente o estado do ambiente público, já que o domínio está
no ar atrás de login enquanto este documento e o `CLAUDE.md` afirmam que não há
ambiente remoto.

